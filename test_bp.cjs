const axios = require('axios');
const cheerio = require('cheerio');

async function test(setNumber) {
  try {
    const res = await axios.get(`https://brickipedia.fandom.com/wiki/${setNumber}`);
    const $ = cheerio.load(res.data);
    
    // Attempt to parse name, image, price
    const name = $('h1#firstHeading').first().text().trim();
    
    // image from infobox
    const imgUrl = $('aside.portable-infobox figure img').attr('src');
    
    // price from infobox
    // It's usually in a data-source="price" div or similar
    let priceEu = null;
    $('[data-source]').each((i, el) => {
       const label = $(el).find('.pi-data-label').text();
       if (label.includes('Price') || label.includes('MSRP') || label.includes('Cost')) {
           const value = $(el).find('.pi-data-value').text();
           console.log("Price raw:", value);
           const m = value.match(/€[ ]?(\d+[.,]?\d*)/); // EUR match
           if (m) {
              priceEu = parseFloat(m[1].replace(',', '.'));
           }
       }
    });

    console.log("Name:", name);
    console.log("Img:", imgUrl);
    console.log("EU Price:", priceEu);
  } catch (e) {
    console.log(e.message);
  }
}
test("75382");
