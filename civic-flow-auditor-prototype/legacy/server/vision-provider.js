import { config } from "./config.js";
import { geminiJson, imagePart, textPart } from "./gemini.js";

// Document/image vision analysis powered by Google Gemini (replaces NVIDIA vision).

export async function analyzeDocumentImage(imageBase64, { fetchImpl = fetch } = {}) {
  if (!config.googleApiKey) {
    throw new Error("GOOGLE_API_KEY is not configured.");
  }

  const systemInstruction =
    "You are an accessibility auditor. Analyze document layout and accessibility. Return ONLY a JSON " +
    "object matching this schema:\n" +
    '{\n  "regions": [\n    {\n      "label": "1",\n' +
    '      "type": "Header" | "Form Input" | "Body Text" | "Table" | "Signature" | "Metadata",\n' +
    '      "text": "Extracted text contents of this region",\n' +
    '      "x": 15, "y": 20, "width": 70, "height": 8,\n' +
    '      "accessibility_notes": "Detailed concern for screen readers or low-vision users."\n' +
    "    }\n  ],\n" +
    '  "full_text": "The entire combined document text",\n' +
    '  "suggestions": ["Broad suggestions for document accessibility improvement"]\n}\n' +
    "All coordinates (x, y, width, height) must be integers from 0 to 100 representing percentage bounds on the image.";

  return geminiJson({
    model: config.visionModel,
    systemInstruction,
    parts: [
      textPart(
        "Extract all structural layout regions, read their text, locate their bounding boxes as " +
          "percentages, and evaluate their accessibility. Output strictly in JSON format.",
      ),
      imagePart(imageBase64),
    ],
    temperature: 0.1,
    timeoutMs: config.aiTimeoutMs * 2,
    fetchImpl,
  });
}

export async function identifyCropBounds(imageBase64, { fetchImpl = fetch } = {}) {
  if (!config.googleApiKey) {
    throw new Error("GOOGLE_API_KEY is not configured.");
  }

  const systemInstruction =
    "Identify the document boundary inside this photo. The photo contains a printed page/form on a " +
    "desk/surface. Find the four corners of the page itself and return the bounding box of the page. " +
    "Return ONLY a JSON object matching this schema:\n" +
    '{\n  "x": 10, "y": 5, "width": 80, "height": 90\n}\n' +
    "Coordinates must be integers from 0 to 100 representing percentage bounds on the total photo canvas.";

  return geminiJson({
    model: config.visionModel,
    systemInstruction,
    parts: [
      textPart("Detect the exact content bounds of the document page in this image. Output strictly in JSON format."),
      imagePart(imageBase64),
    ],
    temperature: 0.1,
    timeoutMs: config.aiTimeoutMs * 2,
    fetchImpl,
  });
}

export async function refineRegion(regionImageBase64, regionType, { fetchImpl = fetch } = {}) {
  if (!config.googleApiKey) {
    throw new Error("GOOGLE_API_KEY is not configured.");
  }

  const systemInstruction =
    "You are looking at a close-up crop of a single document element of type: " +
    regionType +
    ". Analyze it in detail. Return ONLY a JSON object matching this schema:\n" +
    '{\n  "type": "Header" | "Form Input" | "Body Text" | "Table" | "Signature" | "Metadata",\n' +
    '  "extracted_text": "Highly accurate transcription of this specific region",\n' +
    '  "detailed_accessibility_evaluation": "Detailed accessibility issue list or validation notes for ' +
    'screen-reader speech, labels, size, contrast, or required field indications.",\n' +
    '  "remediation_fix": "Step-by-step developer instruction to make this specific element accessible."\n}';

  return geminiJson({
    model: config.visionModel,
    systemInstruction,
    parts: [
      textPart("Evaluate this specific document region in high resolution. Output strictly in JSON format."),
      imagePart(regionImageBase64),
    ],
    temperature: 0.1,
    timeoutMs: config.aiTimeoutMs * 2,
    fetchImpl,
  });
}
