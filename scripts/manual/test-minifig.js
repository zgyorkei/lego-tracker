const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
  const { data } = await axios.get('https://brickset.com/minifigs/in-10316-1');
  const $ = cheerio.load(data);
  const results = [];
  
  // The structure of the Brickset Minifigures page usually has .minifig lists or article elements.
  $('article.set').each((i, el) => {
    const heading = $(el).find('h1 a').text().trim();
    const id = heading.split(' ')[0] || '';
    const image = $(el).find('.img a img').attr('src');
    if (heading) {
        results.push({ heading, id, image });
    }
  });
  console.log(results);
}
test();
