// Manual check of the desktop set-details path: Brickset and LEGO.com pages
// loaded in the local browser and run through the shared parsers.
// Usage (from the repo root):
//   npx tsx desktop/scripts/try-details.ts <profileDir> <setNumber>...
import { PlaywrightScraper } from '../src/scraper/engine';
import { parseBricksetMinifigs, parseBricksetSetPage, parseLegoProductPage } from '../../lib/server-api';

const [profileDir, ...setNumbers] = process.argv.slice(2);

async function main() {
  const scraper = new PlaywrightScraper(profileDir);
  for (const n of setNumbers) {
    const bs = await scraper.fetchPageHtml(`https://brickset.com/sets/${n}-1`);
    const lego = await scraper.fetchPageHtml(`https://www.lego.com/hu-hu/product/${n}`);
    const figs = await scraper.fetchPageHtml(`https://brickset.com/minifigs/in-${n}-1`);
    console.log(n, JSON.stringify({
      brickset: bs ? parseBricksetSetPage(bs) : 'blocked',
      lego: lego ? parseLegoProductPage(lego) : 'blocked',
      minifigures: figs ? parseBricksetMinifigs(figs).map((f) => f.name) : 'blocked',
    }));
  }
  await scraper.close();
}

void main();
