import axios from 'axios';
import * as cheerio from 'cheerio';
const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Upgrade-Insecure-Requests': '1',
};
axios.get('https://www.lego.com/hu-hu/product/42115', { headers: commonHeaders, timeout: 5000 })
.then(res => {
   const $ = cheerio.load(res.data);
   const priceText = $('span[data-test="product-price"]').first().text().trim();
   console.log('Price Text:', priceText);
   const fallbackText = $('span[data-test="product-price-sale"]').first().text().trim();
   console.log('Price Sale:', fallbackText);
   console.log('Html matched:', $('span[data-test="product-price"]').length);
})
.catch(err => console.log('Error:', err.message));
