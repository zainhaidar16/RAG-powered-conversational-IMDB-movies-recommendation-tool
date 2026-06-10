import { GoogleGenAI } from '@google/genai';
import { GEMINI_EMBEDDING_MODEL } from '@llamaindex/google';
import dotenv from 'dotenv';
dotenv.config();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function list() {
  console.log("Def:", GEMINI_EMBEDDING_MODEL);
  const res = await ai.models.list();
  console.log(JSON.stringify(res, null, 2));
}
list();
