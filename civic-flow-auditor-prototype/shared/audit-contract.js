import { z } from "zod";

export const scanDepths = [
  { id: "quick", name: "Quick", detail: "Up to 3 pages", maxPages: 3 },
  { id: "standard", name: "Standard", detail: "Up to 10 pages", maxPages: 10 },
  { id: "form", name: "Form journey", detail: "Follow forms end-to-end", maxPages: 10 },
];

export const auditStatuses = ["idle", "queued", "validating", "scanning", "report-ready", "failed", "cancelled"];

export const safetyNotes = [
  "This is an accessibility assistance report, not legal certification.",
  "Automated testing cannot detect all accessibility issues.",
  "Human review with disabled users or accessibility professionals is recommended.",
  "The agent will not submit forms automatically.",
  "Auto-filled or suggested values are drafts and must be reviewed by the user.",
];

export const ScanDepthSchema = z.enum(scanDepths.map((depth) => depth.id));
export const AuditStatusSchema = z.enum(auditStatuses);

export const PageSnapshotSchema = z.object({
  url: z.string().url(),
  title: z.string().default(""),
  heading: z.string().default(""),
  textSample: z.string().default(""),
  links: z.array(z.object({ href: z.string(), text: z.string().default("") })).default([]),
  pdfs: z.array(z.object({ url: z.string(), text: z.string().default("") })).default([]),
  forms: z
    .array(
      z.object({
        name: z.string().default(""),
        action: z.string().default(""),
        method: z.string().default("get"),
        labels: z.array(z.string()).default([]),
        buttons: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  session: z.string().default("general"),
  sessionLabel: z.string().default("General info"),
  screenshotPath: z.string().optional(),
  screenshotUrl: z.string().optional(),
  scanned: z.boolean().default(false),
  error: z.string().optional(),
});

export const DocumentSnapshotSchema = z.object({
  url: z.string(),
  title: z.string().default("Document"),
  extractedText: z.string().default(""),
  textLength: z.number().default(0),
  imageOnly: z.boolean().default(false),
  summary: z.string().default(""),
  ocrText: z.string().default(""),
  ocrStatus: z.enum(["not-needed", "not-run", "complete", "unavailable", "failed"]).default("not-run"),
  ocrPages: z.number().default(0),
  matchedStage: z.string().default("pdf"),
  error: z.string().optional(),
});

export const StageSchema = z.object({
  id: z.string(),
  name: z.string(),
  pages: z.number().default(0),
  critical: z.number().default(0),
  serious: z.number().default(0),
  minor: z.number().default(0),
});

export const FindingSchema = z.object({
  id: z.string(),
  stage: z.string(),
  stageLabel: z.string(),
  title: z.string(),
  impact: z.string(),
  guideline: z.string(),
  severity: z.enum(["Critical", "High", "Medium", "Low"]),
  status: z.string().default("To do"),
  fix: z.string(),
  ticket: z.string(),
  url: z.string().optional(),
  selector: z.string().optional(),
  rule: z.string().optional(),
  evidenceScore: z.number().min(0).max(100).default(0),
  sourceSnippet: z.string().optional(),
  screenshotPath: z.string().optional(),
  screenshotUrl: z.string().optional(),
  issueBoxes: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
        label: z.string(),
      }),
    )
    .default([]),
});

export const AgentStepSchema = z.object({
  name: z.string(),
  detail: z.string(),
  status: z.enum(["queued", "running", "complete", "failed", "cancelled"]).default("queued"),
});

export const SkippedActionSchema = z.object({
  url: z.string().default(""),
  action: z.string(),
  reason: z.string(),
  method: z.string().optional(),
  stage: z.string().optional(),
  createdAt: z.string().optional(),
});

export const AiMetadataSchema = z
  .object({
    provider: z.enum(["none", "openrouter"]).default("none"),
    model: z.string().default("deterministic"),
    status: z.enum(["deterministic", "pending", "enhanced", "unavailable", "failed"]).default("deterministic"),
    generatedFields: z.array(z.string()).default([]),
    error: z.string().optional(),
    enhancedAt: z.string().optional(),
  })
  .default({ provider: "none", model: "deterministic", status: "deterministic", generatedFields: [] });

export const ScannerMetadataSchema = z
  .object({
    lighthouse: z
      .object({
        status: z.enum(["not-run", "complete", "unavailable", "failed"]).default("not-run"),
        accessibilityScore: z.number().min(0).max(100).optional(),
        error: z.string().optional(),
      })
      .default({ status: "not-run" }),
    ocr: z
      .object({
        status: z.enum(["not-run", "complete", "unavailable", "failed"]).default("not-run"),
        pagesLimit: z.number().default(2),
        documentsAttempted: z.number().default(0),
      })
      .default({ status: "not-run", pagesLimit: 2, documentsAttempted: 0 }),
  })
  .default({ lighthouse: { status: "not-run" }, ocr: { status: "not-run", pagesLimit: 2, documentsAttempted: 0 } });

export const AuditRunSchema = z.object({
  id: z.string(),
  url: z.string(),
  depth: ScanDepthSchema,
  status: AuditStatusSchema,
  progress: z.number().min(0).max(100).default(0),
  executiveSummary: z.string().default(""),
  pages: z.array(PageSnapshotSchema).default([]),
  documents: z.array(DocumentSnapshotSchema).default([]),
  stages: z.array(StageSchema).default([]),
  findings: z.array(FindingSchema).default([]),
  agentSteps: z.array(AgentStepSchema).default([]),
  ai: AiMetadataSchema,
  scanner: ScannerMetadataSchema,
  skippedActions: z.array(SkippedActionSchema).default([]),
  artifacts: z
    .object({
      htmlReportPath: z.string().optional(),
      htmlReportUrl: z.string().optional(),
      pdfReportPath: z.string().optional(),
      pdfReportUrl: z.string().optional(),
      screenshots: z.array(z.string()).default([]),
    })
    .default({ screenshots: [] }),
  safetyNotes: z.array(z.string()).default(safetyNotes),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export function nowIso() {
  return new Date().toISOString();
}

export function createAuditRunBase({ id, url, depth = "standard" }) {
  const timestamp = nowIso();

  return AuditRunSchema.parse({
    id,
    url,
    depth,
    status: "idle",
    progress: 0,
    executiveSummary: "",
    pages: [],
    documents: [],
    stages: [],
    findings: [],
    agentSteps: [],
    ai: { provider: "none", model: "deterministic", status: "deterministic", generatedFields: [] },
    scanner: { lighthouse: { status: "not-run" }, ocr: { status: "not-run", pagesLimit: 2, documentsAttempted: 0 } },
    skippedActions: [],
    artifacts: { screenshots: [] },
    safetyNotes,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function parseAuditRun(value) {
  return AuditRunSchema.parse(value);
}
