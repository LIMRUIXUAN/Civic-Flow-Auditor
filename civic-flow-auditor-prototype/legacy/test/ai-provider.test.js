import assert from "node:assert/strict";
import test from "node:test";
import { createAuditRunBase } from "../shared/audit-contract.js";
import { enhanceAuditRunWithAi } from "../server/ai-provider.js";
import { config } from "../server/config.js";

function sampleRun() {
  return {
    ...createAuditRunBase({ id: "ai-test-run", url: "https://example.com", depth: "quick" }),
    pages: [{ url: "https://example.com", title: "Example", heading: "Example", session: "general", sessionLabel: "General info", scanned: true }],
    findings: [
      {
        id: "AXE-001",
        stage: "general",
        stageLabel: "General info",
        title: "Missing label",
        impact: "Screen reader users may not know what to enter.",
        guideline: "WCAG 2.1 1.3.1",
        severity: "Critical",
        status: "To do",
        fix: "Add a label.",
        ticket: "Title: Add label",
      },
    ],
  };
}

test("enhanceAuditRunWithAi keeps deterministic output when AI provider is none", async () => {
  const originalProvider = config.aiProvider;
  config.aiProvider = "none";
  const result = await enhanceAuditRunWithAi(sampleRun());
  config.aiProvider = originalProvider;

  assert.equal(result.ai.status, "deterministic");
  assert.match(result.executiveSummary, /not legal certification/i);
});

test("enhanceAuditRunWithAi falls back without leaking the Google API key", async () => {
  const original = {
    aiProvider: config.aiProvider,
    googleApiKey: config.googleApiKey,
  };
  config.aiProvider = "google";
  config.googleApiKey = "test-secret-key";

  const result = await enhanceAuditRunWithAi(sampleRun(), {
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  });

  config.aiProvider = original.aiProvider;
  config.googleApiKey = original.googleApiKey;

  assert.equal(result.ai.status, "failed");
  assert.equal(result.ai.provider, "google");
  assert.match(result.executiveSummary, /not legal certification/i);
  assert.equal(JSON.stringify(result).includes("test-secret-key"), false);
});
