import { Document, VectorStoreIndex, Settings, BaseLLM } from "llamaindex";
import { OpenAI } from "@llamaindex/openai";
import { OllamaEmbedding, Ollama } from "@llamaindex/ollama";
import { BaseEmbedding } from "@llamaindex/core/embeddings";
import { ChatResponseChunk, LLMMetadata } from "@llamaindex/core/llms";
import { getTMDBParams, fetchFromTMDB } from "./tmdb";

// Custom LLM Class for Hugging Face Serverless Inference API
export class HFLLM extends BaseLLM {
  model: string;
  token: string;
  metadata: LLMMetadata;

  constructor(model: string, token: string) {
    super();
    this.model = model;
    this.token = token;
    this.metadata = {
      model: model,
      temperature: 0.1,
      topP: 0.9,
      contextWindow: 4096,
      tokenizer: undefined,
      structuredOutput: false
    };
  }

  async chat(params: any): Promise<any> {
    if (params.stream) {
      return this.streamChat(params.messages);
    }
    
    const content = await this.callInference(params.messages);
    return {
      message: {
        role: "assistant",
        content: content
      },
      raw: {}
    };
  }

  async *streamChat(messages: any[]): AsyncIterable<ChatResponseChunk> {
    const content = await this.callInference(messages);
    yield {
      raw: {},
      delta: content
    };
  }

  private async callInference(messages: any[]): Promise<string> {
    let prompt = "";
    for (const msg of messages) {
      const roleName = msg.role === "user" ? "user" : (msg.role === "system" ? "system" : "assistant");
      const contentText = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      prompt += `<|im_start|>${roleName}\n${contentText}<|im_end|>\n`;
    }
    prompt += "<|im_start|>assistant\n";

    const url = `https://api-inference.huggingface.co/models/${this.model}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (this.token && this.token.trim() !== "") {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: 1024,
            temperature: 0.1,
            return_full_text: false
          },
          options: { wait_for_model: true }
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Hugging Face inference API error: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      let text = "";
      if (Array.isArray(data) && data[0] && typeof data[0].generated_text === "string") {
        text = data[0].generated_text;
      } else if (typeof data.generated_text === "string") {
        text = data.generated_text;
      } else {
        text = JSON.stringify(data);
      }

      return text.replace(/<\|im_end\|>/g, "").replace(/<\|im_start\|>/g, "").trim();
    } catch (error: any) {
      console.error("HF Inference API request failed:", error);
      throw error;
    }
  }
}

// Custom Embedding Class for Hugging Face Serverless Inference API
export class HFEmbedding extends BaseEmbedding {
  private model: string;
  private token: string;

  constructor(model: string, token: string) {
    super();
    this.model = model;
    this.token = token;
  }

  async getTextEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.getEmbeddings([text]);
    return embeddings[0];
  }

  async getQueryEmbedding(query: any): Promise<number[]> {
    const textQuery = typeof query === "string" ? query : (query?.content || String(query));
    const embeddings = await this.getEmbeddings([textQuery]);
    return embeddings[0];
  }

  private async getEmbeddings(inputs: string[]): Promise<number[][]> {
    const url = `https://api-inference.huggingface.co/models/${this.model}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token && this.token.trim() !== "") {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          inputs: inputs.length === 1 ? inputs[0] : inputs,
          options: { wait_for_model: true }
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Hugging Face embedding API error: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      
      if (inputs.length === 1) {
        if (Array.isArray(data) && typeof data[0] === "number") {
          return [data];
        } else if (Array.isArray(data) && Array.isArray(data[0]) && typeof data[0][0] === "number") {
          return [data[0]];
        }
      } else {
        if (Array.isArray(data) && Array.isArray(data[0]) && typeof data[0][0] === "number") {
          return data as number[][];
        } else if (Array.isArray(data) && Array.isArray(data[0]) && Array.isArray(data[0][0]) && typeof data[0][0][0] === "number") {
          return data.map((d: any) => d[0]);
        }
      }
      
      console.warn("Unexpected HF embedding data structure, using fallback dim 384:", data);
      return Array(inputs.length).fill(Array(384).fill(0.1));
    } catch (error) {
      console.error("HF embedding failed, falling back to dummy representation:", error);
      return Array(inputs.length).fill(Array(384).fill(0.1));
    }
  }
}

export function setupSettings() {
  const llmProvider = process.env.LLM_PROVIDER || "huggingface";
  const llmModel = process.env.LLM_MODEL || "Qwen/Qwen2.5-7B-Instruct";
  
  let llm;
  if (llmProvider.toLowerCase() === "ollama") {
    const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
    console.log(`Configuring Ollama LLM: model "${llmModel}" at "${ollamaHost}"`);
    llm = new Ollama({
      model: llmModel,
      config: {
        host: ollamaHost,
      }
    });
  } else if (llmProvider.toLowerCase() === "huggingface") {
    const hfToken = process.env.HF_TOKEN || "";
    console.log(`Configuring Hugging Face LLM (Custom HFLLM Wrapper): model "${llmModel}"`);
    llm = new HFLLM(llmModel, hfToken);
  } else {
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    console.log(`Configuring OpenRouter LLM: model "${llmModel}"`);
    llm = new OpenAI({
      model: llmModel,
      apiKey: openRouterApiKey || "sk-or-v1-dummy",
      additionalSessionOptions: {
        baseURL: "https://openrouter.ai/api/v1",
      },
    });
  }
  
  const embedProvider = process.env.EMBEDDING_PROVIDER || "huggingface";
  const embedModelName = process.env.EMBEDDING_MODEL || "BAAI/bge-small-en-v1.5";
  let embedModel;

  if (embedProvider.toLowerCase() === "ollama") {
    const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
    console.log(`Configuring Ollama Embeddings: model "${embedModelName}" at "${ollamaHost}"`);
    embedModel = new OllamaEmbedding({
      model: embedModelName,
      config: {
        host: ollamaHost,
      },
    });
  } else {
    const hfToken = process.env.HF_TOKEN || "";
    console.log(`Configuring Hugging Face Embeddings: model "${embedModelName}"`);
    embedModel = new HFEmbedding(embedModelName, hfToken);
  }

  Settings.llm = llm;
  Settings.embedModel = embedModel;
}

export async function handleChatRequest(messages: any[]) {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY || "";
  const latestMessage = messages[messages.length - 1].content;

  // 1. Condense Chat History
  let searchMessage = latestMessage;
  if (messages.length > 1) {
    const chatHistoryText = messages
      .slice(0, -1)
      .map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");
    
    const condensationPrompt = `You are a helper that condenses chat history and a follow-up query into a single standalone query for movie database searches.
Given the following conversation history and the latest user query, rewrite the query to be a standalone, self-contained search query (in English) that captures all relevant terms (e.g. actors, directors, genres, themes) from the history.
Do NOT reply with anything other than the rewritten query itself.

Conversation History:
${chatHistoryText}

Latest User Query: ${latestMessage}
Standalone query:`;

    try {
      const response = await Settings.llm.complete({ prompt: condensationPrompt });
      searchMessage = response.text.trim();
      console.log("Condensed Search Query:", searchMessage);
    } catch (err) {
      console.error("Failed to condense query, falling back to original message:", err);
    }
  }
  
  console.log("Parsing TMDB params for condensed query:", searchMessage);
  const tmdbParams = await getTMDBParams(searchMessage, openRouterApiKey);
  console.log("TMDB Params:", tmdbParams);
  
  const tmdbMovies = await fetchFromTMDB(tmdbParams);
  console.log(`Fetched ${tmdbMovies.length} movies from TMDB`);
  
  if (!tmdbMovies || tmdbMovies.length === 0) {
    return { 
      reply: "I couldn't find any relevant movies in the database matching your query.", 
      movies: [] 
    };
  }

  // 2. Build RAG index dynamically
  const documents = tmdbMovies.map((movie: any) => new Document({ 
    text: `Title: ${movie.title || movie.name}
Release Date: ${movie.release_date || movie.first_air_date}
Rating: ${movie.vote_average || 'N/A'}/10
Popularity: ${movie.popularity}
${movie.person_job ? `Role for ${tmdbParams.person_name}: ${movie.person_job}` : ''}
Overview: ${movie.overview}`,
    metadata: { title: movie.title || movie.name, poster_path: movie.poster_path, tmdbId: String(movie.id) }
  }));
  
  const index = await VectorStoreIndex.fromDocuments(documents);
  
  const similarityTopK = tmdbMovies.length;
  const queryEngine = index.asQueryEngine({ similarityTopK });
  
  const prompt = `You are a helpful and expert movie recommendation assistant. Use the provided context to answer the user's movie query precisely and exhaustively. 
Important context for this search: The movies provided in the context were dynamically fetched from TMDB based on the user's query. 
Search Type used: "${tmdbParams.search_type}"
Associated Person (if any): "${tmdbParams.person_name || 'N/A'}"
If the query asks for movies by a person, assume the provided movies are associated with that person.
If the user asks for a list or a specific number of movies, provide the details of the matching movies found in the context up to the requested amount.
Provide a friendly and structured conversational response.

At the very end of your response, on a final new line, output:
[RECOMMENDATIONS: id1, id2, ...]
where id1, id2 are the numeric TMDB IDs of the movies from the context that you recommended. Only include IDs of movies you actually suggested in your explanation.

Query: ${latestMessage}`;
  
  const response = await queryEngine.query({ query: prompt });
  let replyText = typeof response.response === "string" ? response.response : String(response.response);
  
  // 3. Extract recommendations based on IDs
  let recommendedIds: number[] = [];
  const recsRegex = /\[RECOMMENDATIONS:\s*([\d\s,]*?)\]/i;
  const recsMatch = replyText.match(recsRegex);
  if (recsMatch) {
    recommendedIds = recsMatch[1]
      .split(",")
      .map(id => parseInt(id.trim(), 10))
      .filter(id => !isNaN(id));
    replyText = replyText.replace(recsRegex, "").trim();
  }
  
  let matchedMovies = [];
  if (recommendedIds.length > 0) {
    matchedMovies = tmdbMovies.filter((movie: any) => recommendedIds.includes(movie.id));
  } else {
    matchedMovies = tmdbMovies.filter((movie: any) => {
      const title = movie.title || movie.name;
      if (!title || title.length <= 2) return false;
      const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedTitle}\\b`, "i");
      return regex.test(replyText);
    });
  }
  
  return { 
    reply: replyText, 
    movies: matchedMovies.map(m => ({
      title: m.title || m.name,
      poster_path: m.poster_path,
      tmdbId: m.id,
      release_date: m.release_date || m.first_air_date,
      vote_average: m.vote_average,
      overview: m.overview
    })),
    inferredParams: tmdbParams
  };
}
