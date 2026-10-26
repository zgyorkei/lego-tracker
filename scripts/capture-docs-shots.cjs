// Captures the screenshots for the GitHub Pages intro (docs/index.html) from
// the running website in Demo Mode, so every picture shows made-up data and
// nobody's collection.
//
//   npm run dev                                  (in one terminal)
//   node scripts/capture-docs-shots.cjs [baseUrl]   (default http://localhost:3000)
//
// Uses the desktop package's Playwright (desktop/node_modules). Writes JPEGs to
// docs/shots/.
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const { chromium } = require(path.join(root, 'desktop', 'node_modules', 'playwright'));
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
const out = path.join(root, 'docs', 'shots');
fs.mkdirSync(out, { recursive: true });

const settle = async (page, ms = 1500) => {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const save = (name) => ({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 84 });
const card = (page, setNumber) => page.locator('div.break-inside-avoid').filter({ hasText: `#${setNumber}` }).first();

async function openDemo(page) {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Try Demo Mode', { exact: false }).click();
  await settle(page, 2500);
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // Desktop-sized website.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.screenshot(save('login'));

  await openDemo(page);
  await page.screenshot(save('dashboard'));

  // Card close-ups: the sticky header would otherwise cover a card's top.
  await page.addStyleTag({ content: 'header.sticky { position: static !important; }' });

  await card(page, '10333').scrollIntoViewIfNeeded();
  await settle(page, 600);
  await card(page, '10333').screenshot(save('card-deal'));

  await card(page, '10305').scrollIntoViewIfNeeded();
  await card(page, '10305').screenshot(save('card-purchased'));

  const history = card(page, '21348');
  await history.scrollIntoViewIfNeeded();
  await history.locator('button[aria-controls^="price-history-"]').click();
  // The chart draws its line in an animation; let it finish.
  await settle(page, 4000);
  await history.screenshot(save('price-history'));

  // Held as an element: the flipped back no longer shows the set number the
  // locator matches on.
  const figures = await card(page, '71047').elementHandle();
  await figures.scrollIntoViewIfNeeded();
  await figures.hover();
  await (await figures.$('text=View Checklist')).click();
  await settle(page, 1800);
  await figures.screenshot(save('minifigures'));

  await page.getByRole('button', { name: /sources/i }).first().click();
  await settle(page, 800);
  await page.locator('[role="dialog"]').screenshot(save('price-sources'));
  await page.keyboard.press('Escape');

  await page.goto(base + '/registry/demo', { waitUntil: 'domcontentloaded' });
  await settle(page, 2000);
  await page.screenshot(save('registry'));

  // The desktop app's Price Sources: the same page with the desktop bridge in
  // place, plus one untaught example shop to show the Teach control.
  // Tall, so the scrolling dialog shows all four sources and their states.
  const desk = await browser.newContext({ viewport: { width: 1440, height: 1900 } });
  await desk.addInitScript(() => {
    window.legoTrackerDesktop = { isDesktop: true, signInWithGoogle: async () => { throw new Error('Sign-in is not available here'); } };
    localStorage.setItem('legoPriceSources', JSON.stringify([
      { id: 'amazon', name: 'Amazon EU', urlTemplate: 'https://www.amazon.de/s?k=lego+{setNumber}', currency: 'EUR', color: '#2563eb' },
      { id: 'bricklink', name: 'BrickLink', urlTemplate: 'https://www.bricklink.com/v2/catalog/catalogitem.page?S={setNumber}-1', currency: 'EUR', color: '#D4A017' },
      { id: 'arukereso', name: 'Arukereso', urlTemplate: 'https://www.arukereso.hu/CategorySearch.php?st={setNumber}', currency: 'HUF', color: '#10b981' },
      { id: 'toyshop', name: 'Example Toy Shop', urlTemplate: 'https://www.example-toyshop.com/search?q=lego+{setNumber}', currency: 'EUR', color: '#ef4444' },
    ]));
  });
  const dp = await desk.newPage();
  await openDemo(dp);
  await dp.getByRole('button', { name: /sources/i }).first().click();
  await settle(dp, 800);
  await dp.locator('[role="dialog"]').screenshot(save('price-sources-desktop'));

  // Phone-sized website.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  await openDemo(pp);
  await pp.screenshot(save('phone'));

  await browser.close();
  for (const f of fs.readdirSync(out)) console.log(`docs/shots/${f} (${Math.round(fs.statSync(path.join(out, f)).size / 1024)} KB)`);
})();
