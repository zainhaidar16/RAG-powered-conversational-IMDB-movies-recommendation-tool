import { Document, VectorStoreIndex, Settings, BaseLLM } from "llamaindex";
import { BaseEmbedding } from "@llamaindex/core/embeddings";
import { ChatResponseChunk, LLMMetadata } from "@llamaindex/core/llms";
import { getTMDBParams, fetchFromTMDB } from "./tmdb.js";

function validateEnvironment(): void {
  console.log("TMDB_BEARER_TOKEN:", process.env.TMDB_BEARER_TOKEN ? "present" : "missing");
  const required = ["TMDB_BEARER_TOKEN", "HF_TOKEN", "LLM_MODEL", "EMBEDDING_MODEL"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(", ")}.`);
}

function readableError(value: any): string {
  if (!value) return "Unknown Hugging Face error";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    if (typeof value.detail === "string") return value.detail;
    try { return JSON.stringify(value).slice(0, 500); } catch { return String(value); }
  }
  return String(value);
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 2000): Promise<Response> {
  let lastResponse: Response | null = null;
  let lastError: any = null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if ([502, 503, 504].includes(res.status)) {
        lastResponse = res;
        console.warn(`Hugging Face API returned transient status ${res.status}. Retrying in ${delay}ms. Attempt ${i + 1}/${retries}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      return res;
    } catch (err: any) {
      lastError = err;
      console.warn(`Fetch request attempt ${i + 1} failed: ${err.message}. Retrying in ${delay}ms.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  if (lastError) throw lastError;
  return lastResponse || fetch(url, options);
}

function classifyHttpError(status: number, body: string): string {
  let parsed: any = null;
  try { parsed = JSON.parse(body); } catch { parsed = null; }
  const message = parsed ? readableError(parsed.error || parsed.message || parsed.detail || parsed) : body.slice(0, 500);
  if (status === 401 || status === 403) return `Hugging Face authentication failed. Details: ${message}`;
  if (status === 429) return `Hugging Face rate limit exceeded. Details: ${message}`;
  if (status === 502) return `Hugging Face returned 502 Bad Gateway. Details: ${message}`;
  if (status === 503) return `Hugging Face model is loading or unavailable. Details: ${message}`;
  if (status === 504) return `Hugging Face request timed out. Details: ${message}`;
  return `Hugging Face API error ${status}: ${message}`;
}

function meanPool(tokenVectors: number[][]): number[] {
  const dim = tokenVectors[0].length;
  const pooled = new Array(dim).fill(0);
  for (const vec of tokenVectors) for (let i = 0; i < dim; i++) pooled[i] += vec[i];
  for (let i = 0; i < dim; i++) pooled[i] /= tokenVectors.length;
  return pooled;
}

function parseEmbeddingResponse(data: any, inputCount: number, model: string): number[][] {
  if (data && typeof data === "object" && !Array.isArray(data) && "error" in data) throw new Error(`Hugging Face embedding error: ${readableError(data.error)}`);
  if (inputCount === 1) {
    if (Array.isArray(data) && typeof data[0] === "number") return [data];
    if (Array.isArray(data) && Array.isArray(data[0]) && typeof data[0][0] === "number") return [data[0]];
    if (Array.isArray(data) && Array.isArray(data[0]) && Array.isArray(data[0][0]) && typeof data[0][0][0] === "number") return [meanPool(data[0])];
  } else {
    if (Array.isArray(data) && Array.isArray(data[0]) && typeof data[0][0] === "number") return data as number[][];
    if (Array.isArray(data) && Array.isArray(data[0]) && Array.isArray(data[0][0]) && typeof data[0][0][0] === "number") return data.map((tokens: number[][]) => meanPool(tokens));
  }
  throw new Error(`Unsupported embedding response from ${model}: ${JSON.stringify(data).slice(0, 200)}`);
}

export class HFLLM extends BaseLLM {
  model: string;
  token: string;
  metadata: LLMMetadata;
  constructor(model: string, token: string) {
    super();
    this.model = model;
    this.token = token;
    this.metadata = { model, temperature: 0.1, topP: 0.9, contextWindow: 4096, tokenizer: undefined, structuredOutput: false };
  }
  async chat(params: any): Promise<any> {
    const content = await this.callInference(params.messages);
    return { message: { role: "assistant", content }, raw: {} };
  }
  async *streamChat(messages: any[]): AsyncIterable<ChatResponseChunk> {
    const content = await this.callInference(messages);
    yield { raw: {}, delta: content };
  }
  private async callInference(messages: any[]): Promise<string> {
    const chatMessages = messages.map((msg: any) => ({ role: msg.role === "system" ? "system" : msg.role === "assistant" ? "assistant" : "user", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) }));
    const headers = { "Content-Type": "application/json", Authorization: "Bearer " + this.token };
    const requested = this.model.includes(":") ? this.model : this.model + ":fastest";
    const models = Array.from(new Set([requested, "meta-llama/Llama-3.1-8B-Instruct:fastest", "Qwen/Qwen2.5-7B-Instruct:fastest"]));
    let lastError: Error | null = null;
    for (const model of models) {
      console.log(`Using Hugging Face Router chat completions with model "${model}"`);
      try {
        const res = await fetchWithRetry("https://router.huggingface.co/v1/chat/completions", { method: "POST", headers, body: JSON.stringify({ model, messages: chatMessages, max_tokens: 1200, temperature: 0.1, stream: false }) });
        if (!res.ok) {
          const message = classifyHttpError(res.status, await res.text());
          const err = new Error(message);
          if ([401, 403, 429].includes(res.status)) throw err;
          console.warn(`Hugging Face model "${model}" failed: ${message}`);
          lastError = err;
          continue;
        }
        const data = await res.json();
        if (data?.error) throw new Error(readableError(data.error));
        const text = data?.choices?.[0]?.message?.content;
        if (!text || typeof text !== "string") throw new Error(`Invalid chat response: ${JSON.stringify(data).slice(0, 300)}`);
        return text.replace(/<\|im_end\|>/g, "").replace(/<\|im_start\|>/g, "").trim();
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`Hugging Face model "${model}" request failed: ${lastError.message}`);
      }
    }
    throw lastError || new Error("All Hugging Face chat models failed.");
  }
}

export class HFEmbedding extends BaseEmbedding {
  private model: string;
  private token: string;
  private activeModel: string | null = null;
  constructor(model: string, token: string) {
    super();
    this.model = model;
    this.token = token;
  }
  async getTextEmbedding(text: string): Promise<number[]> { return (await this.getEmbeddings([text]))[0]; }
  async getQueryEmbedding(query: any): Promise<number[]> {
    const text = typeof query === "string" ? query : query?.content || String(query);
    return (await this.getEmbeddings([text]))[0];
  }
  private async getEmbeddings(inputs: string[]): Promise<number[][]> {
    const headers = { "Content-Type": "application/json", Authorization: "Bearer " + this.token };
    const models = Array.from(new Set([this.activeModel || this.model, "sentence-transformers/all-MiniLM-L6-v2", "BAAI/bge-small-en-v1.5"]));
    let lastError: Error | null = null;
    for (const model of models) {
      const encoded = model.split("/").map(encodeURIComponent).join("/");
      const urls = [`https://router.huggingface.co/hf-inference/models/${encoded}/pipeline/feature-extraction`, `https://api-inference.huggingface.co/models/${encoded}`];
      for (const url of urls) {
        console.log(`Using Hugging Face embeddings with model "${model}" via ${url.includes("router.huggingface.co") ? "router" : "api-inference"}`);
        try {
          const res = await fetchWithRetry(url, { method: "POST", headers, body: JSON.stringify({ inputs: inputs.length === 1 ? inputs[0] : inputs, options: { wait_for_model: true } }) });
          if (!res.ok) {
            const message = classifyHttpError(res.status, await res.text());
            const err = new Error(message);
            if ([401, 403, 429].includes(res.status)) throw err;
            console.warn(`Hugging Face embedding model "${model}" failed: ${message}`);
            lastError = err;
            continue;
          }
          const parsed = parseEmbeddingResponse(await res.json(), inputs.length, model);
          this.activeModel = model;
          console.log(`Hugging Face embeddings working with model "${model}"`);
          return parsed;
        } catch (err: any) {
          lastError = err instanceof Error ? err : new Error(String(err));
          console.warn(`Hugging Face embedding model "${model}" request failed: ${lastError.message}`);
        }
      }
    }
    throw lastError || new Error("All Hugging Face embedding models failed.");
  }
}

export function setupSettings() {
  validateEnvironment();
  const llmModel = process.env.LLM_MODEL || "meta-llama/Llama-3.1-8B-Instruct:fastest";
  const hfToken = process.env.HF_TOKEN || "";
  const embedModelName = process.env.EMBEDDING_MODEL || "sentence-transformers/all-MiniLM-L6-v2";
  console.log(`Configuring Hugging Face LLM: model "${llmModel}"`);
  Settings.llm = new HFLLM(llmModel, hfToken);
  console.log(`Configuring Hugging Face Embeddings: model "${embedModelName}"`);
  Settings.embedModel = new HFEmbedding(embedModelName, hfToken);
}

function buildMoviePayload(movie: any) {
  return {
    title: movie.title || movie.name,
    poster_path: movie.poster_path,
    tmdbId: movie.id,
    release_date: movie.release_date || movie.first_air_date,
    vote_average: movie.vote_average,
    overview: movie.overview,
  };
}

function shouldReturnAllFetchedMovies(params: any, latestMessage: string): boolean {
  const text = latestMessage.toLowerCase();
  return params?.search_type === "person" || text.includes("all") || text.includes("list") || text.includes("show me") || text.includes("directed") || text.includes("starring");
}

export async function handleChatRequest(messages: any[]) {
  const latestMessage = messages[messages.length - 1].content;
  let searchMessage = latestMessage;

  if (messages.length > 1) {
    const chatHistoryText = messages.slice(0, -1).map((m: any) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
    const condensationPrompt = `You are a helper that condenses chat history and a follow-up query into a single standalone query for movie database searches.\nGiven the following conversation history and the latest user query, rewrite the query to be a standalone, self-contained search query in English.\nDo NOT reply with anything other than the rewritten query itself.\n\nConversation History:\n${chatHistoryText}\n\nLatest User Query: ${latestMessage}\nStandalone query:`;
    try {
      const response = await Settings.llm.complete({ prompt: condensationPrompt });
      searchMessage = response.text.trim();
      console.log("Condensed Search Query:", searchMessage);
    } catch (err: any) {
      console.error("Failed to condense query:", err);
      throw new Error(err.message || "Hugging Face failed during query condensation.");
    }
  }

  console.log("Parsing TMDB params for condensed query:", searchMessage);
  const tmdbParams = await getTMDBParams(searchMessage);
  console.log("TMDB Params:", tmdbParams);

  const tmdbMovies = await fetchFromTMDB(tmdbParams);
  console.log(`Fetched ${tmdbMovies.length} movies from TMDB`);

  if (!tmdbMovies || tmdbMovies.length === 0) {
    return { reply: `I couldn't find matching movies in TMDB for this query.`, movies: [], inferredParams: tmdbParams };
  }

  const documents = tmdbMovies.map((movie: any) => new Document({
    text: `TMDB ID: ${movie.id}\nTitle: ${movie.title || movie.name}\nRelease Date: ${movie.release_date || movie.first_air_date}\nRating: ${movie.vote_average || "N/A"}/10\nPopularity: ${movie.popularity}\nPerson: ${tmdbParams.person_name || "N/A"}\nPerson Role: ${movie.person_job || "N/A"}\nOverview: ${movie.overview}`,
    metadata: { title: movie.title || movie.name, poster_path: movie.poster_path, tmdbId: String(movie.id), person_job: movie.person_job || "" },
  }));

  const index = await VectorStoreIndex.fromDocuments(documents);
  const queryEngine = index.asQueryEngine({ similarityTopK: tmdbMovies.length });
  const allowedIds = tmdbMovies.map((movie: any) => movie.id).join(", ");
  const movieList = tmdbMovies.map((movie: any) => `- ${movie.title || movie.name} (${movie.release_date || movie.first_air_date || "N/A"}), TMDB ID ${movie.id}, rating ${movie.vote_average || "N/A"}, role ${movie.person_job || "N/A"}`).join("\n");
  const roleRule = tmdbParams.search_type === "person" ? `\nThe TMDB fetch already applied the correct person role filter. If person_role is director, every movie in the list is directed by ${tmdbParams.person_name}. If person_role is actor, every movie in the list features ${tmdbParams.person_name}.` : "";
  const prompt = `You are a RAG movie assistant. Answer ONLY from the retrieved TMDB context and allowed movie list.\nDo not recommend or mention any movie outside the allowed list.\nAllowed TMDB IDs: ${allowedIds}\nSearch Type: ${tmdbParams.search_type}\nPerson: ${tmdbParams.person_name || "N/A"}\nPerson Role: ${tmdbParams.person_role || "N/A"}${roleRule}\n\nAllowed movie list:\n${movieList}\n\nAnswer the user's question accurately. If the user asks for all movies, a list, directed movies, actor movies, or a person filmography, include the full allowed list. Do not randomly shorten it to 3 or 5 results.\nAt the end, output exactly one line:\n[RECOMMENDATIONS: id1, id2, ...]\nOnly include TMDB IDs from the allowed list.\n\nUser query: ${latestMessage}`;

  const response = await queryEngine.query({ query: prompt });
  let replyText = typeof response.response === "string" ? response.response : String(response.response);

  let recommendedIds: number[] = [];
  const recsRegex = /\[RECOMMENDATIONS:\s*([\d\s,]*?)\]/i;
  const recsMatch = replyText.match(recsRegex);
  if (recsMatch) {
    recommendedIds = recsMatch[1].split(",").map((id) => parseInt(id.trim(), 10)).filter((id) => tmdbMovies.some((movie: any) => movie.id === id));
    replyText = replyText.replace(recsRegex, "").trim();
  }

  const matchedMovies = shouldReturnAllFetchedMovies(tmdbParams, latestMessage)
    ? tmdbMovies
    : recommendedIds.length > 0
      ? tmdbMovies.filter((movie: any) => recommendedIds.includes(movie.id))
      : tmdbMovies;

  return {
    reply: replyText,
    movies: matchedMovies.map(buildMoviePayload),
    inferredParams: tmdbParams,
  };
}
