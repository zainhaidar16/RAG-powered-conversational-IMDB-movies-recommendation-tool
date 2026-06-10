import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { setupSettings, handleChatRequest } from "./src/utils/rag.js";

async function startServer() {
  // Initialize LLM and Embedding settings
  setupSettings();
  
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API route delegating to shared RAG utility logic
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Invalid or empty messages history." });
      }

      const result = await handleChatRequest(messages);
      res.json(result);
    } catch (error: any) {
      console.error("Local server API error:", error);
      res.status(500).json({ error: error.message || "Failed to process chat" });
    }
  });

  // Serve Frontend
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
