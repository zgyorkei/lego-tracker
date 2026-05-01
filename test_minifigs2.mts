import axios from 'axios';
import * as cheerio from 'cheerio';

async function test(setNumber) {
    try {
        const res = await axios.get(`https://brickset.com/sets?query=${setNumber}`);
        const $ = cheerio.load(res.data);
        $('.set').each((i, el) => {
            const heading = $(el).find('h1').text().trim();
            console.log("Heading:", heading);
        });
    } catch (e) {
        console.log("Error:", e.message);
    }
}

test("71047");
