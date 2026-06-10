import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Document, VectorStoreIndex, Settings } from "llamaindex";
import { OpenAI } from "@llamaindex/openai";
import { OllamaEmbedding } from "@llamaindex/ollama";
import dotenv from "dotenv";
import { getTMDBParams, fetchFromTMDB } from "./src/utils/tmdb";

dotenv.config();

function setupSettings() {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterApiKey) {
    console.warn("OPENROUTER_API_KEY is missing. Please add it to your secrets.");
  }
  
  const llm = new OpenAI({
    model: "nvidia/nemotron-nano-9b-v2:free",
    apiKey: openRouterApiKey || "sk-or-v1-dummy",
    additionalSessionOptions: {
      baseURL: "https://openrouter.ai/api/v1",
    },
  });
  
  const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL || "nomic-embed-text";
  
  console.log(`Configuring Ollama Embedding model: "${ollamaModel}" at "${ollamaHost}"`);
  const embedModel = new OllamaEmbedding({
    model: ollamaModel,
    config: {
      host: ollamaHost,
    },
  });

  Settings.llm = llm;
  Settings.embedModel = embedModel;
}

async function startServer() {
  setupSettings();
  
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.post("/api/chat", async (req, res) => {
    try {
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Invalid or empty messages history." });
      }

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
        return res.json({ 
            reply: "I couldn't find any relevant movies in the database matching your query.", 
            movies: [] 
        });
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
      
      // Perform actual retrieval filtering (retrieve only top semantically relevant items if we have a larger pool)
      const similarityTopK = Math.min(8, tmdbMovies.length);
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
        // Fallback regex matching (guarding short names like "Up", "Us" to prevent false positives)
        matchedMovies = tmdbMovies.filter((movie: any) => {
          const title = movie.title || movie.name;
          if (!title || title.length <= 2) return false;
          const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\b${escapedTitle}\\b`, "i");
          return regex.test(replyText);
        });
      }
      
      res.json({ 
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
      });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: error.message || "Failed to process chat" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
