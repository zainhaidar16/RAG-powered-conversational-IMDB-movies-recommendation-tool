import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Document, VectorStoreIndex, Settings } from "llamaindex";
import { GeminiEmbedding } from "@llamaindex/google";
import { OpenAI } from "@llamaindex/openai";
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
  
  Settings.llm = llm;
  Settings.embedModel = new GeminiEmbedding({ model: "gemini-embedding-2", apiKey: process.env.GEMINI_API_KEY });
  
  // Monkey patch broken batch embedding in llamaindex
  Settings.embedModel.getTextEmbeddingsBatch = async (texts) => {
    const res = [];
    for (const text of texts) {
       const embs = await Settings.embedModel.getTextEmbeddings([text]);
       res.push(embs[0]);
    }
    return res;
  };
}

async function startServer() {
  setupSettings();
  
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.post("/api/chat", async (req, res) => {
    try {
      const { message } = req.body;
      const openRouterApiKey = process.env.OPENROUTER_API_KEY || "";
      
      console.log("Parsing TMDB params for query:", message);
      const tmdbParams = await getTMDBParams(message, openRouterApiKey);
      console.log("TMDB Params:", tmdbParams);
      
      const tmdbMovies = await fetchFromTMDB(tmdbParams);
      console.log(`Fetched ${tmdbMovies.length} movies from TMDB`);
      
      if (!tmdbMovies || tmdbMovies.length === 0) {
        return res.json({ 
            reply: "I couldn't find any relevant movies in the database matching your query.", 
            movies: [] 
        });
      }

      // Build RAG index dynamically
      const documents = tmdbMovies.map((movie: any) => new Document({ 
        text: `Title: ${movie.title || movie.name}
Release Date: ${movie.release_date || movie.first_air_date}
Rating: ${movie.vote_average || 'N/A'}/10
Popularity: ${movie.popularity}
${movie.person_job ? `Role for ${tmdbParams.person_name}: ${movie.person_job}` : ''}
Overview: ${movie.overview}`,
        metadata: { title: movie.title || movie.name, poster_path: movie.poster_path }
      }));
      
      const index = await VectorStoreIndex.fromDocuments(documents);
      const queryEngine = index.asQueryEngine({ similarityTopK: tmdbMovies.length });
      
      const prompt = `You are a helpful and expert movie recommendation assistant. Use the provided context to answer the user's movie query precisely and exhaustively. 
Important context for this search: The movies provided in the context were dynamically fetched from TMDB based on the user's query. 
Search Type used: "${tmdbParams.search_type}"
Associated Person (if any): "${tmdbParams.person_name || 'N/A'}"
If the query asks for movies by a person, assume the provided movies are associated with that person.
If the user asks for a list or a specific number of movies (e.g. all movies directed by a person, top 10 movies), you MUST provide the FULL list of all matching movies found in the context up to the requested amount. Do not truncate the list to just a few examples. Provide the complete answer based on the context. If the context doesn't have the answer, decline politely. Query: ${message}`;
      
      const response = await queryEngine.query({ query: prompt });
      const replyText = typeof response.response === "string" ? response.response : String(response.response);
      
      const matchedMovies = tmdbMovies.filter((movie: any) => {
        const title = movie.title || movie.name;
        if (!title) return false;
        const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedTitle}\\b`, "i");
        return regex.test(replyText);
      });
      
      res.json({ reply: replyText, movies: matchedMovies.map(m => ({
          title: m.title || m.name,
          poster_path: m.poster_path,
          tmdbId: m.id,
          release_date: m.release_date || m.first_air_date,
          vote_average: m.vote_average,
          overview: m.overview
      })) });
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
