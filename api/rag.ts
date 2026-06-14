import { Document, VectorStoreIndex, Settings, BaseLLM } from "llamaindex";
import { BaseEmbedding } from "@llamaindex/core/embeddings";
import { ChatResponseChunk, LLMMetadata } from "@llamaindex/core/llms";
import { getTMDBParams, fetchFromTMDB } from "./tmdb.js";

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

function validateEnvironment(): void {
  // Safe startup log
  console.log("TMDB_BEARER_TOKEN:", process.env.TMDB_BEARER_TOKEN ? "present" : "missing");

  if (!process.env.TMDB_BEARER_TOKEN) {
    throw new Error(
      "TMDB_BEARER_TOKEN is missing. Check that .env is in the project root and the variable name is exactly TMDB_BEARER_TOKEN."
    );
  }

  const required = ["HF_TOKEN", "LLM_MODEL", "EMBEDDING_MODEL"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
      `Configure them in your .env file or Vercel dashboard.`
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch with automatic retry on transient 502/503/504 errors. */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  delay = 2000
): Promise<Response> {
  let lastResponse: Response | null = null;
  let lastError: any = null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastResponse = res;
        console.warn(
          `Hugging Face API returned transient status ${res.status}. ` +
          `Retrying in ${delay}ms… (Attempt ${i + 1}/${retries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      return res;
    } catch (err: any) {
      lastError = err;
      console.warn(
        `Fetch request attempt ${i + 1} failed: ${err.message}. Retrying in ${delay}ms…`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  if (lastError) throw lastError;
  return lastResponse || fetch(url, options);
}

/** Classify an HTTP status code into a human-friendly error category. */
function classifyHttpError(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return "Hugging Face API authentication failed. Verify your HF_TOKEN is valid.";
  }
  if (status === 429) {
    return "Hugging Face API rate limit exceeded. Please wait and retry.";
  }
  // Try to detect model-loading responses even on non-200 codes
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "estimated_time" in parsed) {
      return `Hugging Face model is loading (estimated ${Math.ceil(parsed.estimated_time)}s). Please retry shortly.`;
    }
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return `Hugging Face API error: ${parsed.error}`;
    }
  } catch {
    // not JSON — fall through
  }
  if (status === 502) {
    return "Hugging Face returned 502 Bad Gateway. The selected model is likely unavailable, overloaded, or too heavy for Serverless Inference. Use a smaller Hugging Face model such as HuggingFaceTB/SmolLM2-1.7B-Instruct.";
  }

  if (status === 503) {
    return "Hugging Face model is loading or temporarily unavailable. Retry shortly or use a smaller Hugging Face model.";
  }

  if (status === 504) {
    return "Hugging Face request timed out. The selected model may be too slow for Vercel serverless.";
  }

  return `Hugging Face API error: ${status} - ${body.slice(0, 200)}`;
}

// ---------------------------------------------------------------------------
// Custom LLM — Hugging Face Serverless Inference API
// ---------------------------------------------------------------------------

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
      structuredOutput: false,
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
        content: content,
      },
      raw: {},
    };
  }

  async *streamChat(messages: any[]): AsyncIterable<ChatResponseChunk> {
    const content = await this.callInference(messages);
    yield {
      raw: {},
      delta: content,
    };
  }

  private async callInference(messages: any[]): Promise<string> {
    const chatMessages = messages.map((msg: any) => ({
      role:
        msg.role === "system"
          ? "system"
          : msg.role === "assistant"
            ? "assistant"
            : "user",
      content:
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content),
    }));

    const url = "https://router.huggingface.co/v1/chat/completions";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };

    const model = this.model.includes(":") ? this.model : `${this.model}:fastest`;

    const res = await fetchWithRetry(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: chatMessages,
        max_tokens: 512,
        temperature: 0.1,
        stream: false,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(classifyHttpError(res.status, errorText));
    }

    const data = await res.json();

    if (data?.error) {
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : JSON.stringify(data.error).slice(0, 300)
      );
    }

    const text = data?.choices?.[0]?.message?.content;

    if (!text || typeof text !== "string") {
      throw new Error(
        `Hugging Face chat completion returned invalid response: ${JSON.stringify(data).slice(0, 300)}`
      );
    }

    return text
      .replace(/<\|im_end\|>/g, "")
      .replace(/<\|im_start\|>/g, "")
      .trim();
  }
}

// ---------------------------------------------------------------------------
// Custom Embedding — Hugging Face Serverless Inference API
// ---------------------------------------------------------------------------

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
    const textQuery =
      typeof query === "string"
        ? query
        : query?.content || String(query);
    const embeddings = await this.getEmbeddings([textQuery]);
    return embeddings[0];
  }

  private async getEmbeddings(inputs: string[]): Promise<number[][]> {
    const baseUrl =
      process.env.HF_ENDPOINT || "https://api-inference.huggingface.co";
    const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const url = `${cleanBaseUrl}/models/${this.model}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token && this.token.trim() !== "") {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetchWithRetry(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        inputs: inputs.length === 1 ? inputs[0] : inputs,
        options: { wait_for_model: true },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(classifyHttpError(res.status, errorText));
    }

    const data = await res.json();

    // Handle object-level errors (model loading, auth issues, etc.)
    if (data && typeof data === "object" && !Array.isArray(data)) {
      if ("error" in data) {
        const extra =
          "estimated_time" in data
            ? ` Model is loading (estimated ${Math.ceil(data.estimated_time)}s).`
            : "";
        throw new Error(
          `Hugging Face embedding error: ${data.error}.${extra}`
        );
      }
    }

    // --- Parse the various response shapes HF can return ---

    if (inputs.length === 1) {
      // Single input can come back as number[] or number[][] or number[][][]
      if (
        Array.isArray(data) &&
        data.length > 0 &&
        typeof data[0] === "number"
      ) {
        // Shape: number[] — a single flat embedding vector
        return [data];
      }
      if (
        Array.isArray(data) &&
        Array.isArray(data[0]) &&
        typeof data[0][0] === "number"
      ) {
        // Shape: number[][] — take the first row (sentence embedding)
        return [data[0]];
      }
      if (
        Array.isArray(data) &&
        Array.isArray(data[0]) &&
        Array.isArray(data[0][0]) &&
        typeof data[0][0][0] === "number"
      ) {
        // Shape: number[][][] — token-level; mean-pool across tokens
        const tokenVectors: number[][] = data[0];
        const dim = tokenVectors[0].length;
        const pooled = new Array(dim).fill(0);
        for (const vec of tokenVectors) {
          for (let i = 0; i < dim; i++) pooled[i] += vec[i];
        }
        for (let i = 0; i < dim; i++) pooled[i] /= tokenVectors.length;
        return [pooled];
      }
    } else {
      // Batch inputs
      if (
        Array.isArray(data) &&
        Array.isArray(data[0]) &&
        typeof data[0][0] === "number"
      ) {
        // Shape: number[][] — one flat vector per input
        return data as number[][];
      }
      if (
        Array.isArray(data) &&
        Array.isArray(data[0]) &&
        Array.isArray(data[0][0]) &&
        typeof data[0][0][0] === "number"
      ) {
        // Shape: number[][][] — token-level per input; mean-pool each
        return data.map((tokenVectors: number[][]) => {
          const dim = tokenVectors[0].length;
          const pooled = new Array(dim).fill(0);
          for (const vec of tokenVectors) {
            for (let i = 0; i < dim; i++) pooled[i] += vec[i];
          }
          for (let i = 0; i < dim; i++) pooled[i] /= tokenVectors.length;
          return pooled;
        });
      }
    }

    // If we get here, the response shape is completely unexpected — throw
    throw new Error(
      `Hugging Face embedding returned an unsupported response shape. ` +
      `Model: ${this.model}. Response preview: ${JSON.stringify(data).slice(0, 200)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Settings — Hugging Face only
// ---------------------------------------------------------------------------

export function setupSettings() {
  validateEnvironment();

  const llmModel = process.env.LLM_MODEL || "meta-llama/Llama-3.1-8B-Instruct:fastest";
  const hfToken = process.env.HF_TOKEN || "";
  const embedModelName = process.env.EMBEDDING_MODEL || "BAAI/bge-small-en-v1.5";

  console.log(`Configuring Hugging Face LLM: model "${llmModel}"`);
  Settings.llm = new HFLLM(llmModel, hfToken);

  console.log(`Configuring Hugging Face Embeddings: model "${embedModelName}"`);
  Settings.embedModel = new HFEmbedding(embedModelName, hfToken);
}

// ---------------------------------------------------------------------------
// Chat request handler (RAG pipeline)
// ---------------------------------------------------------------------------

export async function handleChatRequest(messages: any[]) {
  const latestMessage = messages[messages.length - 1].content;

  // 1. Condense Chat History
  let searchMessage = latestMessage;
  if (messages.length > 1) {
    const chatHistoryText = messages
      .slice(0, -1)
      .map(
        (m: any) =>
          `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
      )
      .join("\n");

    const condensationPrompt = `You are a helper that condenses chat history and a follow-up query into a single standalone query for movie database searches.
Given the following conversation history and the latest user query, rewrite the query to be a standalone, self-contained search query (in English) that captures all relevant terms (e.g. actors, directors, genres, themes) from the history.
Do NOT reply with anything other than the rewritten query itself.

Conversation History:
${chatHistoryText}

Latest User Query: ${latestMessage}
Standalone query:`;

    try {
      const response = await Settings.llm.complete({
        prompt: condensationPrompt,
      });
      searchMessage = response.text.trim();
      console.log("Condensed Search Query:", searchMessage);
    } catch (err: any) {
      console.error("Failed to condense query:", err);
      throw new Error(err.message || "Hugging Face failed during query condensation.");
    }
  }

  // 2. Extract TMDB parameters
  console.log("Parsing TMDB params for condensed query:", searchMessage);
  const tmdbParams = await getTMDBParams(searchMessage);
  console.log("TMDB Params:", tmdbParams);

  // 3. Cap movie count for Vercel timeout safety
  tmdbParams.number_of_movies_requested = Math.min(
    Math.max(tmdbParams.number_of_movies_requested || 10, 1),
    10
  );

  // 4. Fetch movies from TMDB
  const tmdbMovies = await fetchFromTMDB(tmdbParams);
  console.log(`Fetched ${tmdbMovies.length} movies from TMDB`);

  if (!tmdbMovies || tmdbMovies.length === 0) {
    return {
      reply:
        "I couldn't find any relevant movies in the database matching your query.",
      movies: [],
    };
  }

  // 5. Build RAG index dynamically — TMDB ID is embedded in document text
  const documents = tmdbMovies.map(
    (movie: any) =>
      new Document({
        text: `TMDB ID: ${movie.id}
Title: ${movie.title || movie.name}
Release Date: ${movie.release_date || movie.first_air_date}
Rating: ${movie.vote_average || "N/A"}/10
Popularity: ${movie.popularity}
${movie.person_job ? `Role for ${tmdbParams.person_name}: ${movie.person_job}` : ""}
Overview: ${movie.overview}`,
        metadata: {
          title: movie.title || movie.name,
          poster_path: movie.poster_path,
          tmdbId: String(movie.id),
        },
      })
  );

  const index = await VectorStoreIndex.fromDocuments(documents);

  const similarityTopK = tmdbMovies.length;
  const queryEngine = index.asQueryEngine({ similarityTopK });

  const prompt = `You are a helpful and expert movie recommendation assistant. Use the provided context to answer the user's movie query precisely and exhaustively. 
Important context for this search: The movies provided in the context were dynamically fetched from TMDB based on the user's query. 
Search Type used: "${tmdbParams.search_type}"
Associated Person (if any): "${tmdbParams.person_name || "N/A"}"
If the query asks for movies by a person, assume the provided movies are associated with that person.
If the user asks for a list or a specific number of movies, provide the details of the matching movies found in the context up to the requested amount.
Provide a friendly and structured conversational response.

At the very end of your response, on a final new line, output:
[RECOMMENDATIONS: id1, id2, ...]
where id1, id2 are the numeric TMDB IDs of the movies from the context that you recommended. Only include IDs of movies you actually suggested in your explanation.

Query: ${latestMessage}`;

  const response = await queryEngine.query({ query: prompt });
  let replyText =
    typeof response.response === "string"
      ? response.response
      : String(response.response);

  // 6. Extract recommendations based on IDs
  let recommendedIds: number[] = [];
  const recsRegex = /\[RECOMMENDATIONS:\s*([\d\s,]*?)\]/i;
  const recsMatch = replyText.match(recsRegex);
  if (recsMatch) {
    recommendedIds = recsMatch[1]
      .split(",")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id));
    replyText = replyText.replace(recsRegex, "").trim();
  }

  let matchedMovies = [];
  if (recommendedIds.length > 0) {
    matchedMovies = tmdbMovies.filter((movie: any) =>
      recommendedIds.includes(movie.id)
    );
  } else {
    matchedMovies = tmdbMovies.filter((movie: any) => {
      const title = movie.title || movie.name;
      if (!title || title.length <= 2) return false;
      const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escapedTitle}\\b`, "i");
      return regex.test(replyText);
    });
  }

  return {
    reply: replyText,
    movies: matchedMovies.map((m: any) => ({
      title: m.title || m.name,
      poster_path: m.poster_path,
      tmdbId: m.id,
      release_date: m.release_date || m.first_air_date,
      vote_average: m.vote_average,
      overview: m.overview,
    })),
    inferredParams: tmdbParams,
  };
}
