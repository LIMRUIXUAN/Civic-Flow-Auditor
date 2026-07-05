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

export function canonicalPageUrl(url = "", baseUrl) {
  const value = String(url || "");
  if (!value) return "";
  try {
    const parsed = baseUrl ? new URL(value, baseUrl) : new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return value.split("#")[0];
  }
}

export function classifyJourney(input = {}) {
  const stageHints = [input.url, input.title, input.heading].filter(Boolean).join(" ").toLowerCase();
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

  if (/\.pdf($|[?#])/.test(stageHints) || /\b(pdf|handbook|manual|policy)\b/.test(stageHints)) return stage("pdf");
  if (/\b(confirm|confirmation|receipt|success|complete)\b/.test(searchable)) return stage("confirm");
  if (/\b(review|submit|submission|apply now|finish)\b/.test(searchable)) return stage("review");
  if (/\b(upload|attachment|attach|supporting document|proof of|photo id|identification|file upload)\b/.test(searchable)) return stage("upload");
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

function normalizeStageIdForUrl(stageId = "general", url = "") {
  const candidate = stage(stageId).id;
  if (candidate !== "pdf") return candidate;
  return /\.pdf($|[?#])/i.test(String(url || "")) ? "pdf" : classifyJourney({ url }).id;
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

function normalizeFindingPart(value = "") {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function canonicalFindingUrl(url = "") {
  const value = String(url || "");
  if (!value) return "";
  return canonicalPageUrl(value);
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const cleaned = String(value || "").trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

function uniqueIssueBoxes(values = []) {
  const seen = new Set();
  const result = [];
  for (const box of values) {
    if (!box) continue;
    const key = [box.x, box.y, box.width, box.height].map((part) => Math.round(Number(part || 0))).join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...box, label: String(result.length + 1) });
  }
  return result.slice(0, 8);
}

function duplicateFindingKey(finding = {}) {
  return [
    canonicalFindingUrl(finding.url),
    normalizeFindingPart(finding.stage),
    normalizeFindingPart(finding.rule || finding.guideline || finding.title),
    normalizeFindingPart(finding.guideline),
  ].join("|");
}

function mergeDuplicateFinding(existing, incoming) {
  const base = (incoming.evidenceScore || 0) > (existing.evidenceScore || 0) ? incoming : existing;
  const other = base === incoming ? existing : incoming;
  const baseSelectors = base.relatedSelectors?.length ? base.relatedSelectors : [base.selector];
  const otherSelectors = other.relatedSelectors?.length ? other.relatedSelectors : [other.selector];
  const relatedSelectors = uniqueStrings([
    ...baseSelectors,
    ...otherSelectors,
  ]);
  const occurrenceCount = Math.max(1, relatedSelectors.length || base.occurrenceCount || other.occurrenceCount || 1);
  const issueBoxes =
    base.screenshotUrl && other.screenshotUrl && base.screenshotUrl !== other.screenshotUrl
      ? uniqueIssueBoxes(base.issueBoxes || [])
      : uniqueIssueBoxes([...(base.issueBoxes || []), ...(other.issueBoxes || [])]);
  const selector = relatedSelectors.length > 1 ? `${relatedSelectors[0]} and ${relatedSelectors.length - 1} more` : relatedSelectors[0] || base.selector;
  const sourceSnippet =
    occurrenceCount > 1
      ? uniqueStrings([base.sourceSnippet, other.sourceSnippet]).slice(0, 2).join("\n\n")
      : base.sourceSnippet || other.sourceSnippet;
  const description = `${base.title}${base.url ? ` on ${canonicalFindingUrl(base.url)}` : ""}. ${base.impact} ${
    occurrenceCount > 1 ? `${occurrenceCount} affected selectors are grouped in this finding.` : ""
  }`;

  return {
    ...base,
    selector,
    sourceSnippet,
    issueBoxes,
    occurrenceCount,
    relatedSelectors,
    evidenceScore: Math.max(base.evidenceScore || 0, other.evidenceScore || 0),
    ticket: buildTicket({
      title: base.title,
      description,
      guideline: base.guideline,
      severity: base.severity,
      component: base.stageLabel || "Public website",
    }),
  };
}

function ensureUniqueFindingIds(findings = []) {
  const seen = new Map();
  return findings.map((finding, index) => {
    const fallbackPrefix = String(finding.id || "AUD").split("-")[0] || "AUD";
    const baseId = finding.id || `${fallbackPrefix}-${String(index + 1).padStart(3, "0")}`;
    const count = seen.get(baseId) || 0;
    seen.set(baseId, count + 1);
    return {
      ...finding,
      id: count ? `${baseId}-${count + 1}` : baseId,
    };
  });
}

export function buildIssueFlow(findings = [], selectedIssueId = "", selectedStage = "all") {
  const stageIssues = selectedStage === "all" ? findings : findings.filter((issue) => issue.stage === selectedStage);
  const issues = stageIssues.length ? stageIssues : findings;
  const currentIndex = issues.findIndex((issue) => issue.id === selectedIssueId);
  const safeIndex = currentIndex >= 0 ? currentIndex : issues.length ? 0 : -1;
  const currentIssue = safeIndex >= 0 ? issues[safeIndex] : null;

  return {
    issues,
    currentIssue,
    currentIndex: safeIndex,
    previousIssue: safeIndex > 0 ? issues[safeIndex - 1] : null,
    nextIssue: safeIndex >= 0 && safeIndex < issues.length - 1 ? issues[safeIndex + 1] : null,
    byId: new Map(
      issues.map((issue, index) => [
        issue.id,
        {
          id: issue.id,
          previousId: index > 0 ? issues[index - 1].id : null,
          nextId: index < issues.length - 1 ? issues[index + 1].id : null,
        },
      ]),
    ),
  };
}

export function getTopBlockerSummary(findings = [], stages = []) {
  const criticalCount = findings.filter((finding) => finding.severity === "Critical").length;
  const highCount = findings.filter((finding) => finding.severity === "High").length;
  const sorted = sortFindingsBySeverity(findings);
  const topFinding = sorted[0];

  if (!topFinding) {
    return {
      hasBlockers: false,
      topFinding: null,
      criticalCount,
      highCount,
      blockerCount: 0,
      affectedStage: "",
      affectedStageLabel: "No active blockers",
      recommendedNextAction: "Run a website audit or document scan to build the audit case.",
      summary: "No findings yet",
    };
  }

  const stageMatch = stages.find((stageItem) => stageItem.id === topFinding.stage);
  const affectedStageLabel = topFinding.stageLabel || stageMatch?.name || stage(topFinding.stage).label;
  const blockerCount = criticalCount + highCount;
  const severityAction =
    topFinding.severity === "Critical"
      ? "Resolve or assign this blocker before residents are asked to use this step."
      : topFinding.severity === "High"
        ? "Prioritize this issue in the next developer ticket batch."
        : "Review this issue after the critical and high blockers are triaged.";

  return {
    hasBlockers: true,
    topFinding,
    criticalCount,
    highCount,
    blockerCount,
    affectedStage: topFinding.stage,
    affectedStageLabel,
    recommendedNextAction: severityAction,
    summary: `${topFinding.severity}: ${topFinding.title}`,
  };
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
    const normalizedStageId = normalizeStageIdForUrl(finding.stage, finding.url);
    const normalized = {
      ...finding,
      stage: normalizedStageId,
      stageLabel: normalizedStageId === finding.stage ? finding.stageLabel : stage(normalizedStageId).label,
      rule: finding.rule || finding.guideline || finding.title,
    };
    normalized.evidenceScore = finding.evidenceScore || evidenceScoreForFinding(normalized);
    normalized.relatedSelectors = uniqueStrings([...(finding.relatedSelectors || []), finding.selector]);
    normalized.occurrenceCount = Math.max(1, normalized.relatedSelectors.length || finding.occurrenceCount || 1);
    const key = duplicateFindingKey(normalized);
    const existing = seen.get(key);
    if (!existing || (normalized.evidenceScore || 0) > (existing.evidenceScore || 0)) {
      seen.set(key, existing ? mergeDuplicateFinding(existing, normalized) : normalized);
    } else {
      seen.set(key, mergeDuplicateFinding(existing, normalized));
    }
  }
  return ensureUniqueFindingIds(sortFindingsBySeverity([...seen.values()]));
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
  const uniquePages = dedupePageSnapshots(pages);
  const pageCounts = new Map();
  for (const page of uniquePages) {
    const stageId = normalizeStageIdForUrl(page.session || "general", page.url);
    pageCounts.set(stageId, (pageCounts.get(stageId) || 0) + 1);
  }
  const documentCounts = new Map();
  for (const document of documents) {
    const stageId = document.matchedStage || "pdf";
    documentCounts.set(stageId, (documentCounts.get(stageId) || 0) + 1);
  }

  const counts = new Map();
  for (const finding of findings) {
    const current = counts.get(finding.stage) || { critical: 0, serious: 0, minor: 0 };
    const bucket = severityToStageBucket(finding.severity);
    current[bucket] += 1;
    counts.set(finding.stage, current);
  }

  return journeyStageOrder
    .filter(([id]) => pageCounts.has(id) || documentCounts.has(id) || counts.has(id))
    .map(([id, name]) => ({
      id,
      name,
      pages: pageCounts.get(id) || 0,
      documents: documentCounts.get(id) || 0,
      critical: counts.get(id)?.critical || 0,
      serious: counts.get(id)?.serious || 0,
      minor: counts.get(id)?.minor || 0,
    }));
}

export function dedupePageSnapshots(pages = []) {
  const seen = new Map();
  for (const page of pages) {
    const key = canonicalPageUrl(page?.url || "");
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...page, url: key });
      continue;
    }
    seen.set(key, {
      ...existing,
      ...page,
      url: key,
      scanned: Boolean(existing.scanned || page.scanned),
      links: existing.links?.length ? existing.links : page.links,
      pdfs: existing.pdfs?.length ? existing.pdfs : page.pdfs,
      forms: existing.forms?.length ? existing.forms : page.forms,
      screenshotPath: existing.screenshotPath || page.screenshotPath,
      screenshotUrl: existing.screenshotUrl || page.screenshotUrl,
      error: existing.error || page.error,
    });
  }
  return [...seen.values()];
}
