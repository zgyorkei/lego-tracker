import axios from 'axios';
import * as cheerio from 'cheerio';

async function test(setNumber, ext) {
    try {
      const res = await axios.get(`https://brickset.com/sets/${setNumber}-${ext}`);
      const $ = cheerio.load(res.data);
      let name = $('h1').first().text().trim();
      const theme = $('a[href^="/sets/theme-"]').first().text();
      const subtheme = $('a[href^="/sets/theme-"][href*="subtheme-"]').first().text();
      console.log(`Brickset ${ext} Theme:`, theme, "Sub:", subtheme);
      if (theme === 'Collectable Minifigures' && subtheme) {
          name = `LEGO Minifigures - ${subtheme}`;
      }
      console.log(`Final name for ${setNumber}-${ext}:`, name);
    } catch (e) {
      console.log(e.message);
    }
}
test("71047", "1");
test("71052", "1");
