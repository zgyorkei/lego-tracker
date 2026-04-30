import axios from 'axios';
import * as cheerio from 'cheerio';

async function test(setNumber) {
  try {
    const res = await axios.get(`https://brickipedia.fandom.com/wiki/${setNumber}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'text/html,application/xhtml+xml,application/xml'
        }
    });
    console.log("Status:", res.status);
    console.log("Title :", cheerio.load(res.data)('title').text());
  } catch (e) {
    console.log(e.message);
  }
}
test("42143");
test("75382");
test("21345");
