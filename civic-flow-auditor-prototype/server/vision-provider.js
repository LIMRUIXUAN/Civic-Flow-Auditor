import { config } from "./config.js";

// Helper to extract JSON from markdown or raw text if response_format fails
function parseJsonFromContent(content) {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Fall through
      }
    }
    throw new Error("API response did not contain parseable JSON.");
  }
}

export async function analyzeDocumentImage(imageBase64, { fetchImpl = fetch } = {}) {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const dataUri = imageBase64.startsWith("data:") ? imageBase64 : `data:image/png;base64,${imageBase64}`;

  const payload = {
    model: config.visionModel,
    messages: [
      {
        role: "system",
        content:
          "You are an accessibility auditor. Analyze document layout and accessibility. You must return only a JSON object matching this schema:\n{\n  \"regions\": [\n    {\n      \"label\": \"1\",\n      \"type\": \"Header\" | \"Form Input\" | \"Body Text\" | \"Table\" | \"Signature\" | \"Metadata\",\n      \"text\": \"Extracted text contents of this region\",\n      \"x\": 15,\n      \"y\": 20,\n      \"width\": 70,\n      \"height\": 8,\n      \"accessibility_notes\": \"Detailed concern for screen readers or low-vision users.\"\n    }\n  ],\n  \"full_text\": \"The entire combined document text\",\n  \"suggestions\": [\"Broad suggestions for document accessibility improvement\"]\n}\nAll coordinates (x, y, width, height) must be integers from 0 to 100 representing percentage bounds on the image.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract all structural layout regions, read their text, locate their bounding boxes as percentages, and evaluate their accessibility. Output strictly in JSON format.",
          },
          {
            type: "image_url",
            image_url: {
              url: dataUri,
            },
          },
        ],
      },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  };

  const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:8787",
      "X-Title": "Civic Flow Auditor Vision Engine",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.aiTimeoutMs * 2), // Vision tasks take slightly longer
  });

  if (!response.ok) {
    throw new Error(`Vision API returned status ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return parseJsonFromContent(content);
}

export async function identifyCropBounds(imageBase64, { fetchImpl = fetch } = {}) {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const dataUri = imageBase64.startsWith("data:") ? imageBase64 : `data:image/png;base64,${imageBase64}`;

  const payload = {
    model: config.visionModel,
    messages: [
      {
        role: "system",
        content:
          "Identify the document boundary inside this photo. The photo contains a printed page/form on a desk/surface. Find the four corners of the page itself and return the bounding box of the page. You must return only a JSON object matching this schema:\n{\n  \"x\": 10,\n  \"y\": 5,\n  \"width\": 80,\n  \"height\": 90\n}\nCoordinates must be integers from 0 to 100 representing percentage bounds on the total photo canvas.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Detect the exact content bounds of the document page in this image. Output strictly in JSON format.",
          },
          {
            type: "image_url",
            image_url: {
              url: dataUri,
            },
          },
        ],
      },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  };

  const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:8787",
      "X-Title": "Civic Flow Auditor Auto-Crop Detector",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.aiTimeoutMs * 2),
  });

  if (!response.ok) {
    throw new Error(`Vision API returned status ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return parseJsonFromContent(content);
}

export async function refineRegion(regionImageBase64, regionType, { fetchImpl = fetch } = {}) {
  if (!config.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const dataUri = regionImageBase64.startsWith("data:") ? regionImageBase64 : `data:image/png;base64,${regionImageBase64}`;

  const payload = {
    model: config.visionModel,
    messages: [
      {
        role: "system",
        content:
          "You are looking at a close-up crop of a single document element of type: " +
          regionType +
          ". Analyze it in detail. You must return only a JSON object matching this schema:\n{\n  \"type\": \"Header\" | \"Form Input\" | \"Body Text\" | \"Table\" | \"Signature\" | \"Metadata\",\n  \"extracted_text\": \"Highly accurate transcription of this specific region\",\n  \"detailed_accessibility_evaluation\": \"Detailed accessibility issue list or validation notes for screen-reader speech, labels, size, contrast, or required field indications.\",\n  \"remediation_fix\": \"Step-by-step developer instruction to make this specific element accessible.\"\n}",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Evaluate this specific document region in high resolution. Output strictly in JSON format.",
          },
          {
            type: "image_url",
            image_url: {
              url: dataUri,
            },
          },
        ],
      },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  };

  const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterApiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:8787",
      "X-Title": "Civic Flow Auditor Region Refiner",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.aiTimeoutMs * 2),
  });

  if (!response.ok) {
    throw new Error(`Vision API returned status ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return parseJsonFromContent(content);
}
