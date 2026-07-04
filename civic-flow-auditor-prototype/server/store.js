import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { createAuditRunBase, nowIso, parseAuditRun } from "../shared/audit-contract.js";
import { config } from "./config.js";
import { getDatabase } from "./database.js";

const auditCache = new Map();
const auditEvents = new EventEmitter();
auditEvents.setMaxListeners(100);

const safeAuditIdPattern = /^[a-zA-Z0-9_-]{3,96}$/;

export function assertSafeAuditId(auditId) {
  if (!safeAuditIdPattern.test(String(auditId || ""))) {
    throw new Error("Invalid audit id.");
  }
  return String(auditId);
}

export function assertSafeArtifactName(filename) {
  const safeName = path.basename(String(filename || ""));
  if (!safeName || safeName !== filename || safeName.includes("..")) {
    throw new Error("Invalid artifact path.");
  }
  return safeName;
}

export async function ensureStorageDir() {
  await fs.mkdir(config.storageDir, { recursive: true });
}

export function getRunDir(auditId) {
  const safeId = assertSafeAuditId(auditId);
  const resolved = path.resolve(config.storageDir, safeId);
  const storageRoot = path.resolve(config.storageDir);
  if (!resolved.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error("Invalid audit storage path.");
  }
  return resolved;
}

export function getArtifactPath(auditId, filename) {
  const runDir = getRunDir(auditId);
  const safeName = assertSafeArtifactName(filename);
  const resolved = path.resolve(runDir, safeName);
  if (!resolved.startsWith(`${runDir}${path.sep}`)) {
    throw new Error("Invalid artifact path.");
  }
  return resolved;
}

export function artifactUrl(auditId, filename) {
  return `/artifacts/${encodeURIComponent(assertSafeAuditId(auditId))}/${encodeURIComponent(assertSafeArtifactName(filename))}`;
}

export async function ensureRunDir(auditId) {
  const dir = getRunDir(auditId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function createStoredAuditRun({ id, url, depth }) {
  const run = {
    ...createAuditRunBase({ id, url, depth }),
    status: "queued",
    progress: 2,
    updatedAt: nowIso(),
  };
  await saveAuditRun(run);
  return run;
}

function rowToRun(row) {
  if (!row) return null;
  return parseAuditRun(JSON.parse(row.run_json));
}

async function loadBackupAuditRun(auditId) {
  const auditPath = path.join(getRunDir(auditId), "audit.json");
  const content = await fs.readFile(auditPath, "utf8");
  return parseAuditRun(JSON.parse(content));
}

export async function loadAuditRun(auditId) {
  const safeId = assertSafeAuditId(auditId);
  if (auditCache.has(safeId)) return auditCache.get(safeId);

  const db = getDatabase();
  const row = db.prepare("SELECT run_json FROM audit_runs WHERE id = ?").get(safeId);
  const dbRun = rowToRun(row);
  if (dbRun) {
    auditCache.set(safeId, dbRun);
    return dbRun;
  }

  const backupRun = await loadBackupAuditRun(safeId);
  await saveAuditRun(backupRun);
  return backupRun;
}

export async function saveAuditRun(run) {
  const parsed = parseAuditRun({ ...run, updatedAt: run.updatedAt || nowIso() });
  await ensureRunDir(parsed.id);

  const runJson = JSON.stringify(parsed, null, 2);
  await fs.writeFile(path.join(getRunDir(parsed.id), "audit.json"), `${runJson}\n`, "utf8");

  const db = getDatabase();
  db.prepare(
    `INSERT INTO audit_runs (
      id, url, depth, status, progress, pages_count, documents_count, findings_count,
      ai_provider, ai_model, ai_status, html_report_url, pdf_report_url,
      created_at, updated_at, run_json
    ) VALUES (
      @id, @url, @depth, @status, @progress, @pages_count, @documents_count, @findings_count,
      @ai_provider, @ai_model, @ai_status, @html_report_url, @pdf_report_url,
      @created_at, @updated_at, @run_json
    )
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      depth = excluded.depth,
      status = excluded.status,
      progress = excluded.progress,
      pages_count = excluded.pages_count,
      documents_count = excluded.documents_count,
      findings_count = excluded.findings_count,
      ai_provider = excluded.ai_provider,
      ai_model = excluded.ai_model,
      ai_status = excluded.ai_status,
      html_report_url = excluded.html_report_url,
      pdf_report_url = excluded.pdf_report_url,
      updated_at = excluded.updated_at,
      run_json = excluded.run_json`,
  ).run({
    id: parsed.id,
    url: parsed.url,
    depth: parsed.depth,
    status: parsed.status,
    progress: parsed.progress,
    pages_count: parsed.pages.length,
    documents_count: parsed.documents.length,
    findings_count: parsed.findings.length,
    ai_provider: parsed.ai.provider,
    ai_model: parsed.ai.model,
    ai_status: parsed.ai.status,
    html_report_url: parsed.artifacts?.htmlReportUrl || null,
    pdf_report_url: parsed.artifacts?.pdfReportUrl || null,
    created_at: parsed.createdAt,
    updated_at: parsed.updatedAt,
    run_json: runJson,
  });

  auditCache.set(parsed.id, parsed);
  auditEvents.emit(parsed.id, parsed);
  auditEvents.emit("history", parsed);
  return parsed;
}

export async function updateAuditRun(auditId, updater) {
  const current = await loadAuditRun(auditId);
  const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
  return saveAuditRun({ ...next, updatedAt: nowIso() });
}

export function subscribeAudit(auditId, listener) {
  const safeId = assertSafeAuditId(auditId);
  auditEvents.on(safeId, listener);
  return () => auditEvents.off(safeId, listener);
}

export function subscribeHistory(listener) {
  auditEvents.on("history", listener);
  return () => auditEvents.off("history", listener);
}

export async function listAuditIds() {
  await ensureStorageDir();
  const db = getDatabase();
  return db.prepare("SELECT id FROM audit_runs ORDER BY updated_at DESC").all().map((row) => row.id);
}

export async function listAuditSummaries({ limit = 50 } = {}) {
  await ensureStorageDir();
  const db = getDatabase();
  return db
    .prepare(
      `SELECT id, url, depth, status, progress, pages_count, documents_count, findings_count,
        ai_provider, ai_model, ai_status, html_report_url, pdf_report_url, created_at, updated_at
       FROM audit_runs
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Math.min(Number(limit) || 50, 100)))
    .map((row) => ({
      id: row.id,
      url: row.url,
      depth: row.depth,
      status: row.status,
      progress: row.progress,
      pages: row.pages_count,
      documents: row.documents_count,
      findings: row.findings_count,
      ai: {
        provider: row.ai_provider,
        model: row.ai_model,
        status: row.ai_status,
      },
      artifacts: {
        htmlReportUrl: row.html_report_url || undefined,
        pdfReportUrl: row.pdf_report_url || undefined,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}
