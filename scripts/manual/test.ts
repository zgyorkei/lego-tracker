import axios from 'axios';
import * as cheerio from 'cheerio';

async function test() {
  const { data } = await axios.get('https://brickset.com/minifigs/in-10316-1');
  const $ = cheerio.load(data);
  const results: any[] = [];
  
  $('article.set').each((i, el) => {
    const heading = $(el).find('h1 a').clone().children().remove().end().text().trim();
    const idObj = $(el).find('h1 a').text().trim().split(' ')[0] || '';
    const name = $(el).find('.tags a:not(.separator)').last().text().trim(); // Or some other way? Let's just output the HTML of one
    results.push({
        html: $(el).find('h1 a').html(),
        href: $(el).find('h1 a').attr('href'),
        image: $(el).find('img').attr('src')
    });
  });
  console.log(JSON.stringify(results, null, 2));
}
test();
