import { config } from "./config.js";

// Google Gemini via the Generative Language REST API (no SDK dependency needed).
// This replaces the previous NVIDIA/OpenRouter provider used by the Node backend.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function parseJsonFromContent(content) {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Gemini response did not contain valid JSON.");
  }
}

export function textPart(text) {
  return { text: String(text ?? "") };
}

export function imagePart(imageBase64, mimeType = "image/png") {
  const raw = imageBase64.startsWith("data:") ? imageBase64.split(",")[1] : imageBase64;
  return { inline_data: { mime_type: mimeType, data: raw } };
}

/**
 * Call Gemini with a system instruction + content parts and return parsed JSON.
 * @param {object} opts
 * @param {string} [opts.model]              model id (defaults to config.textModel)
 * @param {string} [opts.systemInstruction]  system prompt
 * @param {Array}  [opts.parts]              user parts (use textPart/imagePart)
 * @param {number} [opts.temperature]
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts.fetchImpl]
 */
export async function geminiJson({
  model = config.textModel,
  systemInstruction = "",
  parts = [],
  temperature = 0.2,
  timeoutMs = config.aiTimeoutMs,
  fetchImpl = fetch,
} = {}) {
  if (!config.googleApiKey) {
    throw new Error("GOOGLE_API_KEY is not configured.");
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature, responseMimeType: "application/json" },
  };
  if (systemInstruction) {
    body.system_instruction = { parts: [{ text: systemInstruction }] };
  }

  const response = await fetchImpl(
    `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${config.googleApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini API returned status ${response.status}`);
  }

  const data = await response.json();
  const content =
    data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  return parseJsonFromContent(content);
}
