import axios from 'axios';
import * as cheerio from 'cheerio';

async function test(setNumber) {
    try {
        const res = await axios.get(`https://brickset.com/sets?query=${setNumber}`);
        const $ = cheerio.load(res.data);
        const results = [];
        $('.set').each((i, el) => {
            console.log("EL HTML:", $(el).html());
            process.exit(0);
            const url = $(el).find('h1 a').attr('href');
            const image = $(el).find('img').attr('src');
            // Usually the set number is in the heading, e.g. "71047-1: Dwarf Barbarian"
            const match = heading.match(new RegExp(`${setNumber}-(\\d+): (.+)`));
            if (match) {
                const subId = match[1];
                const figureName = match[2];
                // Ignore the -0 (random pack) and -13+ if it's full box
                if (parseInt(subId) > 0 && figureName.indexOf('pack') === -1 && figureName.toLowerCase().indexOf('box') === -1) {
                    results.push({
                        id: `${setNumber}-${subId}`,
                        name: figureName,
                        image: image
                    });
                }
            }
        });
        console.log(results);
    } catch (e) {
        console.log("Error:", e.message);
    }
}

test("71047");
test("71052");
test("71039");
