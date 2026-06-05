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
   console.log('Status', res.status);
   const $ = cheerio.load(res.data);
   console.log('Title:', $('title').text());
})
.catch(err => console.log('Error', err.message));
