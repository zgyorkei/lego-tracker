import axios from 'axios';
import * as cheerio from 'cheerio';
const testScrape = async () => {
    try {
        const response = await axios.get("https://brickset.com/sets?query=71047");
        console.log("HTML length:", response.data.length);
        const $ = cheerio.load(response.data);
        const results: any[] = [];
        $('.set').each((i, el) => {
            const heading = $(el).find('h1').text().trim();
            console.log("HEADING:", heading);
            let image = $(el).find('img').attr('src');
            
            const match = heading.match(new RegExp(`71047-(\\d+)`));
            if (match) {
                const subId = match[1];
                let name = heading.replace(`71047-${subId}:`, '').trim();
                
                if (parseInt(subId) > 0 && 
                    !name.toLowerCase().includes('random pack') &&
                    !name.toLowerCase().includes('sealed box') &&
                    !name.toLowerCase().includes('complete')) {
                    results.push({
                        id: `71047-${subId}`,
                        name: name,
                        image: image || null
                    });
                }
            }
        });
        console.log("RESULTS:", results);
    } catch (e) {
        console.error("ERROR:", e);
    }
}
testScrape();
