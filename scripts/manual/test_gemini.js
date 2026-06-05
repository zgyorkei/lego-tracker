import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `Search for Lego set 71822. Try to find the official ENGLISH name, current HUF price, and the main product image URL. If it's an unreleased set or not on lego.com, prioritize searching jaysbrickblog.com to find information such as price (convert USD/EUR to HUF roughly), image, and release date. If you get the info from an unofficial source like jaysbrickblog, set 'isTemporary' to true. Return ONLY a JSON object: { "name": "string", "priceHuf": 1234, "imageUrl": "string", "isTemporary": boolean, "releaseDate": "string | null" }.`;
  
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] }
    });
    console.log("Response text:", result.text);
  } catch (err) {
    console.log("Error:", err);
  }
}
run();
