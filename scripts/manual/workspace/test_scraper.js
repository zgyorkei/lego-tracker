import axios from 'axios';
import * as cheerio from 'cheerio';

async function test(setNumber) {
    try {
        const url = `https://www.arukereso.hu/CategorySearch.php?st=${setNumber}`;
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ];
        
        const res = await axios.get(url, {
            headers: {
                'User-Agent': userAgents[0],
                'Accept': 'text/html,application/xhtml+xml,application/xml'
            }
        });
        const $ = cheerio.load(res.data);
        
        // Let's print out the HTML of the first product card to understand how to scrape it
        const listItems = $('.product-box-container');
        if (listItems.length > 0) {
            const price = $(listItems[0]).find('.price').text().trim();
            console.log("Price:", price);
        } else {
            console.log("No product boxes found, searching globally for .price");
            console.log("Price:", $('.price').first().text().trim());
        }
        
    } catch (e) {
        console.error(e.message);
    }
}
test("10305");
