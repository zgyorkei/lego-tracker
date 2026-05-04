import express from 'express';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const withTimeout = (promise: Promise<any>, ms: number) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
  ]);
};

// Lazily load genAI to avoid startup crashes if API key is missing
function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
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
        let results: any[] = [];

        // 1. First try regular set minifigures list
        const minResp = await axios.get(`https://brickset.com/minifigs/in-${setNumber}-1`, { headers: getCommonHeaders(), timeout: 10000 }).catch(e => null);
        if (minResp && minResp.data) {
            const $m = cheerio.load(minResp.data);
            $m('article.set').each((i, el) => {
                const href = $m(el).find('h1 a').attr('href') || '';
                const img = $m(el).find('img').attr('src');
                const name = $m(el).find('h1 a').html();
                const match = href.match(/\/minifigs\/([^\/]+)\//);
                if (match && name) {
                    results.push({
                        id: match[1],
                        name: name.toString().replace(/<[^>]*>?/gm, '').trim(),
                        image: img || null
                    });
                }
            });
        }

        // 2. If no results, fallback to Minifigure Series search
        if (results.length === 0) {
            const response = await axios.get(`https://brickset.com/sets?query=${setNumber}`, { headers: getCommonHeaders(), timeout: 10000 });
            const $ = cheerio.load(response.data);
            $('.set').each((i, el) => {
                const heading = $(el).find('h1 a').clone().children().remove().end().text().trim();
                const url = $(el).find('h1 a').attr('href') || '';
                let image = $(el).find('img').attr('src');
                
                if (image) image = image.replace('/small/', '/images/');
                
                const match = url.match(new RegExp(`/sets/${setNumber}-(\\d+)/`));
                if (match) {
                    const subId = match[1];
                    let name = heading.replace(`${setNumber}:`, '').trim();
                    if (name.startsWith('LEGO Minifigures')) return;
                    
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
            results.sort((a, b) => parseInt(a.id.split('-')[1]) - parseInt(b.id.split('-')[1]));
        }

        // 3. Fallback using Gemini if still empty
        if (results.length === 0) {
            if (process.env.GEMINI_API_KEY) {
                console.log('Scraping minifigures failed, attempting Gemini Search fallback...');
                const prompt = `Find all the minifigures or characters included in Lego set ${setNumber}. Prioritize searching jaysbrickblog.com and brickfanatics.com, or other reputable lego news sites. Return a JSON object with this exact shape: { "figures": [{ "id": "string (create a short distinct id, e.g. fig1)", "name": "string", "image": "string (direct image url or null)" }] } Return ONLY the JSON object.`;
                const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'];
                
                let text = '';
                for (const model of models) {
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            const result = await withTimeout(getGenAI().models.generateContent({
                                model,
                                contents: prompt,
                                config: { tools: [{ googleSearch: {} }], responseMimeType: 'application/json' }
                            }), 15000);
                            text = result.text || '{}';
                            const parsed = JSON.parse(text);
                            if (parsed.figures && Array.isArray(parsed.figures) && parsed.figures.length > 0) {
                                results = parsed.figures;
                                break;
                            }
                        } catch (e) {
                            console.warn(`Gemini minifigures attempt ${attempt} with ${model} failed`, e);
                        }
                    }
                    if (results.length > 0) break;
                }
            }
        }

        res.json({ figures: results });
    } catch (error) {
        console.error('Error fetching minifigures:', error);
        res.status(500).json({ error: 'Failed to fetch minifigures' });
    }
  });

  // API Route: Batch search for images using Gemini
  app.post('/api/batch-images', async (req, res) => {
    const { setNumbers } = req.body;
    
    if (!setNumbers || !Array.isArray(setNumbers) || setNumbers.length === 0) {
        return res.status(400).json({ error: 'No set numbers provided' });
    }

    try {
      const queryList = setNumbers.map(n => `"Lego ${n}"`).join(', ');
      const prompt = `Find the main high-quality product image URL for the following Lego sets: ${queryList}. 
Return ONLY a JSON object mapping each set number to its image URL. Example format: { "75192": "https://example.com/image1.jpg", "10294": "https://example.com/image2.png" }. Use the googleSearch tool to perform standard Google searches. Find direct image links if possible (e.g., from retailer sites, wikis, or brickset). Ensure the URLs are absolute.`;

      const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'];
      let text = '';
      let lastError: any;

      for (const model of models) {
         for (let attempt = 1; attempt <= 3; attempt++) {
            try {
               const result = await withTimeout(getGenAI().models.generateContent({
                  model,
                  contents: prompt,
                  config: { tools: [{ googleSearch: {} }], responseMimeType: 'application/json' }
               }), 15000);
               text = result.text || '{}';
               break;
            } catch (e: any) {
               console.warn(`Batch image search model ${model} (attempt ${attempt}) failed:`, e.message);
               lastError = e;
               if (e.message && e.message.includes('503')) {
                  await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
               } else if (e.message && e.message.includes('429')) {
                  const retryMatch = e.message.match(/retry in ([\d\.]+)s/);
                  const waitSecs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 90;
                  lastError = { isRateLimit: true, retryAfter: waitSecs, message: e.message };
                  break; // Move to next model
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
        res.json(data);
      } else {
        throw new Error('Could not parse Gemini response');
      }
    } catch (error: any) {
      console.error('Batch image search error:', error);
      if (error?.isRateLimit) {
          return res.status(429).json({ error: 'Rate limit exceeded.', retryAfter: error.retryAfter });
      }
      res.status(200).json({});
    }
  });

  // API Route: Proxy image to bypass CORS
  app.get('/api/proxy-image', async (req, res) => {
    try {
      let imageUrl = req.query.url as string;
      if (!imageUrl) {
        return res.status(400).send('URL is required');
      }

      if (imageUrl.startsWith('//')) {
        imageUrl = 'https:' + imageUrl;
      } else if (imageUrl.startsWith('/')) {
        imageUrl = 'https://www.lego.com' + imageUrl;
      }
      
      const response = await fetch(imageUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Referer': 'https://www.lego.com/'
        }
      });

      if (!response.ok) {
        console.error('Image proxy fetch error:', response.status, response.statusText, imageUrl);
        const transparentPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        return res.send(Buffer.from(transparentPngBase64, 'base64'));
      }

      const contentType = response.headers.get('content-type');
      res.setHeader('Content-Type', contentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      
      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch (error) {
      console.error('Image proxy error:', error);
      const transparentPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      return res.send(Buffer.from(transparentPngBase64, 'base64'));
    }
  });

  // API Route: Fetch Lego Set Info
  app.get('/api/lego/:setNumber', async (req, res) => {
    const { setNumber } = req.params;
    const skipImage = req.query.skipImage === 'true';
    
    const legoUrlHuf = `https://www.lego.com/hu-hu/product/${setNumber}`;
    const legoUrlEn = `https://www.lego.com/en-us/product/${setNumber}`;

    try {
      // 1. Try Brickset first
      try {
        const bricksetRes = await axios.get(`https://brickset.com/sets/${setNumber}-1`, { headers: getCommonHeaders(), timeout: 10000 });
        const $bs = cheerio.load(bricksetRes.data);
        
        const title = $bs('h1').text().trim();
        let name = title ? title.replace(/^\d+\s/, '') : '';

        let productImage = null;
        if (!skipImage) {
           productImage = $bs('a.highslide img').attr('src') || $bs('img[src*="images.brickset.com/sets/images"]').attr('src');
        }

        const rrpText = $bs('dt:contains("RRP")').next('dd').text();
        const eurMatch = rrpText.match(/€([\d.]+)/);
        const usdMatch = rrpText.match(/\$([\d.]+)/);
        
        let priceEur = 0;
        if (eurMatch) {
            priceEur = parseFloat(eurMatch[1]);
        } else if (usdMatch) {
            priceEur = parseFloat(usdMatch[1]) * 0.9;
        }

        let priceHuf = 0;
        if (priceEur > 0) {
           try {
              const ratesRes = await axios.get(`https://api.frankfurter.app/latest?from=EUR`, { timeout: 5000 });
              const eurToHuf = ratesRes.data.rates.HUF;
              if (eurToHuf) priceHuf = Math.round(priceEur * eurToHuf);
           } catch(e) {
              priceHuf = Math.round(priceEur * 395); 
           }
        }
        
        if (priceHuf > 0 || name) {
            console.log(`Brickset info fetched for ${setNumber}:`, { name, priceEur, priceHuf, image: productImage || null });
            return res.json({ name, priceHuf, image: productImage || null, url: legoUrlHuf });
        }
      } catch (bricksetError: any) {
        console.warn('Brickset scraping failed:', bricksetError.message);
      }

      const responseHu = await axios.get(legoUrlHuf, { headers: getCommonHeaders(), timeout: 10000 });
      const $hu = cheerio.load(responseHu.data);
      
      let priceText = $hu('span[data-test="product-price"]').first().text().trim();
      let priceHuf = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;
      if (priceHuf === 0) {
        priceHuf = parseInt($hu('meta[property="product:price:amount"]').attr('content') || '0', 10);
      }
      let productImage = null;
      if (!skipImage) {
        productImage = $hu('meta[property="og:image"]').attr('content');
        if (!productImage) {
          productImage = $hu('img[class*="ProductImage"]').first().attr('src');
        }
      }

      if (priceHuf === 0) {
        throw new Error("Price not found on Lego page (both span and meta were empty/0), trying fallback");
      }

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

      try {
        const imagePrompt = skipImage ? "" : "and the main product image URL. ";
        const imageJsonFormat = skipImage ? "" : ', "imageUrl": "string"';
        const prompt = `Search for Lego set ${setNumber}. ALWAYS find the official ENGLISH name, current HUF price, ${imagePrompt}If it's an unreleased set or not on lego.com, prioritize searching jaysbrickblog.com and brickfanatics.com to find information such as price (convert USD/EUR to HUF roughly), image, and release date. If you get the info from an unofficial source like jaysbrickblog or brickfanatics, set 'isTemporary' to true. Return ONLY a JSON object: { "name": "string", "priceHuf": 1234${imageJsonFormat}, "isTemporary": boolean, "releaseDate": "string | null" }.`;
        
        let text = '';
        const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'];
        let lastError: any;
        
        for (const model of models) {
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              console.log(`Trying model ${model} (attempt ${attempt}) for lego info...`);
              const result = await withTimeout(getGenAI().models.generateContent({
                model,
                contents: prompt,
                config: { tools: [{ googleSearch: {} }] }
              }), 15000);
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
                  lastError = { isRateLimit: true, retryAfter: waitSecs, message: e.message };
                  break; // Move to next model
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

  // API Route: Fetch prices dynamically based on sources for MULTIPLE SETS
  app.post('/api/prices-batch', async (req, res) => {
    const { setNumbers, sources } = req.body;
    
    if (!sources || !Array.isArray(sources) || sources.length === 0) {
       return res.status(400).json({ error: 'No price sources provided' });
    }
    if (!setNumbers || !Array.isArray(setNumbers) || setNumbers.length === 0) {
       return res.status(400).json({ error: 'No set numbers provided' });
    }

    try {
      const exRateRes = await axios.get('https://api.frankfurter.app/latest?from=EUR');
      const rates = Object.assign({}, exRateRes.data.rates, { EUR: 1 });
      const hufRate = rates.HUF;

      let expectedJsonFormat: any = {};
      
      let prompt = `Find the current lowest market prices for the following Lego sets across the listed sources.\n`;
      let needsGoogleSearch = true; // We always use Google Search for batch to avoid massive local html fetching
      
      for (const setNumber of setNumbers) {
         prompt += `\nSet Number: ${setNumber}\nSources:\n`;
         expectedJsonFormat[setNumber] = {};
         for (const s of sources) {
            prompt += `- "${s.id}": ${s.urlTemplate.replace('{setNumber}', setNumber)} (Expected currency: ${s.currency})\n`;
            expectedJsonFormat[setNumber][s.id] = { price: 0, store: `string (name of the specific store)` };
         }
      }

      prompt += `\nReturn ONLY a JSON object mapping each setNumber to its sources in this exact format:\n${JSON.stringify(expectedJsonFormat, null, 2)}`;

      const config: any = { tools: [{ googleSearch: {} }] };

      const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'];
      let text = '';
      let lastError: any;
      
      for (const model of models) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`[Batch] Trying model ${model} (attempt ${attempt}) for prices...`);
            const result = await withTimeout(getGenAI().models.generateContent({
              model,
              contents: prompt,
              config
            }), 25000); // Give it a bit more time for batch
            text = result.text || '';
            break;
          } catch (e: any) {
            lastError = e;
            console.warn(`[Batch] Model ${model} attempt ${attempt} failed:`, e.message);
          }
        }
        if (text) break;
      }

      if (!text) {
        throw lastError || new Error("All models failed");
      }

      const match = text.match(/```json\n([\s\S]*?)\n```/);
      if (match) text = match[1];
      else {
        const fallbackMatch = text.match(/\{[\s\S]*\}/);
        if (fallbackMatch) text = fallbackMatch[0];
      }

      let parsedBatch = JSON.parse(text);
      
      // Calculate HUF and formatting per item
      for (const setNumber of setNumbers) {
          if (parsedBatch[setNumber]) {
              const parsed = parsedBatch[setNumber];
              parsed.exchangeRate = hufRate;
              for (const s of sources) {
                 if (parsed[s.id]) {
                    const originalPrice = parsed[s.id].price;
                    if (originalPrice) {
                        const sourceCurrency = s.currency;
                        const sourceRate = rates[sourceCurrency] || 1;
                        const priceInEur = originalPrice / sourceRate;
                        parsed[s.id].priceHuf = Math.round(priceInEur * hufRate);
                        parsed[s.id].url = s.urlTemplate.replace('{setNumber}', setNumber);
                    }
                 }
              }
          }
      }

      res.json(parsedBatch);
    } catch (error) {
      console.error('Batch Price Error:', error);
      res.status(500).json({ error: 'Failed to fetch batch market prices. Make sure your GEMINI_API_KEY is valid.', details: error instanceof Error ? error.message : String(error) });
    }
  });

  // API Route: Fetch prices dynamically based on sources
  app.post('/api/prices/:setNumber', async (req, res) => {
    const { setNumber } = req.params;
    const { sources } = req.body;
    
    if (!sources || !Array.isArray(sources) || sources.length === 0) {
       return res.status(400).json({ error: 'No price sources provided' });
    }

    try {
      const exRateRes = await axios.get('https://api.frankfurter.app/latest?from=EUR');
      const rates = Object.assign({}, exRateRes.data.rates, { EUR: 1 });
      const hufRate = rates.HUF;

      let promptSources = sources.map((s: any) => `- "${s.id}": ${s.urlTemplate.replace('{setNumber}', setNumber)} (Expected currency: ${s.currency})`).join('\n');
      
      let expectedJsonFormat = sources.reduce((acc: any, s: any) => {
          acc[s.id] = { price: 0, store: `string (name of the specific store)` };
          return acc;
      }, {});

      // Use cheerio to fetch the content of each source URL directly if possible
      const fetchHTML = async (url: string) => {
         try {
            const res = await axios.get(url, { headers: getCommonHeaders(), timeout: 8000 });
            const $ = cheerio.load(res.data);
            $('script, style, svg, noscript, header, footer').remove();
            return $('body').text().replace(/\s+/g, ' ').substring(0, 30000); // pass up to 30k chars to context
         } catch (e) {
            return null;
         }
      };

      const sourceHtmlMap: any = {};
      await Promise.all(sources.map(async (s: any) => {
          const url = s.urlTemplate.replace('{setNumber}', setNumber);
          sourceHtmlMap[s.id] = await fetchHTML(url);
      }));

      let prompt = `Find the current lowest price for Lego set ${setNumber} on the following sources:\n`;
      let needsGoogleSearch = false;

      for (const s of sources) {
         prompt += `- "${s.id}": ${s.urlTemplate.replace('{setNumber}', setNumber)} (Expected currency: ${s.currency})\n`;
         if (sourceHtmlMap[s.id]) {
            prompt += `  Extracted webpage text for ${s.id} (use this to find the price):\n  """${sourceHtmlMap[s.id]}"""\n\n`;
         } else {
            prompt += `  (Could not fetch webpage locally. Use googleSearch to find the price for this source. Ensure you don't hallucinate prices.)\n\n`;
            needsGoogleSearch = true;
         }
      }

      prompt += `Return ONLY a JSON object in this exact format:\n${JSON.stringify(expectedJsonFormat, null, 2)}`;

      const config: any = {};
      if (needsGoogleSearch) {
          config.tools = [{ googleSearch: {} }];
      }

      const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'];
      let text = '';
      let lastError: any;
      
      for (const model of models) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`Trying model ${model} (attempt ${attempt}) for prices...`);
            const result = await withTimeout(getGenAI().models.generateContent({
              model,
              contents: prompt,
              config
            }), 15000);
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
                lastError = { isRateLimit: true, retryAfter: waitSecs, message: e.message };
                  break; // Move to next model
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
        const responseData: any = { exchangeRate: hufRate };
        
        for (const s of sources) {
            if (data[s.id]) {
                const p = data[s.id].price;
                const sourceRate = rates[s.currency] || 1;
                // Convert price to EUR first, then to HUF
                const priceEur = p / sourceRate;
                const priceHuf = priceEur * hufRate;
                
                responseData[s.id] = {
                    price: p, // in orginal currency
                    priceHuf: priceHuf,
                    priceEur: priceEur,
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

  // API Route: Fetch latest exchange rates
  app.get('/api/exchange-rates', async (req, res) => {
    try {
      const response = await axios.get(`https://api.frankfurter.app/latest?from=EUR`);
      res.json({ rates: response.data.rates });
    } catch (error) {
      console.error('Error fetching exchange rates:', error);
      res.status(500).json({ error: 'Failed to fetch exchange rates' });
    }
  });

  // API Route: Fetch historical exchange rate
  app.get('/api/exchange-rate/:date', async (req, res) => {
    const { date } = req.params;
    try {
      const response = await axios.get(`https://api.frankfurter.app/${date}?from=EUR`);
      res.json({ rates: response.data.rates });
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
