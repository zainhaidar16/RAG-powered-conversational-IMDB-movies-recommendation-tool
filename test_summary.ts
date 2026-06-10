import { Document, VectorStoreIndex, Settings } from "llamaindex";
import { OpenAI } from "@llamaindex/openai";
import { BaseEmbedding } from "@llamaindex/core/embeddings";
import dotenv from "dotenv";

dotenv.config();

class DummyEmbedding extends BaseEmbedding {
  async getTextEmbedding(text: string): Promise<number[]> {
    return Array(1536).fill(0.1);
  }
}

const llm = new OpenAI({
  model: "nvidia/nemotron-nano-9b-v2:free",
  apiKey: process.env.OPENROUTER_API_KEY || "dummy",
  additionalSessionOptions: {
    baseURL: "https://openrouter.ai/api/v1",
  },
});
Settings.llm = llm;
Settings.embedModel = new DummyEmbedding();

async function run() {
  const documents = [
    new Document({ text: "Movie: The Dark Knight, Rating: 9/10" })
  ];
  const index = await VectorStoreIndex.fromDocuments(documents);
  const engine = index.asQueryEngine({ similarityTopK: 10 });
  const res = await engine.query({ query: "What is the dark knight rating?" });
  console.log(res.toString());
}
run();
