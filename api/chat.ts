import type { VercelRequest, VercelResponse } from "@vercel/node";
import { setupSettings, handleChatRequest } from "./rag.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip anything that looks like an API key or token from an error message. */
function sanitizeErrorMessage(msg: string): string {
  if (!msg) return "Unknown error";
  // Redact Bearer tokens, HF tokens, TMDB JWTs, generic API keys
  return msg
    .replace(/hf_[A-Za-z0-9]{20,}/g, "[REDACTED_HF_TOKEN]")
    .replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/sk-or-v1-[A-Za-z0-9]+/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+[^\s"]+/g, "Bearer [REDACTED]");
}

// ---------------------------------------------------------------------------
// Initialize LLM and Embedding settings once during serverless cold start
// ---------------------------------------------------------------------------

let settingsInitError: string | null = null;
try {
  setupSettings();
} catch (err: any) {
  settingsInitError = err.message || "Failed to initialize AI settings";
  console.error("Settings initialization failed:", settingsInitError);
}

// ---------------------------------------------------------------------------
// Vercel Serverless Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
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

  // If settings failed to initialize, return immediately
  if (settingsInitError) {
    return res.status(500).json({
      error: "Server configuration error",
      details: sanitizeErrorMessage(settingsInitError),
      provider: { llm: "huggingface", embedding: "huggingface" },
      environment: "production",
    });
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
    return res.status(500).json({
      error: "RAG request failed",
      details: sanitizeErrorMessage(error.message || "Failed to process chat"),
      provider: { llm: "huggingface", embedding: "huggingface" },
      environment: "production",
    });
  }
}
