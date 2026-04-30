import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = "hello";
  
  const modelsToTest = ['gemma-3-27b', 'gemma-3-27b-it', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-flash'];
  
  for (const model of modelsToTest) {
    try {
      console.log("Testing model:", model);
      const result = await ai.models.generateContent({
        model: model,
        contents: prompt
      });
      console.log("Success with", model);
    } catch (err) {
      console.log("Error with", model, ":", err.message);
    }
  }
}
run();
