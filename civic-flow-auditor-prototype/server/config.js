import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(serverDir, "..");

export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 8787),
  storageDir: path.resolve(projectRoot, process.env.AUDIT_STORAGE_DIR || ".audit-runs"),
  databasePath: path.resolve(projectRoot, process.env.AUDIT_DATABASE_PATH || path.join(process.env.AUDIT_STORAGE_DIR || ".audit-runs", "audits.sqlite")),
  maxPages: Number(process.env.MAX_PAGES || 10),
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_AUDITS || 1),
  aiProvider: process.env.AI_PROVIDER || "openrouter",
  openRouterApiKey: process.env.OPENROUTER_API_KEY || "",
  openRouterModel: process.env.OPENROUTER_MODEL || "openrouter/free",
  visionModel: process.env.VISION_MODEL || "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  textModel: process.env.TEXT_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free",
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS || 12000),
  enableLighthouse: process.env.ENABLE_LIGHTHOUSE === "1",
  enableOcr: process.env.ENABLE_OCR !== "0",
  corsOrigin: process.env.CORS_ORIGIN || "http://127.0.0.1:5173",
  serveStaticDist: process.env.SERVE_STATIC_DIST === "1" || process.env.NODE_ENV === "production",
};
