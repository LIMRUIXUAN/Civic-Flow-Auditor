import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(serverDir, "..");

dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 8787),
  storageDir: path.resolve(projectRoot, process.env.AUDIT_STORAGE_DIR || ".audit-runs"),
  databasePath: path.resolve(projectRoot, process.env.AUDIT_DATABASE_PATH || path.join(process.env.AUDIT_STORAGE_DIR || ".audit-runs", "audits.sqlite")),
  maxPages: Number(process.env.MAX_PAGES || 10),
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_AUDITS || 1),
  aiProvider: process.env.AI_PROVIDER || "google",
  googleApiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "",
  visionModel: process.env.VISION_MODEL || "gemini-2.0-flash",
  textModel: process.env.TEXT_MODEL || "gemini-2.0-flash",
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS || 20000),
  enableLighthouse: process.env.ENABLE_LIGHTHOUSE === "1",
  enableOcr: process.env.ENABLE_OCR !== "0",
  corsOrigin: process.env.CORS_ORIGIN || "http://127.0.0.1:5173",
  serveStaticDist: process.env.SERVE_STATIC_DIST === "1" || process.env.NODE_ENV === "production",
};
