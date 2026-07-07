import { nanoid } from "nanoid";
import {
  buildTicket,
  createFinding,
  documentRegionFindingDefaults,
  guidelineRefsFor,
  humanReviewNoteFor,
} from "../shared/audit-utils.js";
import { config } from "./config.js";
import { geminiJson, textPart } from "./gemini.js";

function clipped(value = "", limit = 900) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, limit);
}

async function enhanceDocumentRegionsWithTextModel(regions, { fetchImpl = fetch } = {}) {
  if (config.aiProvider !== "google" || !config.googleApiKey) {
    return { status: "unavailable", regions: [] };
  }

  const systemInstruction =
    "You are refining document accessibility findings from vision-region JSON. Return ONLY a JSON " +
    "object with a `regions` array. Preserve region labels and coordinates. Do not invent new regions. " +
    "Never claim legal certification. For each region choose the most relevant WCAG 2.2 criterion, " +
    "severity, plain-language resident impact, and remediation fix. Each region object: " +
    "{label, title, severity (Critical|High|Medium|Low), guideline (WCAG 2.2 x.x.x), impact, fix, humanReviewNote}.";

  const userText = JSON.stringify({
    task: "Refine the regions per your instructions. Keep findings concise.",
    regions: regions.map((region) => ({
      label: region.label,
      type: region.type,
      text: clipped(region.text, 500),
      accessibility_notes: clipped(region.accessibility_notes, 500),
    })),
  });

  try {
    const parsed = await geminiJson({
      model: config.textModel,
      systemInstruction,
      parts: [textPart(userText)],
      temperature: 0.2,
      fetchImpl,
    });
    return { status: "enhanced", regions: Array.isArray(parsed.regions) ? parsed.regions : [] };
  } catch (error) {
    return {
      status: "failed",
      regions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function severityOrFallback(value, fallback) {
  return ["Critical", "High", "Medium", "Low"].includes(value) ? value : fallback;
}

export async function buildDocumentScanFindings({
  regions = [],
  croppedImageUrl,
  croppedImagePath,
  filename = "Scanned document",
  fetchImpl = fetch,
} = {}) {
  const ai = await enhanceDocumentRegionsWithTextModel(regions, { fetchImpl });
  const aiByLabel = new Map(ai.regions.map((region) => [String(region.label), region]));
  const prefix = `DOC-${nanoid(5)}`;

  const findings = regions.map((region, index) => {
    const fallback = documentRegionFindingDefaults(region);
    const rewrite = aiByLabel.get(String(region.label || index + 1));
    const guideline = rewrite?.guideline || fallback.guideline;
    const severity = severityOrFallback(rewrite?.severity, fallback.severity);

    return createFinding({
      index: index + 1,
      prefix,
      page: {
        url: croppedImageUrl,
        session: "document-scan",
        sessionLabel: "Document Scan",
        screenshotPath: croppedImagePath,
        screenshotUrl: croppedImageUrl,
      },
      title: clipped(rewrite?.title || fallback.title, 180),
      impact: clipped(rewrite?.impact || fallback.impact, 900),
      guideline,
      severity,
      fix: clipped(rewrite?.fix || fallback.fix, 900),
      selector: `${filename} region ${region.label || index + 1}`,
      sourceSnippet: region.text || "",
      issueBoxes: [
        {
          x: Number(region.x || 0),
          y: Number(region.y || 0),
          width: Number(region.width || 0),
          height: Number(region.height || 0),
          label: String(region.label || index + 1),
        },
      ],
      rule: `document-region:${region.type || "unknown"}:${guideline}`,
      guidelineRefs: guidelineRefsFor(guideline),
      humanReviewNote: rewrite?.humanReviewNote || humanReviewNoteFor(guideline),
    });
  });

  return {
    findings,
    aiReasoning: {
      provider: config.aiProvider === "google" ? "google" : "none",
      model: config.aiProvider === "google" ? config.textModel : "deterministic",
      status: ai.status,
      error: ai.error,
    },
  };
}

export async function buildRefinedDocumentFindingPatch({
  region = {},
  refinedResult = {},
  filename = "Scanned document",
  findingId,
  croppedImageUrl,
  croppedImagePath,
  fetchImpl = fetch,
} = {}) {
  const refinedRegion = {
    ...region,
    label: region.label || "1",
    type: refinedResult.type || region.type || "Body Text",
    text: refinedResult.extracted_text || refinedResult.text || region.text || "",
    accessibility_notes:
      refinedResult.detailed_accessibility_evaluation ||
      refinedResult.accessibility_notes ||
      region.accessibility_notes ||
      "Requires manual inspection.",
  };

  const { findings, aiReasoning } = await buildDocumentScanFindings({
    regions: [refinedRegion],
    croppedImageUrl,
    croppedImagePath,
    filename,
    fetchImpl,
  });

  const finding = findings[0];
  const deterministicFix = clipped(refinedResult.remediation_fix || finding.fix, 900);
  const fix = aiReasoning.status === "enhanced" ? finding.fix : deterministicFix;
  const ticket = buildTicket({
    title: finding.title,
    description: `${finding.title}${croppedImageUrl ? ` on ${croppedImageUrl}` : ""}. ${finding.impact}`,
    guideline: finding.guideline,
    severity: finding.severity,
    component: "Document Scan",
  });

  return {
    findingId: findingId || finding.id,
    region: refinedRegion,
    findingPatch: {
      title: finding.title,
      severity: finding.severity,
      guideline: finding.guideline,
      impact: finding.impact,
      fix,
      ticket,
      selector: `${filename} region ${refinedRegion.label}`,
      sourceSnippet: refinedRegion.text,
      issueBoxes: finding.issueBoxes,
      rule: finding.rule,
      guidelineRefs: finding.guidelineRefs,
      humanReviewNote: finding.humanReviewNote,
      matchedStageReason: "Refined from the selected scanned-document region in the audit case.",
    },
    aiReasoning,
  };
}
