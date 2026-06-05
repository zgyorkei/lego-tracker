import axios from 'axios';
import * as cheerio from 'cheerio';
const getCommonHeaders = () => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Upgrade-Insecure-Requests': '1',
  });
axios.get('https://jaysbrickblog.com/?s=42115', { headers: getCommonHeaders(), timeout: 10000 })
.then(res => {
   const $ = cheerio.load(res.data);
   const headings = $('h2, h3, .title, .post-title, a').filter((i, el) => $(el).text().includes('42115')).toArray();
   headings.forEach(el => console.log('Found:', $(el).text().trim()));
})
.catch(err => console.log('Error', err.message));
