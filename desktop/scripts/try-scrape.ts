// Manual check of the desktop scraper against live shops, outside Electron.
// Usage (from the repo root):
//   npx tsx desktop/scripts/try-scrape.ts <profileDir> <amazon|arukereso> <setNumber>...
import { PlaywrightScraper } from '../src/scraper/engine';

const TEMPLATES: Record<string, string> = {
  amazon: 'https://www.amazon.de/s?k=lego+{setNumber}',
  arukereso: 'https://www.arukereso.hu/CategorySearch.php?st={setNumber}',
};

const [profileDir, sourceId, ...setNumbers] = process.argv.slice(2);
const urlTemplate = TEMPLATES[sourceId];
if (!profileDir || !urlTemplate || setNumbers.length === 0) {
  console.error('usage: try-scrape.ts <profileDir> <amazon|arukereso> <setNumber>...');
  process.exit(1);
}

async function main() {
  const scraper = new PlaywrightScraper(profileDir);
  for (const setNumber of setNumbers) {
    const t0 = Date.now();
    const r = await scraper.scrapePrice({ id: sourceId, urlTemplate }, setNumber).catch((e) => `ERROR ${e?.message || e}`);
    console.log(`${sourceId} ${setNumber}: ${JSON.stringify(r)} (${Date.now() - t0} ms)`);
  }
  await scraper.close();
}

void main();
