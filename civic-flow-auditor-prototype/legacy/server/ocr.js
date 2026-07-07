import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";
import { config } from "./config.js";
import { analyzeDocumentImage } from "./vision-provider.js";

export async function ocrPdfFirstPages(buffer, { pagesLimit = 2 } = {}) {
  if (!config.enableOcr) {
    return { status: "not-run", text: "", pages: 0 };
  }

  const parser = new PDFParse({ data: buffer });
  let worker;
  try {
    const screenshots = await parser.getScreenshot({
      partial: Array.from({ length: pagesLimit }, (_, index) => index + 1),
      imageBuffer: true,
      scale: 1.5,
    });
    const pages = screenshots.pages.slice(0, pagesLimit);
    if (!pages.length) {
      return { status: "failed", text: "", pages: 0, error: "No PDF pages could be rendered for OCR." };
    }

    const textParts = [];
    let methodUsed = "tesseract";

    // Try NVIDIA Vision API first
    if (config.aiProvider === "openrouter" && config.openRouterApiKey) {
      try {
        for (const page of pages) {
          const base64 = Buffer.from(page.data).toString("base64");
          const result = await analyzeDocumentImage(base64);
          textParts.push(result.full_text || "");
        }
        methodUsed = "nvidia-vision";
      } catch (visionError) {
        console.warn("NVIDIA Vision OCR failed, falling back to local Tesseract:", visionError.message);
      }
    }

    // Fallback to local Tesseract OCR
    if (textParts.length === 0) {
      worker = await createWorker("eng");
      for (const page of pages) {
        const result = await worker.recognize(Buffer.from(page.data));
        textParts.push(result.data.text || "");
      }
      methodUsed = "tesseract";
    }

    return {
      status: "complete",
      text: textParts.join("\n").trim(),
      pages: pages.length,
      method: methodUsed,
    };
  } catch (error) {
    return {
      status: "failed",
      text: "",
      pages: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await worker?.terminate?.().catch(() => {});
    await parser.destroy().catch(() => {});
  }
}
