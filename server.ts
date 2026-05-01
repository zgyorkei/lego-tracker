import express from 'express';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

// Lazily load genAI to avoid startup crashes if API key is missing
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0'
  ];

  const getCommonHeaders = () => ({
    'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Upgrade-Insecure-Requests': '1',
  });

  // API Route: Fetch Minifigure Series Items
  app.get('/api/minifigures/:setNumber', async (req, res) => {
    const { setNumber } = req.params;
    try {
        const response = await axios.get(`https://brickset.com/sets?query=${setNumber}`, { headers: getCommonHeaders(), timeout: 10000 });
        const $ = cheerio.load(response.data);
        const results: any[] = [];
        $('.set').each((i, el) => {
            const heading = $(el).find('h1 a').clone().children().remove().end().text().trim();
            const url = $(el).find('h1 a').attr('href') || '';
            let image = $(el).find('img').attr('src');
            
            // replace /small/ with /images/ to get larger resolution
            if (image) image = image.replace('/small/', '/images/');
            
            const match = url.match(new RegExp(`/sets/${setNumber}-(\\d+)/`));
            if (match) {
                const subId = match[1];
                let name = heading.replace(`${setNumber}:`, '').trim();
                if (name.startsWith('LEGO Minifigures')) return; // skip header
                
                // Exclude random packs, boxes, and complete sets
                if (parseInt(subId) > 0 && 
                    !name.toLowerCase().includes('random pack') &&
                    !name.toLowerCase().includes('sealed box') &&
                    !name.toLowerCase().includes('complete')) {
                    results.push({
                        id: `${setNumber}-${subId}`,
                        name: name,
                        image: image || null
                    });
                }
            }
        });
        
        // Sort results by ID
        results.sort((a, b) => {
           const idA = parseInt(a.id.split('-')[1]);
           const idB = parseInt(b.id.split('-')[1]);
           return idA - idB;
        });

        res.json({ figures: results });
    } catch (error) {
        console.error('Error fetching minifigures:', error);
        res.status(500).json({ error: 'Failed to fetch minifigures' });
    }
  });

  // API Route: Fetch Lego Set Info
  app.get('/api/lego/:setNumber', async (req, res) => {
    const { setNumber } = req.params;
    const skipImage = req.query.skipImage === 'true';
    
    const legoUrlHuf = `https://www.lego.com/hu-hu/product/${setNumber}`;
    const legoUrlEn = `https://www.lego.com/en-us/product/${setNumber}`;

    try {
      const responseHu = await axios.get(legoUrlHuf, { headers: getCommonHeaders(), timeout: 10000 });
      const $hu = cheerio.load(responseHu.data);
      
      const priceText = $hu('span[data-test="product-price"]').first().text().trim();
      let productImage = null;
      if (!skipImage) {
        productImage = $hu('meta[property="og:image"]').attr('content');
        if (!productImage) {
          productImage = $hu('img[class*="ProductImage"]').first().attr('src');
        }
      }
      const priceHuf = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;

      let name = `Lego Set ${setNumber}`;
      try {
        const responseEn = await axios.get(legoUrlEn, { 
          headers: { 
            ...getCommonHeaders(), 
            'Accept-Language': 'en-US,en;q=0.9',
            'Cookie': 'cs-setCountry=US; cs-setLanguage=en_US; cs-CountryRegion=US;'
          }, 
          timeout: 5000 
        });
        const $en = cheerio.load(responseEn.data);
        name = $en('h1[data-test="product-overview-name"]').first().text().trim() || $en('h1').first().text().trim() || name;
      } catch (enError) {
        name = $hu('h1[data-test="product-overview-name"]').first().text().trim() || $hu('h1').first().text().trim() || name; // fallback to HU string if EN fails
      }

      res.json({ name, priceHuf, image: productImage, url: legoUrlHuf });
    } catch (scrapingError: any) {
      console.warn('Scraping Lego.com failed, attempting Gemini Search fallback...', scrapingError.message);

      const customKey = req.headers['x-gemini-api-key'] as string | undefined;
      try {
        const imagePrompt = skipImage ? "" : "and the main product image URL. ";
        const imageJsonFormat = skipImage ? "" : ', "imageUrl": "string"';
        const prompt = `Search for Lego set ${setNumber}. ALWAYS find the official ENGLISH name, current HUF price, ${imagePrompt}If it's an unreleased set or not on lego.com, prioritize searching jaysbrickblog.com to find information such as price (convert USD/EUR to HUF roughly), image, and release date. If you get the info from an unofficial source like jaysbrickblog, set 'isTemporary' to true. Return ONLY a JSON object: { "name": "string", "priceHuf": 1234${imageJsonFormat}, "isTemporary": boolean, "releaseDate": "string | null" }.`;
        
        let text = '';
        const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];
        let lastError: any;
        
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
               } else if (e.message && e.message.includes('429')) {
                  const retryMatch = e.message.match(/retry in ([\d\.]+)s/);
                  const waitSecs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 90;
                  throw { isRateLimit: true, retryAfter: waitSecs };
               } else {
                  break; // Don't retry for other errors like 404
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
          res.json({
            name: data.name,
            priceHuf: data.priceHuf,
            image: data.imageUrl,
            url: legoUrlHuf,
            isTemporary: data.isTemporary || false,
            releaseDate: data.releaseDate || null
          });
        } else {
          throw new Error('Could not parse Gemini response');
        }
      } catch (fallbackError: any) {
        console.error('Gemini failed:', fallbackError);
        if (fallbackError?.isRateLimit) {
           return res.status(429).json({ error: 'Rate limit exceeded.', retryAfter: fallbackError.retryAfter });
        }
        res.status(500).json({ error: 'Failed to fetch LEGO set info from all sources. Make sure your GEMINI_API_KEY is valid.' });
      }
    }
  });

  // API Route: Fetch prices from Amazon and Arukereso
  app.get('/api/prices/:setNumber', async (req, res) => {
    const { setNumber } = req.params;
    const customKey = req.headers['x-gemini-api-key'] as string | undefined;
    try {
      const exRateRes = await axios.get('https://api.exchangerate-api.com/v4/latest/EUR');
      const hufRate = exRateRes.data.rates.HUF;

      const amazonUrl = `https://www.amazon.de/s?k=lego+${setNumber}`;
      const arukeresoUrl = `https://www.arukereso.hu/CategorySearch.php?st=${setNumber}`;

      // We'll use Gemini to "search" for these specific prices since direct scraping is often blocked
      const prompt = `Find the current lowest price for Lego set ${setNumber} on Amazon.de (in EUR) and on Arukereso.hu (in HUF, including the store name for the lowest price). 
      Return ONLY a JSON object: 
      { 
        "amazonPriceEur": number, 
        "arukeresoPriceHuf": number, 
        "arukeresoStore": "string" 
      }`;

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
                break; // Don't retry for other errors like 404
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
        res.json({
          amazon: {
            priceEur: data.amazonPriceEur,
            priceHuf: Math.round(data.amazonPriceEur * hufRate),
            url: amazonUrl
          },
          arukereso: {
            priceHuf: data.arukeresoPriceHuf,
            priceEur: parseFloat((data.arukeresoPriceHuf / hufRate).toFixed(2)),
            store: data.arukeresoStore,
            url: arukeresoUrl
          },
          exchangeRate: hufRate
        });
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

  // API Route: Fetch historical exchange rate
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
