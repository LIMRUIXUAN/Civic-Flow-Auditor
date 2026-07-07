# Civic Flow Auditor: AI Agents Capstone Project Architecture

## 1. Project Summary

**Product name:** Civic Flow Auditor
**Goal:** An AI-powered agentic system that audits public-service website journeys and scanned document forms/notices, finds accessibility barriers, maps them to ADA/WCAG guidelines, and exports an annotated report detailing exactly what and how to fix.

Civic Flow Auditor is built with **Google's Agent Development Kit (ADK)** for Python, coordinating browser automation, visual accessibility analysis, and automated compliance auditing behind a FastAPI gateway.

---

## 2. Orchestrator Architecture

The system uses a **central orchestrator** (`backend/app/agents/orchestrator.py`) that runs a linear, checkpointed audit pipeline and calls a fixed set of typed tool functions along the way.

### Backend Implementation Details

- **Framework:** The orchestrator is built on **Google ADK (Agent Development Kit) for Python**. Every tool it calls (`crawl_site`, `scan_accessibility`, `parse_document`, `scan_document_image`, `generate_report`) is registered as a `google.adk.tools.FunctionTool` in `agents/adk_tools.py`. The AI-writing step uses a real `google.adk.agents.LlmAgent` driven through `google.adk.runners.InMemoryRunner` and `InMemorySessionService` — this is a genuine ADK agent invocation, not just wrapped tool functions.
- **Data Passing:** Context is passed between pipeline stages using a **single `AuditRun` Pydantic object** ("Central Audit State"). Every stage mutates and re-saves this object; each save is persisted to SQLite and immediately visible to the API layer.
- **UI Real-Time Updates:** The FastAPI SSE endpoint (`GET /api/audits/{id}/events`) polls the durable `AuditRun` store roughly once a second and streams a fresh snapshot to the React frontend whenever anything changes, with heartbeat comments to keep the connection alive. This works whether the audit is running in the API process, a background thread, or a separate Celery worker — the SSE layer never depends on shared in-memory state with the worker.
- **Security Features:** The orchestrator enforces **URL validation and SSRF protection** (`security.py`: blocks private/loopback/link-local/reserved IP ranges, rejects URLs with embedded credentials, resolves DNS before crawling) and a **no-auto-submit rule** for public forms — the only exception is a single, explicit, user-supplied login form used to establish an authenticated crawl session (credentials are held in memory for the duration of the crawl and never persisted).
- **Error Handling:** Each pipeline stage is individually guarded:
  - A crawl failure marks the run `failed` immediately with a clear error, instead of hanging in `scanning`.
  - Each page's accessibility scan gets **one retry**; if it still fails, the page is marked with an error and the audit continues with the remaining pages, recording a partial-result safety note.
  - Document parsing failures are recorded per-document (`error` field) rather than aborting the run.
  - The Gemini-powered AI enhancement step is wrapped in a broad try/except; any failure (missing API key, timeout, malformed response) falls back to the deterministic (non-AI) report text and is recorded on `run.ai.status`.
  - Report generation failures mark the run `failed` explicitly rather than silently producing no artifacts.
  - Cancellation is checked against the durably-stored status at every checkpoint, so a cancel request issued by the API takes effect promptly even though the pipeline is running in a different thread or worker process.

### Specialized Stages / Tools

1. **Intake and Safety** — Validates the URL against SSRF/credential-embedding rules before anything else runs; blocks unsafe targets outright.
2. **Discovery (`crawl_site`)** — Crawls the public domain with a single persistent Playwright browser context (so login session cookies persist across every page), discovering internal links, PDFs, forms, and — when credentials are supplied — authenticating first and enqueuing the post-login landing page.
3. **Accessibility Scan (`scan_accessibility`)** — Runs custom Python/Playwright DOM checks per page (labeling, contrast, heading order, focus order, tabindex, link text) and captures screenshots.
4. **Document Review (`parse_document`, `scan_document_image`)** — Extracts text from linked PDFs (Python PDF parsing, Gemini vision fallback for scanned/image-only documents) and analyzes uploaded document images (auto-crop, region detection, per-region refine) via Gemini vision.
5. **Remediation** — Deduplicates findings by rule+stage, ranks severity, maps to WCAG guidance, drafts plain-language impact/fix text and a developer ticket, and builds a copy-paste **AI fix prompt** per finding.
6. **AI Enhancement (`agents/adk_agent.py`)** — Best-effort: a real ADK `LlmAgent` (Gemini `gemini-2.0-flash`) rewrites the executive summary and finding narratives when `GOOGLE_API_KEY` is configured; the deterministic text is the fallback and default.
7. **Report Export (`generate_report`)** — Assembles the HTML report, renders a PDF via headless Playwright print-to-PDF, and writes a ticket markdown file. Applies the "no legal certification" and human-review disclaimers, and lists every skipped/failed step explicitly.

---

## 3. The Model Stack

All AI/vision tasks use **Google Gemini**, called directly through the ADK agent runtime and `google-genai`:

- **Vision Tasks (Gemini `gemini-2.0-flash`):** Used by the document/vision pipeline for auto-cropping uploaded form images, visual region detection (returning bounding-box coordinates), and extracting text from scanned/image-only documents.
- **Reasoning & Orchestration (Gemini `gemini-2.0-flash` via ADK `LlmAgent`):** Powers the best-effort AI enhancement step — rewriting the executive summary, individual finding-impact text, and document summaries with source-grounded prompts built from the deterministic findings.

There is no NVIDIA/Nemotron or OpenRouter dependency in the current backend.

---

## 4. Tool Integration (No MCP In Production)

The orchestrator calls tools directly as Python functions wrapped by `google.adk.tools.FunctionTool` (`agents/adk_tools.py`) — this is the ADK-native way to expose typed tools to an agent, and it is the sole internal tool boundary in production. There is no MCP server or `@modelcontextprotocol/sdk` client wired into the live system.

*(The original hackathon prototype used a Node/Express backend with an MCP server over stdio; that code is preserved for reference under `legacy/` but is not part of the running application.)*

### Tool Functions

- `crawl_site`: Inputs a URL (+ optional login credentials); outputs discovered pages, PDFs, forms, detected sessions, crawl errors, and login notes.
- `scan_accessibility`: Inputs a page snapshot; outputs accessibility findings, affected DOM selectors, severity rankings, and triggers screenshots.
- `parse_document`: Inputs a PDF URL or uploaded file; extracts text, flags inaccessible image-only PDFs, and summarizes instructions.
- `scan_document_image`: Inputs a document image; outputs cropped image, detected regions (type, bounds, text) and accessibility suggestions via Gemini vision.
- `generate_report`: Compiles the unified findings into HTML and PDF deliverables plus a ticket markdown file.

---

## 5. Report Output

Each exported report includes:
- A severity summary strip (critical/high/medium/low counts) and journey-coverage line (stages reached, pages scanned vs. discovered).
- A pages-audited table and a documents table.
- Per-finding cards: severity, journey stage, WCAG guideline, plain-language resident impact, recommended fix, screenshot evidence, occurrence count across pages, and a **copy-paste AI fix prompt** with a one-click Copy button.
- A **Skipped and Failed Steps** section listing any page scan or document parse that failed, any guardrail-skipped action (e.g., a blocked form submission), and whether AI enhancement ran.
- Safety and human-review disclaimers.

Reports are available as standalone HTML (served at `/reports/{id}.html`) and as PDF (`/reports/{id}.pdf`, rendered via headless Playwright print-to-PDF; best-effort — the HTML report is always available even where PDF rendering isn't).

---

## 6. Kaggle Capstone Demo Script (5-Minute Video)

This structured storyboard acts as a guide for recording the required Kaggle Capstone demo video.

**0:00 - 0:45 | Introduction & The Problem**
*   **Visual:** The Civic Flow Auditor home page.
*   **Narration:** Introduce the project. Briefly mention the 2027 ADA Title II compliance deadlines and how small local governments struggle with accessibility audits. Explain that Civic Flow Auditor maps entire citizen journeys and physical forms, not just code.

**0:45 - 1:45 | Website Audit & Journey Mapping**
*   **Visual:** Enter a public civic URL (e.g., a local DMV or library site) into the "Website Audit" tab. Click Start.
*   **Narration:** Show the ADK orchestrator delegating to the crawl tool to find pages and grouping them into a logical flow (e.g., Login -> Application -> Submit). Point out the live progress stream and the agent-step timeline.

**1:45 - 3:00 | Vision & Document Scanning**
*   **Visual:** Switch to the "Document Scan" tab. Upload a photo of a printed government notification or form.
*   **Narration:** Highlight the **Gemini vision** integration. Watch as the vision tool auto-crops the image and draws labeled bounding boxes around regions (headers, inputs, signatures).
*   **Visual:** Click "Refine" on one specific bounding box to show the detailed accessibility extraction for that field.

**3:00 - 4:00 | AI Remediation & Unified Report**
*   **Visual:** Switch back to the main unified findings table where both website findings and document scan findings have been aggregated.
*   **Narration:** Highlight how the remediation step, backed by a real ADK `LlmAgent` running **Gemini**, took the raw technical output and drafted a plain-language explanation and a ready-to-use developer ticket. Open a finding and show the copy-paste AI fix prompt.

**4:00 - 5:00 | Export & Conclusion**
*   **Visual:** Click "Listen Mode" to hear the browser read a finding aloud. Export the report and open both the standalone HTML report and the PDF.
*   **Narration:** Reiterate the security features (SSRF/URL validation, no automatic form submissions beyond one user-authorized login). Conclude with how this ADK-based architecture empowers civic agencies.
