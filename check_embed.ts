import { GeminiEmbedding } from '@llamaindex/google';
import dotenv from 'dotenv';
dotenv.config();

async function testEmbed() {
  const embedModel = new GeminiEmbedding({ model: "gemini-embedding-2", apiKey: process.env.GEMINI_API_KEY });
  try {
    const res = await embedModel.getTextEmbeddings(["Test sequence"]);
    console.log("Embeddings:", res);
  } catch (e) {
    console.error(e);
  }
}
testEmbed();
