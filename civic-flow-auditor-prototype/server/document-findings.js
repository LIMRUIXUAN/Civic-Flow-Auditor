import { nanoid } from "nanoid";
import {
  createFinding,
  documentRegionFindingDefaults,
  guidelineRefsFor,
  humanReviewNoteFor,
} from "../shared/audit-utils.js";
import { config } from "./config.js";

function clipped(value = "", limit = 900) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function parseJsonFromModel(content) {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("OpenRouter response did not contain valid JSON.");
  }
}

async function enhanceDocumentRegionsWithTextModel(regions, { fetchImpl = fetch } = {}) {
  if (config.aiProvider !== "openrouter" || !config.openRouterApiKey) {
    return { status: "unavailable", regions: [] };
  }

  const payload = {
    model: config.textModel,
    messages: [
      {
        role: "system",
        content:
          "You are refining document accessibility findings from vision-region JSON. Return only JSON. Preserve region labels and coordinates. Do not invent new regions. Never claim legal certification.",
      },
      {
        role: "user",
        content: JSON.stringify({
          task:
            "For each region, choose the most relevant WCAG 2.2 criterion, severity, plain-language resident impact, and remediation fix. Keep findings concise.",
          regions: regions.map((region) => ({
            label: region.label,
            type: region.type,
            text: clipped(region.text, 500),
            accessibility_notes: clipped(region.accessibility_notes, 500),
          })),
          schema: {
            regions: [
              {
                label: "string",
                title: "string",
                severity: "Critical | High | Medium | Low",
                guideline: "WCAG 2.2 x.x.x",
                impact: "string",
                fix: "string",
                humanReviewNote: "string",
              },
            ],
          },
        }),
      },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  };

  try {
    const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:8787",
        "X-Title": "Civic Flow Auditor Document Reasoning",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.aiTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter returned ${response.status}.`);
    }

    const data = await response.json();
    const parsed = parseJsonFromModel(data?.choices?.[0]?.message?.content);
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
      provider: config.aiProvider === "openrouter" ? "openrouter" : "none",
      model: config.aiProvider === "openrouter" ? config.textModel : "deterministic",
      status: ai.status,
      error: ai.error,
    },
  };
}
