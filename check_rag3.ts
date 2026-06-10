import fs from 'fs';
import { Document, VectorStoreIndex, Settings } from 'llamaindex';
import { Gemini, GeminiEmbedding } from '@llamaindex/google';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const llm = new Gemini({ model: "gemini-1.5-flash", apiKey: process.env.GEMINI_API_KEY });
  Object.defineProperty(llm, 'metadata', {
    get: () => ({
      model: "gemini-1.5-flash",
      temperature: 0,
      topP: 1,
      contextWindow: 8192,
      tokenizer: undefined,
    }),
  });
  Settings.llm = llm;
  Settings.embedModel = new GeminiEmbedding({ model: "gemini-embedding-2", apiKey: process.env.GEMINI_API_KEY });
  
  // Monkey patch getTextEmbeddingsBatch which might be broken
  Settings.embedModel.getTextEmbeddingsBatch = async (texts) => {
    return await Settings.embedModel.getTextEmbeddings(texts);
  }
  Settings.embedModel.getTextEmbeddings = async (texts) => {
    // some embed models don't support batch well, map it manually
    const res = [];
    for (const text of texts) {
       const emb = await new GeminiEmbedding({ model: "gemini-embedding-2", apiKey: process.env.GEMINI_API_KEY }).getTextEmbeddings([text]);
       res.push(emb[0]);
    }
    return res;
  }

  const movies = JSON.parse(fs.readFileSync('./movies.json', 'utf-8'));
  const documents = movies.map((movie: any) => new Document({ text: JSON.stringify(movie) }));
  
  console.log('Indexing...');
  const index = await VectorStoreIndex.fromDocuments(documents);
  console.log('Indexed. Querying...');
  const queryEngine = index.asQueryEngine();
  const response = await queryEngine.query({ query: "Recommend me a sci-fi movie about dreams." });
  console.log(response.toString());
}
run().catch(console.error);
