import { scanDepths } from "./audit-contract.js";

export const journeyStageOrder = [
  ["general", "General info"],
  ["login", "Login"],
  ["register", "Register"],
  ["personal", "Personal info"],
  ["verify", "Verification"],
  ["notify", "Notifications"],
  ["upload", "Document upload"],
  ["review", "Review and submit"],
  ["confirm", "Confirmation"],
  ["pdf", "Linked Documents"],
  ["document-scan", "Document Scan"],
];

const privateHostPatterns = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^\[?::1\]?$/i,
  /^\[?(fc|fd|fe80):/i,
  /^\[?::ffff:(127|10|192\.168|172\.(1[6-9]|2\d|3[0-1]))\./i,
];

export const severityOrder = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

export const scanTargetMs = 180000;

export const ruleSources = {
  adaWebRule: {
    label: "ADA Title II web and mobile accessibility rule",
    url: "https://www.ada.gov/resources/2024-03-08-web-rule/",
  },
  automatedLimit: {
    label: "W3C preliminary accessibility review guidance",
    url: "https://www.w3.org/WAI/test-evaluate/preliminary/",
  },
  wcag22: {
    label: "W3C WCAG 2.2 Recommendation",
    url: "https://www.w3.org/TR/WCAG22/",
  },
};

export function normalizeDepth(depth) {
  return scanDepths.some((item) => item.id === depth) ? depth : "standard";
}

export function depthToMaxPages(depth, hardLimit = 10) {
  const selected = scanDepths.find((item) => item.id === normalizeDepth(depth));
  return Math.min(selected?.maxPages || 10, hardLimit);
}

export function validatePublicUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "Enter a valid public http or https URL." };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "Only http and https URLs can be audited." };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: "URLs with embedded usernames or passwords are blocked." };
  }

  const hostname = parsed.hostname;
  if (privateHostPatterns.some((pattern) => pattern.test(hostname))) {
    return { ok: false, error: "Private, localhost, and internal network URLs are blocked for this demo." };
  }

  return { ok: true, url: parsed.href };
}

export function isSameDomainUrl(candidate, originUrl) {
  try {
    const candidateUrl = new URL(candidate, originUrl);
    const origin = new URL(originUrl);
    return candidateUrl.hostname === origin.hostname;
  } catch {
    return false;
  }
}

export function classifyJourney(input = {}) {
  const searchable = [
    input.url,
    input.title,
    input.heading,
    input.textSample,
    ...(input.forms || []).flatMap((form) => [...(form.labels || []), ...(form.buttons || [])]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(pdf|handbook|guide|manual|policy|document)\b/.test(searchable)) return stage("pdf");
  if (/\b(confirm|confirmation|receipt|success|complete)\b/.test(searchable)) return stage("confirm");
  if (/\b(review|submit|submission|apply now|finish)\b/.test(searchable)) return stage("review");
  if (/\b(upload|attachment|document|file)\b/.test(searchable)) return stage("upload");
  if (/\b(verify|verification|authentication|identity|2fa|code)\b/.test(searchable)) return stage("verify");
  if (/\b(notification|contact preference|email preference|sms|alerts?)\b/.test(searchable)) return stage("notify");
  if (/\b(personal|address|phone|birth|ssn|income|household)\b/.test(searchable)) return stage("personal");
  if (/\b(register|registration|sign up|create account|enroll)\b/.test(searchable)) return stage("register");
  if (/\b(login|log in|sign in|password)\b/.test(searchable)) return stage("login");

  return stage("general");
}

export function stage(stageId) {
  const found = journeyStageOrder.find(([id]) => id === stageId) || journeyStageOrder[0];
  return { id: found[0], label: found[1] };
}

export function mapAxeImpactToSeverity(impact) {
  switch (impact) {
    case "critical":
      return "Critical";
    case "serious":
      return "High";
    case "moderate":
      return "Medium";
    default:
      return "Low";
  }
}

export function sortFindingsBySeverity(findings = []) {
  return [...findings].sort((a, b) => {
    const severityDelta = (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    if (severityDelta) return severityDelta;
    const evidenceDelta = (b.evidenceScore || 0) - (a.evidenceScore || 0);
    if (evidenceDelta) return evidenceDelta;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

export function evidenceScoreForFinding(finding = {}) {
  let score = 20;
  if (finding.url) score += 15;
  if (finding.selector) score += 15;
  if (finding.sourceSnippet) score += 15;
  if (finding.screenshotPath || finding.screenshotUrl) score += 20;
  if (finding.issueBoxes?.length) score += 15;
  return Math.min(score, 100);
}

export function dedupeAndSortFindings(findings = []) {
  const seen = new Map();
  for (const finding of findings) {
    const normalized = {
      ...finding,
      rule: finding.rule || finding.guideline || finding.title,
    };
    normalized.evidenceScore = finding.evidenceScore || evidenceScoreForFinding(normalized);
    const key = [
      normalized.url || "",
      normalized.selector || "",
      normalized.rule || normalized.title || "",
    ]
      .map((part) => String(part).trim().toLowerCase())
      .join("|");
    const existing = seen.get(key);
    if (!existing || (normalized.evidenceScore || 0) > (existing.evidenceScore || 0)) {
      seen.set(key, normalized);
    }
  }
  return sortFindingsBySeverity([...seen.values()]).map((finding, index) => ({
    ...finding,
    id: finding.id || `AUD-${String(index + 1).padStart(3, "0")}`,
  }));
}

export function severityToStageBucket(severity) {
  if (severity === "Critical") return "critical";
  if (severity === "High") return "serious";
  return "minor";
}

export function guidelineFromTags(tags = []) {
  const wcagTag = tags.find((tag) => /^wcag\d+/i.test(tag));
  if (!wcagTag) return "WCAG review";
  const code = wcagTag.replace(/^wcag/i, "").split("").join(".");
  return `WCAG ${code}`;
}

export function guidelineRefsFor(guideline = "") {
  const refs = [];
  const match = String(guideline).match(/WCAG\s*(?:2\.\d\s*)?(\d+)\.(\d+)\.(\d+)/i);
  if (match) {
    refs.push({
      label: `WCAG Success Criterion ${match[1]}.${match[2]}.${match[3]}`,
      url: `https://www.w3.org/TR/WCAG22/#${match[1]}.${match[2]}.${match[3]}`,
    });
  } else if (/wcag/i.test(guideline)) {
    refs.push(ruleSources.wcag22);
  }
  refs.push(ruleSources.adaWebRule);
  return refs;
}

export function humanReviewNoteFor(guideline = "") {
  if (/Safety review/i.test(guideline)) {
    return "Human review is required before any public-service form is submitted or published.";
  }
  return "Automated checks and AI suggestions are assistance only; a qualified human accessibility review is still required.";
}

export function createTimingMetadata(startedAt, finishedAt = new Date().toISOString(), targetMs = scanTargetMs) {
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  const durationMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined;
  return {
    startedAt,
    finishedAt,
    durationMs,
    targetMs,
    withinTarget: typeof durationMs === "number" ? durationMs <= targetMs : undefined,
  };
}

export function inferStageFromText(text = "", fallbackStage = "pdf") {
  const searchable = String(text).toLowerCase();
  if (/\b(upload|attachment|attach|supporting document|proof of|photo id|identification)\b/.test(searchable)) return stage("upload");
  if (/\b(review|submit|submission|sign|signature|certify|declaration)\b/.test(searchable)) return stage("review");
  if (/\b(register|registration|create account|enroll|application form)\b/.test(searchable)) return stage("register");
  if (/\b(verify|verification|identity|authentication|code)\b/.test(searchable)) return stage("verify");
  if (/\b(confirm|confirmation|receipt|approved|complete)\b/.test(searchable)) return stage("confirm");
  if (/\b(address|phone|birth|income|household|personal information)\b/.test(searchable)) return stage("personal");
  if (/\b(notification|email|sms|contact preference|alert)\b/.test(searchable)) return stage("notify");
  return stage(fallbackStage);
}

export function matchDocumentToStage(document = {}, pages = []) {
  const sourcePage = pages.find((page) => document.sourcePageUrl && page.url === document.sourcePageUrl);
  const sourceStage = sourcePage?.session || "";
  const textStage = inferStageFromText([document.title, document.url, document.summary, document.extractedText].filter(Boolean).join(" "), sourceStage || "pdf");
  const matched = textStage.id !== "pdf" ? textStage : stage(sourceStage || document.matchedStage || "pdf");
  return {
    ...document,
    matchedStage: matched.id,
    matchedStageReason:
      matched.id === sourceStage
        ? `Matched to the source page stage: ${sourcePage?.sessionLabel || matched.label}.`
        : `Matched from document title, URL, or extracted instruction text: ${matched.label}.`,
  };
}

export function documentRegionFindingDefaults(region = {}) {
  const type = String(region.type || "Body Text");
  const text = String(region.text || "").trim();
  const notes = region.accessibility_notes || "This scanned document region needs manual accessibility review.";
  if (/Form Input|Signature/i.test(type)) {
    return {
      severity: "Critical",
      guideline: "WCAG 2.2 1.3.1",
      title: `${type} needs accessible labels and instructions`,
      impact: notes,
      fix: text
        ? `Convert this ${type.toLowerCase()} region into a tagged digital form control with a visible label, programmatic name, instructions, and extracted text preserved: "${text}".`
        : `Convert this ${type.toLowerCase()} region into a tagged digital form control with a visible label, programmatic name, and instructions.`,
    };
  }
  if (/Table/i.test(type)) {
    return {
      severity: "High",
      guideline: "WCAG 2.2 1.3.1",
      title: "Table structure needs tagged headers and reading order",
      impact: notes,
      fix: "Publish a digital table with header cells, row/column associations, and logical reading order.",
    };
  }
  if (/Header/i.test(type)) {
    return {
      severity: "Medium",
      guideline: "WCAG 2.2 2.4.6",
      title: "Document heading needs clear semantic structure",
      impact: notes,
      fix: "Use tagged headings that describe the form or notice section and preserve the visual hierarchy.",
    };
  }
  return {
    severity: "High",
    guideline: "WCAG 2.2 1.1.1",
    title: `${type} needs a digital text alternative`,
    impact: notes,
    fix: text
      ? `Provide selectable, tagged digital text for this region and preserve the reading order: "${text}".`
      : "Provide selectable, tagged digital text for this region and preserve the reading order.",
  };
}

export function summarizePdfText(text = "") {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "No extractable text was found.";
  return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
}

export function isImageOnlyPdfText(text = "") {
  return text.replace(/\s+/g, "").length < 40;
}

export function buildTicket({ title, description, guideline, severity, component }) {
  return [
    `Title: ${title}`,
    `Description: ${description}`,
    "Acceptance criteria: The affected resident journey can be completed with keyboard and screen-reader support.",
    `WCAG: ${guideline}`,
    `Priority: ${severity === "Critical" || severity === "High" ? "High" : "Medium"}`,
    `Component: ${component || "Public website"}`,
  ].join("\n");
}

export function createFinding({
  index,
  prefix = "AUD",
  page = {},
  stageId,
  stageLabel,
  title,
  impact,
  guideline,
  severity,
  fix,
  selector,
  sourceSnippet,
  issueBoxes = [],
  rule,
  guidelineRefs,
  humanReviewNote,
  matchedStageReason,
}) {
  const id = `${prefix}-${String(index).padStart(3, "0")}`;
  const component = stageLabel || page.sessionLabel || "Public website";
  const description = `${title}${page.url ? ` on ${page.url}` : ""}. ${impact}`;

  return {
    id,
    stage: stageId || page.session || "general",
    stageLabel: stageLabel || page.sessionLabel || "General info",
    title,
    impact,
    guideline,
    severity,
    status: "To do",
    fix,
    ticket: buildTicket({ title, description, guideline, severity, component }),
    url: page.url,
    selector,
    rule: rule || `${prefix}:${guideline}:${title}`,
    guidelineRefs: guidelineRefs || guidelineRefsFor(guideline),
    humanReviewNote: humanReviewNote || humanReviewNoteFor(guideline),
    matchedStageReason,
    sourceSnippet,
    screenshotPath: page.screenshotPath,
    screenshotUrl: page.screenshotUrl,
    issueBoxes,
    evidenceScore: 0,
  };
}

export function buildStagesFromPagesAndFindings(pages = [], documents = [], findings = []) {
  const pageCounts = new Map();
  for (const page of pages) {
    pageCounts.set(page.session || "general", (pageCounts.get(page.session || "general") || 0) + 1);
  }
  for (const document of documents) {
    const stageId = document.matchedStage || "pdf";
    pageCounts.set(stageId, (pageCounts.get(stageId) || 0) + 1);
  }

  const counts = new Map();
  for (const finding of findings) {
    const current = counts.get(finding.stage) || { critical: 0, serious: 0, minor: 0 };
    const bucket = severityToStageBucket(finding.severity);
    current[bucket] += 1;
    counts.set(finding.stage, current);
  }

  return journeyStageOrder
    .filter(([id]) => pageCounts.has(id) || counts.has(id))
    .map(([id, name]) => ({
      id,
      name,
      pages: pageCounts.get(id) || 0,
      critical: counts.get(id)?.critical || 0,
      serious: counts.get(id)?.serious || 0,
      minor: counts.get(id)?.minor || 0,
    }));
}
