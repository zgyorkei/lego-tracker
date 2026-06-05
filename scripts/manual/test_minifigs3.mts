import axios from 'axios';
import * as cheerio from 'cheerio';

async function test(setNumber) {
    try {
        const res = await axios.get(`https://brickset.com/sets?query=${setNumber}`);
        const $ = cheerio.load(res.data);
        $('.set').each((i, el) => {
            const url = $(el).find('h1 a').attr('href');
            console.log("URL:", url);
            const image = $(el).find('img').attr('src');
            console.log("Image:", image);
        });
    } catch (e) {
        console.log("Error:", e.message);
    }
}

test("71047");
