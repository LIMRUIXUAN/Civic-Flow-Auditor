import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { nanoid } from "nanoid";
import * as z from "zod/v4";
import { normalizeDepth } from "../shared/audit-utils.js";
import { annotateScreenshot, crawlSite, generateReportArtifact, mapJourney, parseDocument, scanAccessibility } from "./audit-engine.js";
import { validateScanTarget } from "./security.js";
import fs from "node:fs/promises";
import { loadAuditRun, saveAuditRun, listAuditIds, ensureRunDir, getArtifactPath } from "./store.js";
import { cropDocumentImage } from "./auto-crop.js";
import { analyzeDocumentImage } from "./vision-provider.js";

function asToolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

export function createCivicFlowMcpServer() {
  const server = new McpServer({
    name: "civic-flow-auditor",
    version: "0.1.0",
  });

  server.registerTool(
    "crawl_site",
    {
      title: "Crawl public civic site",
      description: "Discover same-domain public pages, PDFs, forms, and first-pass journey hints without submitting forms.",
      inputSchema: {
        url: z.string().describe("Public http or https URL to audit."),
        max_pages: z.number().int().min(1).max(10).default(5),
        same_domain_only: z.boolean().default(true),
      },
    },
    async (input) => asToolResult(await crawlSite({ ...input, auditId: `mcp-${nanoid(8)}` })),
  );

  server.registerTool(
    "map_journey",
    {
      title: "Map civic journey",
      description: "Classify discovered pages into login, register, personal info, upload, submit, confirmation, and PDF stages.",
      inputSchema: {
        pages: z.array(z.any()).default([]),
        documents: z.array(z.any()).default([]),
      },
    },
    async (input) => asToolResult(await mapJourney(input)),
  );

  server.registerTool(
    "scan_accessibility",
    {
      title: "Scan accessibility",
      description: "Run axe-core and custom civic-flow accessibility checks against one public page.",
      inputSchema: {
        page_url: z.string().describe("Public page URL to scan."),
        viewport: z.object({ width: z.number().default(1366), height: z.number().default(900) }).optional(),
      },
    },
    async (input) => asToolResult(await scanAccessibility({ ...input, auditId: `mcp-${nanoid(8)}` })),
  );

  server.registerTool(
    "parse_document",
    {
      title: "Parse linked PDF",
      description: "Extract PDF text and flag image-only public documents or forms.",
      inputSchema: {
        pdf_url: z.string().describe("Public PDF URL."),
      },
    },
    async (input) => asToolResult(await parseDocument({ ...input, auditId: `mcp-${nanoid(8)}` })),
  );

  server.registerTool(
    "crop_document_image",
    {
      title: "Crop document image",
      description: "Auto-crop printed document photo using NVIDIA Vision model detection.",
      inputSchema: {
        image_path: z.string().describe("Local filesystem path to document image or base64 data."),
        padding_percent: z.number().min(0).max(20).default(5).describe("Percentage padding around bounds."),
      },
    },
    async (input) => {
      const result = await cropDocumentImage(input.image_path, { paddingPercent: input.padding_percent });
      await ensureRunDir("doc-scan");
      const filename = `crop-${Date.now()}-${nanoid(6)}.png`;
      const destPath = getArtifactPath("doc-scan", filename);
      await fs.writeFile(destPath, result.croppedBuffer);
      return asToolResult({
        cropped_image_path: destPath,
        cropBounds: result.cropBounds,
        originalSize: result.originalSize,
        croppedSize: result.croppedSize,
      });
    }
  );

  server.registerTool(
    "analyze_document_regions",
    {
      title: "Analyze document regions",
      description: "Identify structural visual regions on a cropped document image and extract layout accessibility issues.",
      inputSchema: {
        image_path: z.string().describe("Local filesystem path to document image or base64 data."),
      },
    },
    async (input) => {
      let base64Data = "";
      if (input.image_path.startsWith("data:") || input.image_path.length > 500) {
        base64Data = input.image_path;
      } else {
        const bytes = await fs.readFile(input.image_path);
        base64Data = `data:image/png;base64,${bytes.toString("base64")}`;
      }
      const result = await analyzeDocumentImage(base64Data);
      return asToolResult(result);
    }
  );

  server.registerTool(
    "annotate_screenshot",
    {
      title: "Annotate screenshot",
      description: "Render numbered, colorblind-safe issue frames on an existing screenshot artifact.",
      inputSchema: {
        screenshotPath: z.string(),
        issueBoxes: z.array(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(), label: z.string() })).default([]),
      },
    },
    async (input) => asToolResult(await annotateScreenshot({ ...input, auditId: `mcp-${nanoid(8)}` })),
  );

  server.registerTool(
    "generate_report",
    {
      title: "Generate report",
      description: "Write standalone HTML and PDF report artifacts from an audit run JSON object.",
      inputSchema: {
        auditRun: z.any(),
      },
    },
    async (input) => asToolResult(await generateReportArtifact({ auditRun: input.auditRun })),
  );



  server.registerResource(
    "audit-run",
    new ResourceTemplate("audit://runs/{auditId}", {
      list: async () => ({
        resources: (await listAuditIds()).map((auditId) => ({
          uri: `audit://runs/${auditId}`,
          name: `Audit ${auditId}`,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Audit run JSON",
      description: "Latest saved Civic Flow Auditor run by id.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const auditId = String(variables.auditId || "").trim();
      const run = await loadAuditRun(auditId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(run, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

const server = createCivicFlowMcpServer();
const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
