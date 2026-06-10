import { OpenAI } from "@llamaindex/openai";
import dotenv from "dotenv";

dotenv.config();

async function testOpenRouter() {
  const llm = new OpenAI({
    model: "nvidia/llama-nemotron-rerank-vl-1b-v2:free",
    apiKey: process.env.OPENROUTER_API_KEY,
    additionalSessionOptions: {
      baseURL: "https://openrouter.ai/api/v1",
    },
  });

  console.log("LLM config:", llm.model);

  try {
    const res = await llm.complete({ prompt: "Hello, what are you?" });
    console.log("Response:", res.text);
  } catch (e) {
    console.error("Error:", e);
  }
}

testOpenRouter();
