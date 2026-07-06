import { genkit, z } from "genkit";
import { googleAI, gemini15Pro } from "@genkit-ai/googleai";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { normalizeDepth, dedupeAndSortFindings, buildStagesFromPagesAndFindings, createTimingMetadata } from "../shared/audit-utils.js";
import { nowIso } from "../shared/audit-contract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Initialize Google Genkit (ADK)
export const ai = genkit({
  plugins: [googleAI()],
  model: gemini15Pro,
});

// MCP Client Instance
let mcpClient = null;

// Initialize the MCP Client over Stdio
async function getMcpClient() {
  if (mcpClient) return mcpClient;

  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(__dirname, "mcp-server.js")],
  });

  const client = new Client(
    { name: "genkit-orchestrator", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  mcpClient = client;
  return mcpClient;
}

// 2. Define MCP-proxy Tools for Genkit
export const crawlSiteTool = ai.defineTool(
  {
    name: "crawlSite",
    description: "Crawls a public civic website to discover pages and linked PDFs.",
    schema: ai.defineSchema("CrawlSiteInput", z.object({
      url: z.string(),
      depth: z.string().optional(),
    })),
  },
  async ({ url, depth }) => {
    const client = await getMcpClient();
    const result = await client.callTool({
      name: "crawl_site",
      arguments: { url, max_pages: 5, same_domain_only: true }
    });
    return JSON.parse(result.content[0].text);
  }
);

export const mapJourneyTool = ai.defineTool(
  {
    name: "mapJourney",
    description: "Classify discovered pages into civic journey stages.",
    schema: ai.defineSchema("MapJourneyInput", z.object({
      pages: z.array(z.any()),
      documents: z.array(z.any()),
    })),
  },
  async ({ pages, documents }) => {
    const client = await getMcpClient();
    const result = await client.callTool({
      name: "map_journey",
      arguments: { pages, documents }
    });
    return JSON.parse(result.content[0].text);
  }
);

export const scanAccessibilityTool = ai.defineTool(
  {
    name: "scanAccessibility",
    description: "Run axe-core scan on a public page.",
    schema: ai.defineSchema("ScanAccessibilityInput", z.object({
      page_url: z.string(),
    })),
  },
  async ({ page_url }) => {
    const client = await getMcpClient();
    const result = await client.callTool({
      name: "scan_accessibility",
      arguments: { page_url }
    });
    return JSON.parse(result.content[0].text);
  }
);

export const parseDocumentTool = ai.defineTool(
  {
    name: "parseDocument",
    description: "Parse a PDF document for text.",
    schema: ai.defineSchema("ParseDocumentInput", z.object({
      pdf_url: z.string(),
    })),
  },
  async ({ pdf_url }) => {
    const client = await getMcpClient();
    const result = await client.callTool({
      name: "parse_document",
      arguments: { pdf_url }
    });
    return JSON.parse(result.content[0].text);
  }
);

export const generateReportTool = ai.defineTool(
  {
    name: "generateReport",
    description: "Generate HTML and PDF reports.",
    schema: ai.defineSchema("GenerateReportInput", z.object({
      auditRun: z.any(),
    })),
  },
  async ({ auditRun }) => {
    const client = await getMcpClient();
    const result = await client.callTool({
      name: "generate_report",
      arguments: { auditRun }
    });
    return JSON.parse(result.content[0].text);
  }
);

// 3. Define the Genkit Workflow (State Machine)
export const civicFlowAuditWorkflow = ai.defineFlow(
  {
    name: "civicFlowAudit",
    inputSchema: ai.defineSchema("AuditInput", z.object({
      id: z.string(),
      url: z.string(),
      depth: z.string().optional(),
    })),
    outputSchema: ai.defineSchema("AuditOutput", z.any()),
  },
  async ({ id, url, depth }, { sendChunk }) => {
    const startedAt = nowIso();
    const normalizedDepth = normalizeDepth(depth);
    
    // Initial Central State
    let run = {
      id, url, depth: normalizedDepth,
      status: "validating", progress: 5,
      executiveSummary: "",
      pages: [], documents: [], stages: [], findings: [],
      agentSteps: [{ name: "Intake and Safety", status: "complete", detail: "URL validated." }],
      scanner: { lighthouse: { status: "not-run" }, ocr: { status: "not-run", documentsAttempted: 0 }, timing: { startedAt, targetMs: 180000 } },
      artifacts: { screenshots: [] },
      safetyNotes: [], skippedActions: [],
      createdAt: nowIso(), updatedAt: nowIso(),
    };

    const update = (patch) => {
      run = { ...run, ...patch, updatedAt: nowIso() };
      sendChunk(run);
    };

    try {
      update({ status: "scanning", progress: 10, agentSteps: [...run.agentSteps, { name: "Discovery", status: "running", detail: "Crawling site." }] });
      
      const crawl = await crawlSiteTool({ url, depth: normalizedDepth });
      update({
        pages: crawl.pages || [],
        documents: crawl.documents || [],
        skippedActions: crawl.skippedActions || [],
        progress: 28,
      });

      update({ agentSteps: [...run.agentSteps, { name: "Journey Mapper", status: "running", detail: "Mapping user journey." }] });
      const journey = await mapJourneyTool({ pages: run.pages, documents: run.documents });
      update({
        pages: journey.pages || [],
        stages: journey.stages || [],
        progress: 38,
      });

      update({ agentSteps: [...run.agentSteps, { name: "Accessibility Audit", status: "running", detail: "Scanning pages." }] });
      
      const findings = [];
      const pages = [];
      for (const page of run.pages) {
        try {
          const scan = await scanAccessibilityTool({ page_url: page.url });
          findings.push(...(scan.findings || []));
          pages.push({ ...page, scanned: true, screenshotPath: scan.screenshotPath, screenshotUrl: scan.screenshotUrl });
        } catch (err) {
          pages.push({ ...page, scanned: false, error: err.message });
        }
        update({ pages, findings: dedupeAndSortFindings(findings), progress: Math.min(67, run.progress + 5) });
      }

      update({ progress: 68 });
      
      // Parse PDFs
      update({ agentSteps: [...run.agentSteps, { name: "Document Review", status: "running", detail: "Parsing PDFs." }] });
      const parsedDocuments = [];
      for (const doc of run.documents) {
        try {
          const parsed = await parseDocumentTool({ pdf_url: doc.url });
          parsedDocuments.push(parsed);
        } catch (err) {
          parsedDocuments.push({ ...doc, ocrStatus: "failed", error: err.message });
        }
      }
      update({ documents: parsedDocuments, progress: 76 });

      // Generate Report
      const reportArtifacts = await generateReportTool({ auditRun: { ...run, scanner: { ...run.scanner, timing: createTimingMetadata(startedAt, nowIso()) } } });

      update({
        progress: 100,
        status: "report-ready",
        agentSteps: [...run.agentSteps, { name: "Report Export", status: "complete", detail: "Standalone HTML report ready." }],
        artifacts: { ...run.artifacts, ...reportArtifacts },
        scanner: { ...run.scanner, timing: createTimingMetadata(startedAt, nowIso()) }
      });

      return run;
    } catch (error) {
      update({
        status: "failed",
        error: error.message,
        scanner: { ...run.scanner, timing: createTimingMetadata(startedAt, nowIso()) },
      });
      return run;
    }
  }
);
