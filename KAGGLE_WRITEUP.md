## The Problem: Millions of People Can't Use the Websites They Depend On

Every day, people rely on government and civic websites to register for benefits, submit permit applications, pay fees, download notices, and access public services. For the 1 in 4 adults in the US who live with a disability, many of these experiences are broken.

The ADA Title II amendments now require all state and local government agencies — libraries, school districts, councils, transit authorities, health departments — to meet **WCAG 2.1 Level AA** by 2026–2028. The problem is that most small public agencies have no dedicated accessibility staff and limited technical budgets. Existing audit tools like axe DevTools or WAVE can report a list of failures on a single page, but they don't:

- Trace the **citizen journey** across multiple steps (login → form → upload → submit → confirmation)
- Connect web pages to the **linked PDF documents** that residents must also read
- Analyze **scanned paper notices** that agencies mail out
- Produce a report that non-technical staff can act on

This creates a massive compliance gap. **Civic Flow Auditor** was built to close it.

---

## The Solution: An AI Agent That Audits Like a Human Accessibility Reviewer

Civic Flow Auditor is an AI agent system that behaves like an experienced accessibility consultant conducting a full site audit. Instead of dumping a flat list of errors, it:

1. **Crawls** the civic site and discovers all public pages, forms, and linked PDF documents
2. **Maps the citizen journey** — classifying each page into stages like Login, Register, Personal Info, Document Upload, Submit, Confirmation
3. **Scans every page** for accessibility violations using axe-core, mapped to WCAG guidelines with resident-impact descriptions
4. **Parses linked PDFs** — detecting whether they are text-accessible or image-only scans
5. **Analyzes scanned paper documents** — using vision AI to assess layout, readability, and form structure from a photograph
6. **Generates an annotated HTML/PDF report** — with numbered issue frames overlaid on screenshots, WCAG references, severity scores, and developer-ready fix tickets

The key insight is that **agents are uniquely suited to this task**. A civic accessibility audit is not a single-step tool call — it requires multi-step reasoning: deciding which pages to prioritize, determining if a PDF is image-only before running OCR, cross-referencing findings across journey stages, and composing a structured report. An agent with access to specialized tools can do all of this autonomously, adapting to whatever it finds.

---

## Architecture

The system has two backend layers that share the same API surface:

**Node.js layer** — The primary runtime powering browser automation, accessibility scanning, OCR, report generation, and the MCP server. Battle-tested and runs locally without external infrastructure.

**Python / Google ADK layer** — A FastAPI backend where audit workflows are orchestrated through a Google ADK `LlmAgent`. The agent receives the target URL and uses five registered `FunctionTool` instances to plan and execute the audit autonomously: `crawl_site_tool`, `scan_accessibility_tool`, `parse_document_tool`, `scan_document_image_tool`, and `generate_report_tool`. A Celery task queue handles async execution, with a graceful thread-based fallback when Redis is unavailable.

Both layers are fronted by a React 19 dashboard that shows real-time audit progress, findings, annotated screenshots, and downloadable reports.

---

## Key Concepts Demonstrated

### 1. Agent / Multi-Agent System (Google ADK)

The Python backend uses `google-adk` to create an `LlmAgent` that orchestrates the full audit pipeline. The agent is given a natural-language instruction and a set of `FunctionTool` objects, then autonomously decides the sequence of tool calls to complete the audit. This replaces a rigid imperative script with a flexible, reasoning-driven workflow.

### 2. MCP Server

An independent MCP server (`server/mcp-server.js`) exposes eight audit tools over the Model Context Protocol using `@modelcontextprotocol/sdk`. Any MCP-compatible AI assistant — such as Claude Desktop or Cursor — can connect and run civic site audits, crop document images, or generate reports through natural language.

Tools exposed: `crawl_site`, `map_journey`, `scan_accessibility`, `parse_document`, `crop_document_image`, `analyze_document_regions`, `annotate_screenshot`, `generate_report`.

### 3. Security

Civic audits involve fetching arbitrary user-supplied URLs, which creates SSRF (Server-Side Request Forgery) risk. Civic Flow Auditor implements defense-in-depth security in both layers:

- URL validation blocks non-HTTP/HTTPS schemes, embedded credentials, and malformed hostnames
- DNS resolution is performed before every crawl; responses are checked against all blocked IP ranges (private, loopback, link-local, multicast, reserved, carrier-grade NAT, documentation)
- IPv4-mapped IPv6 addresses are unwrapped before range classification
- Unsafe HTTP methods (POST, PUT, PATCH, DELETE) are blocked during crawls to prevent accidental form submission
- Redirect chains are followed and re-validated at each hop
- Implemented independently in both JavaScript (`ipaddr.js`) and Python (`ipaddress` stdlib)

### 4. Deployability

The project ships with a `render.yaml` for one-click deployment to Render.com (Node.js stack) and a `backend/Dockerfile` + `docker-compose.yml` for the Python ADK stack. Running `docker compose up` starts the FastAPI server and Redis together; the frontend Vite build is bundled into the Express static server for production.

---

## Technical Implementation Highlights

**Site Crawling with Journey Classification**
The crawler uses Playwright Chromium to load pages in read-only mode, staying safe from form submissions. It collects page titles, headings, all anchor links, and detects form elements. A classification function maps pages to journey stages (Login, Register, PersonalInfo, DocumentUpload, Submit, Confirmation, PDF) based on URL patterns, heading text, and form presence. Crawl depth is bounded by `max_pages` and restricted to the same domain.

**Accessibility Scanning**
Each discovered page is loaded in a Playwright browser context with axe-core injected via `@axe-core/playwright`. Results are mapped to WCAG 2.1 Level AA guidelines, severity levels (critical / serious / moderate / minor), and resident-impact descriptions in plain language. A second pass adds custom civic-flow checks: missing skip navigation, unlabeled form fields, timeout warnings, and missing language declarations.

**Document Analysis**
PDFs are fetched and parsed using `pdf-parse` and `pdfplumber`. If extracted text is below a character threshold, the document is flagged as image-only and Tesseract.js performs OCR to confirm. For scanned paper documents uploaded through the UI, a vision model analyzes the image to identify structural layout regions, estimate reading complexity, and flag accessibility barriers in the physical document design.

**Report Generation**
The final report is a standalone HTML file that can be opened offline. It includes: a plain-language executive summary, a findings table with WCAG references and severity tags, annotated screenshots with numbered colored boxes on each issue, a per-journey-stage breakdown, and linked document accessibility statuses. A PDF export is generated using Playwright's `page.pdf()`.

**AI Integration**
The system supports two AI provider modes: `google` (Gemini 2.0 Flash via Google ADK for the Python layer) and `openrouter` (NVIDIA Nemotron models for the Node.js layer). When AI is unavailable, the system falls back to a deterministic rule-based executive summary that still produces a complete, useful report — no API key required for basic audits.

---

## What I Built With

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite 6, Lucide-React |
| Node.js API | Express 5, Better-SQLite3 |
| MCP Server | @modelcontextprotocol/sdk v1.29 |
| Python API | FastAPI, uvicorn, Pydantic v2 |
| ADK Orchestration | google-adk >= 1.0.0 (LlmAgent + FunctionTool) |
| Background Queue | Celery + Redis (thread fallback) |
| Browser Automation | Playwright (Chromium), axe-core |
| PDF Processing | pdf-parse, pdfplumber, pypdf |
| OCR | Tesseract.js |
| Vision AI | NVIDIA Nemotron Omni (OpenRouter), Gemini 2.0 Flash |
| Security | ipaddr.js (JS), Python ipaddress stdlib |
| Report Templates | Jinja2 (Python), custom HTML builder (Node) |
| IDE Agent | Antigravity (used throughout development) |
| Deployment | render.yaml (Render.com), Docker Compose |

---

## The Build Journey

This project was built end-to-end using **Antigravity** as the pair-programming IDE agent. The development process involved iterating through multiple architectural decisions in conversation with the agent.

The first version used **Firebase Genkit** as the orchestration layer. After working through the ADK course materials, the orchestration was migrated to **Google ADK** with `FunctionTool` wrappers around each audit capability. This gave the system a clean agent-tool separation where the LLM reasons about which tools to invoke rather than following a fixed execution order.

The security layer was a significant focus. Civic audits require fetching arbitrary URLs, which is a real attack surface. Both the JavaScript and Python layers implement independent SSRF protection — including IPv6-mapped IPv4 unwrapping, a common blind spot in many implementations.

The MCP server was added to give the system a second interface: any AI client that speaks Model Context Protocol can use Civic Flow Auditor tools directly, embedding the auditing capability into larger AI workflows without the full web UI.

---

## Impact and Value

Small civic agencies cannot afford enterprise accessibility consultants. Civic Flow Auditor runs free on publicly accessible sites using free-tier AI models — NVIDIA Nemotron via OpenRouter, or Gemini 2.0 Flash via Google AI Studio free tier.

A complete audit — crawl, accessibility scan, document review, annotated report — runs in a few minutes on a standard machine with no cloud subscription required.

The report names the specific element, the specific page, the specific journey step, the WCAG reference, and what to fix. That is the output of a $300/hour accessibility consultant, automated and delivered for free to the public agencies that need it most.
