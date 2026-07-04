import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

let db;

export function getDatabase() {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_runs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      depth TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      pages_count INTEGER NOT NULL DEFAULT 0,
      documents_count INTEGER NOT NULL DEFAULT 0,
      findings_count INTEGER NOT NULL DEFAULT 0,
      ai_provider TEXT NOT NULL DEFAULT 'none',
      ai_model TEXT NOT NULL DEFAULT 'deterministic',
      ai_status TEXT NOT NULL DEFAULT 'deterministic',
      html_report_url TEXT,
      pdf_report_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      run_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_runs_updated_at
      ON audit_runs(updated_at DESC);
  `);

  return db;
}

export function closeDatabase() {
  if (!db) return;
  db.close();
  db = undefined;
}
