import axios from 'axios';
import * as cheerio from 'cheerio';

async function test(setNumber) {
  try {
    const res = await axios.get(`https://brickset.com/sets/${setNumber}-1`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'text/html,application/xhtml+xml,application/xml'
        }
    });
    const $ = cheerio.load(res.data);
    
    console.log("Images found:", $('img').map((i, el) => $(el).attr('src')).get().slice(0, 10));
    console.log("OG image:", $('meta[property="og:image"]').attr('content'));
    
  } catch (e) {
    console.log(e.message);
  }
}
test("42143");
