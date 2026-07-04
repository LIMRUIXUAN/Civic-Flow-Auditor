import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { nanoid } from "nanoid";
import { z } from "zod";
import { normalizeDepth } from "../shared/audit-utils.js";
import { enhanceAuditRunWithAi } from "./ai-provider.js";
import { cancelAudit, enqueueAudit, getQueueSnapshot } from "./audit-queue.js";
import { config, projectRoot } from "./config.js";
import { generateReport } from "./report.js";
import { validateScanTarget } from "./security.js";
import {
  createStoredAuditRun,
  ensureStorageDir,
  ensureRunDir,
  getArtifactPath,
  getRunDir,
  listAuditSummaries,
  loadAuditRun,
  saveAuditRun,
  subscribeAudit,
  artifactUrl,
} from "./store.js";
import { cropDocumentImage, cropSubRegion } from "./auto-crop.js";
import { analyzeDocumentImage, refineRegion } from "./vision-provider.js";
import { createWorker } from "tesseract.js";

const CreateAuditSchema = z.object({
  url: z.string(),
  depth: z.string().optional(),
});

function corsOrigin(origin, callback) {
  const allowed = new Set([config.corsOrigin, "http://localhost:5173", "http://127.0.0.1:5173"]);
  if (!origin || allowed.has(origin)) {
    callback(null, true);
    return;
  }
  callback(null, false);
}

export function createApiApp() {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: "10mb" }));

  async function sendStoredFile(response, filePath, mimeType) {
    const bytes = await fs.readFile(filePath);
    response.type(mimeType).send(bytes);
  }

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      service: "civic-flow-auditor",
      mcp: "stdio",
      maxPages: config.maxPages,
      queue: getQueueSnapshot(),
      aiProvider: config.aiProvider,
      lighthouse: config.enableLighthouse ? "enabled" : "optional",
      ocr: config.enableOcr ? "enabled" : "disabled",
    });
  });

  app.post("/api/scan-image", async (request, response) => {
    const { image } = request.body;
    if (!image) {
      response.status(400).json({ error: "Image data (base64) is required." });
      return;
    }

    try {
      // 1. Crop using auto-crop (calls NVIDIA vision crop detection)
      const cropResult = await cropDocumentImage(image);
      const croppedBase64 = cropResult.croppedBase64;
      const croppedBuffer = cropResult.croppedBuffer;

      // 2. Save cropped image as a static artifact
      await ensureRunDir("doc-scan");
      const filename = `crop-${Date.now()}-${nanoid(6)}.png`;
      const destPath = getArtifactPath("doc-scan", filename);
      await fs.writeFile(destPath, croppedBuffer);
      const croppedImageUrl = artifactUrl("doc-scan", filename);

      // 3. Analyze cropped image regions via NVIDIA Vision
      let result;
      let method = "nvidia-vision";

      if (config.aiProvider === "openrouter" && config.openRouterApiKey) {
        try {
          result = await analyzeDocumentImage(croppedBase64);
        } catch (visionError) {
          console.warn("NVIDIA Vision scan failed, falling back to local Tesseract:", visionError.message);
          method = "tesseract";
        }
      } else {
        method = "tesseract";
      }

      // Tesseract offline OCR fallback
      if (method === "tesseract") {
        const worker = await createWorker("eng");
        const ocrRes = await worker.recognize(croppedBuffer);
        await worker.terminate().catch(() => {});
        result = {
          regions: [
            {
              label: "1",
              type: "Body Text",
              text: ocrRes.data.text || "",
              x: 5,
              y: 5,
              width: 90,
              height: 90,
              accessibility_notes: "This document was scanned using local offline OCR fallback. Please manually verify accessibility layout."
            }
          ],
          full_text: ocrRes.data.text || "",
          suggestions: [
            "The NVIDIA Vision API was unavailable. Used offline text extraction fallback.",
            "Ensure the printed document has clear, high-contrast typography and digital alternatives."
          ]
        };
      }

      response.json({
        croppedImageUrl,
        croppedBase64,
        regions: result.regions || [],
        fullText: result.full_text || "",
        suggestions: result.suggestions || [],
        method
      });
    } catch (error) {
      console.error("Scan image error:", error);
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/scan-image/refine", async (request, response) => {
    const { image, region } = request.body;
    if (!image || !region) {
      response.status(400).json({ error: "Cropped image and region parameters are required." });
      return;
    }

    try {
      let result;
      let method = "nvidia-vision";

      if (config.aiProvider === "openrouter" && config.openRouterApiKey) {
        try {
          const subRegionBase64 = await cropSubRegion(image, region);
          result = await refineRegion(subRegionBase64, region.type);
        } catch (refineError) {
          console.warn("NVIDIA refinement failed, falling back to basic:", refineError.message);
          method = "none";
        }
      } else {
        method = "none";
      }

      if (method === "none") {
        result = {
          type: region.type,
          extracted_text: region.text || "Detailed refinement requires NVIDIA Vision API.",
          detailed_accessibility_evaluation: "Offline mode is active. Bounding box details are unrefined.",
          remediation_fix: "Verify contrast ratios and ensure correct HTML tag representations."
        };
      }

      response.json({
        label: region.label,
        type: result.type || region.type,
        text: result.extracted_text || region.text,
        accessibility_notes: result.detailed_accessibility_evaluation || "Requires manual inspection.",
        fix: result.remediation_fix || "Check target WCAG guideline for details.",
        method
      });
    } catch (error) {
      console.error("Refine image error:", error);
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/audits", async (request, response) => {
    response.json(await listAuditSummaries({ limit: request.query.limit }));
  });

  app.post("/api/audits", async (request, response) => {
    const parsed = CreateAuditSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "URL and scan depth are required." });
      return;
    }

    let safeUrl;
    try {
      safeUrl = await validateScanTarget(parsed.data.url);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const id = nanoid(10);
    const depth = normalizeDepth(parsed.data.depth);
    const run = await createStoredAuditRun({ id, url: safeUrl, depth });
    enqueueAudit({ id, url: safeUrl, depth });

    response.status(202).json(run);
  });

  app.get("/api/audits/:id", async (request, response) => {
    try {
      response.json(await loadAuditRun(request.params.id));
    } catch {
      response.status(404).json({ error: "Audit run not found." });
    }
  });

  app.post("/api/audits/:id/cancel", async (request, response) => {
    try {
      response.json(await cancelAudit(request.params.id));
    } catch {
      response.status(404).json({ error: "Audit run not found." });
    }
  });

  app.post("/api/audits/:id/enhance", async (request, response) => {
    try {
      const run = await loadAuditRun(request.params.id);
      if (!run.findings.length && !run.documents.length) {
        response.status(409).json({ error: "Run does not have enough audit output to enhance yet." });
        return;
      }

      await saveAuditRun({
        ...run,
        ai: {
          provider: config.aiProvider === "openrouter" ? "openrouter" : "none",
          model: config.aiProvider === "openrouter" ? config.openRouterModel : "deterministic",
          status: "pending",
          generatedFields: [],
        },
      });

      const enhanced = await enhanceAuditRunWithAi(run);
      const reportArtifacts = run.status === "report-ready" ? await generateReport(enhanced) : {};
      const saved = await saveAuditRun({
        ...enhanced,
        artifacts: { ...enhanced.artifacts, ...reportArtifacts },
      });
      response.json(saved);
    } catch (error) {
      response.status(404).json({ error: error instanceof Error ? error.message : "Audit run not found." });
    }
  });

  app.get("/api/audits/:id/events", async (request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    const send = (event, payload) => {
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      send("audit", await loadAuditRun(request.params.id));
    } catch {
      send("error", { error: "Audit run not found." });
      response.end();
      return;
    }

    const unsubscribe = subscribeAudit(request.params.id, (run) => {
      send("audit", run);
      if (run.status === "report-ready" || run.status === "failed" || run.status === "cancelled") {
        response.end();
      }
    });

    request.on("close", unsubscribe);
  });

  app.get("/reports/:id.html", async (request, response) => {
    try {
      const reportPath = path.join(getRunDir(request.params.id), "report.html");
      await fs.access(reportPath);
      await sendStoredFile(response, reportPath, "html");
    } catch {
      response.status(404).send("Report not found.");
    }
  });

  app.get("/reports/:id.pdf", async (request, response) => {
    try {
      const reportPath = path.join(getRunDir(request.params.id), "report.pdf");
      await fs.access(reportPath);
      await sendStoredFile(response, reportPath, "pdf");
    } catch {
      response.status(404).send("PDF report not found.");
    }
  });

  app.get("/artifacts/:id/:file", async (request, response) => {
    try {
      const requested = getArtifactPath(request.params.id, request.params.file);
      await fs.access(requested);
      await sendStoredFile(response, requested, path.extname(requested).slice(1) || "application/octet-stream");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      response.status(message.includes("Invalid") ? 400 : 404).send(message.includes("Invalid") ? message : "Artifact not found.");
    }
  });

  if (config.serveStaticDist) {
    const distDir = path.join(projectRoot, "dist");
    app.use(express.static(distDir));
    app.get("*", async (_request, response) => {
      response.sendFile(path.join(distDir, "index.html"));
    });
  }

  return app;
}

export async function startApiServer() {
  await ensureStorageDir();
  const app = createApiApp();
  return app.listen(config.port, config.host, () => {
    console.log(`Civic Flow Auditor API listening on http://${config.host}:${config.port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startApiServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
