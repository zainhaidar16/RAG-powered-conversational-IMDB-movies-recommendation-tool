import fs from 'fs';
import { Document, VectorStoreIndex, Settings } from 'llamaindex';
import { Gemini, GeminiEmbedding } from '@llamaindex/google';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  Settings.llm = new Gemini({ model: "gemini-2.0-flash", apiKey: process.env.GEMINI_API_KEY });
  Settings.embedModel = new GeminiEmbedding({ model: "gemini-embedding-2", apiKey: process.env.GEMINI_API_KEY });
  
  const movies = JSON.parse(fs.readFileSync('./movies.json', 'utf-8'));
  const documents = movies.map(movie => new Document({ text: JSON.stringify(movie) }));
  
  console.log('Indexing...');
  const index = await VectorStoreIndex.fromDocuments(documents);
  console.log('Indexed. Querying...');
  const queryEngine = index.asQueryEngine();
  const response = await queryEngine.query({ query: "Recommend me a sci-fi movie about dreams." });
  console.log(response.toString());
}
run().catch(console.error);
