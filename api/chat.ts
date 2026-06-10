import type { VercelRequest, VercelResponse } from "@vercel/node";
import { setupSettings, handleChatRequest } from "./rag.js";

// Initialize LLM and Embedding settings once during serverless cold start
setupSettings();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Add CORS headers
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  // Handle preflight options request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Invalid or empty messages history." });
    }

    const result = await handleChatRequest(messages);
    return res.status(200).json(result);
  } catch (error: any) {
    console.error("Vercel Serverless API error:", error);
    return res.status(500).json({ error: error.message || "Failed to process chat" });
  }
}
