import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

function getGenAI(customKey?: string) {
  let apiKey = customKey || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    apiKey = 'AIzaSyCVrcS1sFK8zg9oulDGUYTXad6HpYJ6iZc';
  }
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in AI Studio or provide a custom key.");
  }
  return new GoogleGenAI({ apiKey });
}

const app = express();

app.use(express.json());

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0'
];

function getCommonHeaders() {
  return {
    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9,hu;q=0.8,de;q=0.7',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };
}

app.get('/api/lego/:setNumber', async (req, res) => {
  const { setNumber } = req.params;
  const customKey = req.headers['x-gemini-api-key'] as string | undefined;

  try {
    let legoPriceHuf = null;
    let legoStoreUrl = null;
    let legoSetData: any = {};
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    try {
      const dbUrl = `https://brickset.com/sets?query=${setNumber}`;
      console.log('Fetching Brickset info:', dbUrl);
      const dbRes = await axios.get(dbUrl, { headers: getCommonHeaders(), timeout: 8000 });
      const $db = cheerio.load(dbRes.data);
      
      const titleEl = $db('.set h1').first();
      let name = titleEl.text().replace(setNumber, '').replace(/^-/, '').trim();
      
      const partsPattern = /([A-Za-z0-9\s:-]+)/;
      const match = name.match(partsPattern);
      if (match) {
        name = match[1].trim();
      }

      if (name) {
          legoSetData.name = name;
      }
      
      const imgEl = $db('.set img').first();
      if (imgEl.length > 0) {
          let imgSrc = imgEl.attr('src') || imgEl.attr('data-src');
          if (imgSrc) {
               imgSrc = imgSrc.replace(/\?.*/, ''); 
               legoSetData.imageUrl = imgSrc;
          }
      }

      const infoText = $db('.set .tags').text();
      console.log("Brickset info string:", infoText);
      const isTemporaryMatch = infoText.match(/not yet released|coming soon|pre-order/i);
      legoSetData.isTemporary = !!isTemporaryMatch;

      await delay(500); 

    } catch(e: any) {
        console.warn('Brickset scraping failed:', e?.message);
    }

    try {
        const huUrl = `https://www.lego.com/hu-hu/product/${setNumber}`;
        const legoRes = await axios.get(huUrl, {
            headers: getCommonHeaders(),
            timeout: 8000
        });

        const $lego = cheerio.load(legoRes.data);

        const titleText = $lego('h1').text().trim() || $lego('title').text().replace(/\| LEGO® .*|LEGO\.com .*/g, '').trim();
        if (titleText && !legoSetData.name) {
            legoSetData.name = titleText;
        }

        const priceText = $lego('[data-test="product-price"]').first().text() || 
                          $lego('.ProductPricestyles__StylizedPriceText-vjd22z-2').first().text();
                          
        if (priceText) {
            const hufValue = parseInt(priceText.replace(/[^0-9]/g, ''), 10);
            if (hufValue && hufValue > 0) {
                 legoPriceHuf = hufValue;
                 legoStoreUrl = huUrl;
                 console.log("Found price on LEGO.com:", hufValue);
            }
        }
    } catch(e: any) {
         console.warn('LEGO.com HU scraping failed:', e.response?.status || e.message);
    }

    if (legoSetData.name && legoPriceHuf) {
        return res.json({
            name: legoSetData.name,
            priceHuf: legoPriceHuf,
            image: legoSetData.imageUrl || null,
            url: legoStoreUrl,
            isTemporary: legoSetData.isTemporary || false,
            releaseDate: legoSetData.releaseDate || null
        });
    }

    console.warn('Scraping lego info incomplete, attempting Gemini Search fallback...');
    
    let prompt = `Find the following information for Lego set ${setNumber}:\n`;
    prompt += `- Full product name\n`;
    if (!legoPriceHuf) prompt += `- Official price on lego.com/hu-hu (in HUF)\n`;
    if (!legoSetData.imageUrl) prompt += `- A direct URL to a high-quality product image\n`;
    prompt += `- Is it officially released yet or just announced/pre-order? (boolean isTemporary)\n`;
    prompt += `- Release date (if known, string like "YYYY-MM")\n`;
    prompt += `Return ONLY a JSON object: { "name": "string", "priceHuf": number, "imageUrl": "string", "isTemporary": boolean, "releaseDate": "string" }`;

    const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];
    let text = '';
    let lastError;
    
    for (const model of models) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`Trying model ${model} (attempt ${attempt}) for lego info...`);
          const result = await getGenAI(customKey).models.generateContent({
            model,
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] }
          });
          text = result.text || '';
          break;
        } catch (e: any) {
           console.warn(`Model ${model} (attempt ${attempt}) failed:`, e.message);
           lastError = e;
           if (e.message && e.message.includes('503')) {
              await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
           } else if (e.message && (e.message.includes('429') || e.message.includes('Quota exceeded'))) {
              const retryMatch = e.message.match(/retry in ([\d\.]+)s/);
              const waitSecs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 90;
              throw { isRateLimit: true, retryAfter: waitSecs };
           } else {
              break; 
           }
        }
      }
      if (text) break;
    }
    
    if (!text) throw lastError;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse Gemini response');
    
    const data = JSON.parse(jsonMatch[0]);
    res.json({
        name: legoSetData.name || data.name,
        priceHuf: legoPriceHuf || data.priceHuf,
        image: legoSetData.imageUrl || data.imageUrl,
        url: legoStoreUrl || `https://www.lego.com/hu-hu/product/${setNumber}`,
        isTemporary: legoSetData.isTemporary !== undefined ? legoSetData.isTemporary : (data.isTemporary || false),
        releaseDate: data.releaseDate || null
    });
  } catch (fallbackError: any) {
    console.error('Gemini failed:', fallbackError);
    if (fallbackError?.isRateLimit) {
        return res.status(429).json({ error: 'Rate limit exceeded.', retryAfter: fallbackError.retryAfter });
    }
    res.status(500).json({ error: 'Failed to fetch LEGO set info from all sources. Make sure your GEMINI_API_KEY is valid.' });
  }
});

// API Route: Fetch prices dynamically based on sources
app.post('/api/prices/:setNumber', async (req, res) => {
  const { setNumber } = req.params;
  const customKey = req.headers['x-gemini-api-key'] as string | undefined;
  const { sources } = req.body;
  
  if (!sources || !Array.isArray(sources) || sources.length === 0) {
     return res.status(400).json({ error: 'No price sources provided' });
  }

  try {
    const exRateRes = await axios.get('https://api.exchangerate-api.com/v4/latest/EUR');
    const hufRate = exRateRes.data.rates.HUF;

    let promptSources = sources.map((s: any) => `- "${s.id}": ${s.urlTemplate.replace('{setNumber}', setNumber)} (Expected currency: ${s.currency})`).join('\n');
    
    let expectedJsonFormat = sources.reduce((acc: any, s: any) => {
        acc[s.id] = { price: 0, store: `string (name of the specific store)` };
        return acc;
    }, {});

    // We'll use Gemini to "search" for these specific prices since direct scraping is often blocked
    const prompt = `Find the current lowest price for Lego set ${setNumber} on the following sources:
${promptSources}

Return ONLY a JSON object in this exact format: 
${JSON.stringify(expectedJsonFormat, null, 2)}`;

    const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];
    let text = '';
    let lastError: any;
    
    for (const model of models) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`Trying model ${model} (attempt ${attempt}) for prices...`);
          const result = await getGenAI(customKey).models.generateContent({
            model,
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] }
          });
          text = result.text || '';
          break;
        } catch (e: any) {
           console.warn(`Model ${model} (attempt ${attempt}) failed:`, e.message);
           lastError = e;
           if (e.message && e.message.includes('503')) {
              await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
           } else if (e.message && e.message.includes('429')) {
              const retryMatch = e.message.match(/retry in ([\d\.]+)s/);
              const waitSecs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 90;
              throw { isRateLimit: true, retryAfter: waitSecs };
           } else {
              break; 
           }
        }
      }
      if (text) break;
    }
    
    if (!text) {
      throw lastError;
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      const responseData: any = { exchangeRate: hufRate };
      
      for (const s of sources) {
          if (data[s.id]) {
              const p = data[s.id].price;
              responseData[s.id] = {
                  price: p, // in whatever currency
                  priceHuf: s.currency === 'EUR' ? p * hufRate : (s.currency === 'USD' ? p * (hufRate / 1.08 /*approx*/) : p),
                  priceEur: s.currency === 'HUF' ? p / hufRate : (s.currency === 'USD' ? p / 1.08 : p),
                  store: data[s.id].store,
                  url: s.urlTemplate.replace('{setNumber}', setNumber)
              };
          }
      }
      
      res.json(responseData);
    } else {
      throw new Error('Failed to parse price data from Gemini');
    }
  } catch (error: any) {
    console.error('Error fetching market prices:', error);
    if (error?.isRateLimit) {
        return res.status(429).json({ error: 'Rate limit exceeded.', retryAfter: error.retryAfter });
    }
    res.status(500).json({ error: 'Failed to fetch market prices. Make sure your GEMINI_API_KEY is valid.', details: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/exchange-rate/:date', async (req, res) => {
  const { date } = req.params;
  try {
    const response = await axios.get(`https://api.frankfurter.app/${date}?from=EUR&to=HUF`);
    res.json({ hufRate: response.data.rates.HUF });
  } catch (error) {
    console.error('Error fetching historical exchange rate:', error);
    res.status(500).json({ error: 'Failed to fetch historical exchange rate' });
  }
});

export default app;
