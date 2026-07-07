# Civic Flow Auditor PRD

## 1. Product Summary

**Product name:** Civic Flow Auditor

**One-line pitch:** An AI agent that audits public-service website journeys and scanned document forms/notices, finds accessibility barriers, maps them to WCAG/ADA guidance, and exports an annotated HTML/PDF report that tells teams exactly what to fix.

**Target hackathon:** Kaggle AI Agents Capstone

**Best track:** Agents for Good

**Secondary track:** Agents for Business

## 2. Stress-Test Verdict

**Verdict:** GO for hackathon demo, WAIT for real-world sale until validated with 5 to 10 public-sector users.

**Confidence:** 72%.

**Idea strength:** Strong.
The pain is real. ADA Title II web and mobile accessibility rules require state and local governments to meet WCAG 2.1 Level AA for covered web content and mobile apps. Compliance deadlines are approaching in 2027 and 2028, creating a clear timing window.

**Founder-market fit:** Unknown.
The project should avoid claiming legal certification and instead position itself as an audit assistant.

**Resource adequacy:** Sufficient for hackathon MVP.
A focused version can be built with Playwright, custom accessibility DOM checks, PDF parsing, screenshot annotation, LLM report writing (Gemini via Google ADK), document scanning (Gemini vision), and a React-based web UI.

## 3. Problem

Public-service websites often contain forms, PDFs, login flows, and registration steps. These flows can break for people using screen readers, keyboard navigation, high-contrast settings, or low-vision tools.

Small public agencies, schools, libraries, councils, and nonprofits often do not have dedicated accessibility staff. Existing tools can list technical failures, but they usually do not explain the whole user journey, show annotated screenshots, connect website steps to linked PDF instructions, or produce plain-language fix instructions. Additionally, residents frequently receive physical notices or printed paper forms that are inaccessible; there is no easy way to scan these documents and automatically assess their accessibility layout or extract clear form requirements.

## 4. Users And Personas

### Primary User: Small Public Agency Web Manager

This user manages a public website but is not an accessibility expert. They need to know which pages and forms are risky, what to fix first, and how to explain the work to developers or leadership.

### Secondary User: Developer Or Vendor

This user receives tickets from the agency and needs specific reproduction steps, failing elements, WCAG references, screenshots, and suggested code-level fixes.

### Beneficiary: Disabled Resident Or Applicant

This user needs to register, log in, submit a public form, read linked document files, upload documents, or receive confirmation without accessibility barriers.

## 5. Core Value

Civic Flow Auditor should not only say "this page has 14 accessibility issues." It should say:

1. Which public-service journey or document is affected.
2. Which screen, form step, or document region fails.
3. What the user with a disability experiences.
4. Which guideline applies.
5. What the team should fix — including a ready-to-paste AI prompt a developer can hand to any assistant for a concrete code fix.
6. What needs human review before submission or publication.

## 6. Scope Choices

### Choice A: Hackathon MVP / Prototype (superseded)

The original prototype used a Node/Express backend with NVIDIA Nemotron models via OpenRouter and an MCP client for tool access. That prototype is preserved for reference under `legacy/` but is no longer the shipped backend.

### Choice B: Production Foundation — Current, Implemented

This is the architecture actually running in `civic-flow-auditor-prototype/backend/`:

- **React/Vite Frontend:** Preserves the intake, findings, evidence, listen-mode, and export workflows.
- **FastAPI Gateway:** Owns request validation, audit creation, uploads, cancellation, progress streaming, and report/artifact access.
- **Google ADK Python Orchestration:** A central orchestrator (`agents/orchestrator.py`) runs a linear, checkpointed pipeline of typed tools (crawl, scan, document parsing, report generation), with a real `google.adk.agents.LlmAgent` + `InMemoryRunner` powering the best-effort AI enhancement step.
- **Celery Worker Layer:** Long-running crawl, Playwright/axe-equivalent DOM checks, OCR, vision, and report-generation jobs run through Celery when Redis is available; the API falls back to an in-process background thread when it is not, so local/dev setups need no broker.
- **Durable State:** Audit runs, findings, and artifact references persist in SQLite via SQLAlchemy (`repository.py`), keyed by `audit_run_id`. Screenshots, crops, and reports are stored on local disk under `AUDIT_STORAGE_DIR`.
- **No MCP in production.** MCP is not wired into the live backend. ADK `FunctionTool`s are the sole internal tool interface (see §10).

## 7. Functional Requirements

### 7.1 Website URL Intake & Document Upload Tab

The user enters either:
1. A public website URL to crawl and audit (optionally with login credentials so authenticated pages are also crawled — see §7.2a).
2. One or more scanned document images (drag-and-drop) to inspect layout regions and extract accessibility suggestions.

The UI displays a "Powered by Google Gemini" badge highlighting the active AI engine.

### 7.2 Discovery

For website audit mode, the system should discover:
- Home page.
- Important internal links.
- PDF links (such as application instructions).
- Login pages.
- Register pages.
- Search pages.
- Forms.
- Personal information pages.
- Authentication or verification pages.
- Notification settings.
- Submit or confirmation pages.

### 7.2a Authenticated Crawl (Login)

When the user supplies a login email/password with the audit request, the crawler (`tools/crawl.py`) uses one persistent Playwright browser context so session cookies survive across the whole crawl. It tries, in order: the landing page's own login form, a discovered login link, then a list of common login paths (`/login`, `/signin`, `/account/login`, etc.), including two-step email-then-password flows. On success the authenticated landing page is enqueued so logged-in-only pages (profile, dashboard, application status) get scanned too. Credentials are used only to fill and submit the login form itself — the no-auto-submit rule (§7.10) still applies to every other form the crawler encounters.

### 7.3 Session And Flow Breakdown

The agent should classify crawled pages into sessions:
- General information.
- Login.
- Register.
- Personal information.
- Authentication or identity verification.
- Notification or contact preferences.
- Document upload.
- Review and submit.
- Confirmation.
- Linked documents.

### 7.4 Source Review

The system should review public frontend source and rendered DOM:
- HTML structure, ARIA labels, form labels, button names, link text, heading order, alt text, focus order, keyboard reachability, color contrast, and error messages.

### 7.5 Linked Document Review

The system should:
- Detect linked PDFs.
- Extract text from PDFs using Python PDF parsing, with Gemini vision fallback for scanned/image-only documents.
- Flag scanned/image-only PDFs.
- Summarize instructions from linked documents.
- Map instructions to matching web flow steps.

### 7.6 Accessibility Audit

The system should run automated checks using:
- Custom Playwright-driven DOM checks (`tools/accessibility.py`) covering labeling, contrast, heading order, focus order, and flow-level problems (missing required-field instructions, positive tabindexes, vague link texts).
- The report must state that automated testing cannot prove full accessibility compliance.

### 7.7 Screenshot Evidence

The system should capture screenshots for each audited page or flow step.
Each screenshot should include:
- Numbered issue labels.
- Thick colorblind-friendly frames.
- Text callouts beside the frame.
- Severity label and issue summary.

### 7.8 Guided Fix Output

For each issue, produce:
- Issue title, flow stage, affected element, screenshot reference, source snippet, WCAG/ADA reference, plain-language explanation, recommended fix, developer ticket text, human-review note, and a **copy-paste AI fix prompt** (title, severity, stage, WCAG guideline, page URL, selector, resident impact, baseline fix, and offending HTML) that a developer can paste into any AI assistant to get a concrete corrected-code answer. The same prompt is embedded in the HTML report (with a one-click Copy button) and in the exported ticket markdown.

### 7.9 Listen Mode

The report supports a listen mode:
- Read summary and individual findings/fixes aloud using browser Web Speech API.

### 7.10 Safety And Rollback Reminder

If any guided flow involves filling fields, the system treats values as drafts only. The agent never submits public forms automatically, with the sole exception of the explicit, user-provided login form described in §7.2a.

### 7.11 Document Image Scanning (Vision Tab)

For uploaded form or letter images:
1. **AI-Powered Auto-Crop:** The system sends the uploaded image to Gemini vision to locate the boundary of the printed page/form, cropping out background noise with 5% padding.
2. **Visual Region Detection & Auto-Labeling:** The model identifies regions (headers, form inputs, body text blocks, signatures, stamps) and returns coordinates. Bounding boxes with numbered labels are drawn over the cropped image in the UI.
3. **Side-by-Side Details & suggestions:** Beside the interactive image, the UI lists detected regions, showing their type, extracted text, and accessibility suggestions.
4. **Per-Region Refine:** A "Refine" button allows users to re-submit just the cropped region image to the vision model for a detailed, highly focused analysis.
5. **Queued Multi-Image Processing:** Multiple dropped images are submitted as document jobs, processed by the backend worker queue, and accumulated into one findings set.
6. **Unified Findings Feed:** All extracted suggestions feed into the main findings table under the "Document Scan" stage, appearing in the final exported report.

## 8. Non-Functional Requirements

- The system must avoid storing sensitive personal data. Login credentials are used in-memory to perform the crawl and are never persisted to disk or the database.
- The system must not claim legal certification.
- The system must cite sources for rule explanations.
- The system must export a readable standalone HTML report and a PDF (Playwright print-to-PDF; best-effort — the HTML report remains available if PDF rendering is unavailable in the deploy environment).
- The UI must be keyboard accessible and avoid color-only status signals. Live audit progress uses an `aria-live` status region and a semantic `role="progressbar"`; per-agent-step status is shown as text, not color alone.
- The scan should finish in under 3 minutes for a standard-depth (10 page) audit.
- A failed page scan, failed document parse, or unavailable AI enhancement must be recorded as an explicit partial-result note in both the live UI and the exported report — never a silent omission.

## 9. Actual Tech Stack (As Implemented)

- **Frontend:** React with Vite. Single-page app (`src/App.jsx`) with global CSS (`src/styles.css`).
- **API Gateway:** FastAPI (`backend/app/main.py`) for audit creation, upload handling, report retrieval, cancellation, and realtime progress endpoints.
- **Agent Orchestration:** Google ADK Python. `agents/orchestrator.py` runs the checkpointed pipeline; `agents/adk_agent.py` builds the `LlmAgent` (model `gemini-2.0-flash`) and drives it through `InMemoryRunner` + `InMemorySessionService` for the best-effort narrative-enhancement step; `agents/adk_tools.py` wraps every tool function in `google.adk.tools.FunctionTool` (falling back to the plain Python function if the SDK wrapping fails, so the pipeline never breaks on a tool-registration error).
- **Worker Queue:** Celery, `broker`/`backend` = Redis, with `CELERY_TASK_ALWAYS_EAGER` support for single-process deploys (Render). When Redis is unreachable, the API transparently runs the audit in a background thread instead of failing the request.
- **Realtime Updates:** FastAPI Server-Sent Events at `/api/audits/{id}/events`. The endpoint polls the durable SQLite store (not an in-memory queue) once a second and emits heartbeat comments every 15s, so progress is visible regardless of whether the audit is executing in the API process, a background thread, or a separate Celery worker. The frontend reconnects with exponential backoff (five attempts, 0.5s–8s) and falls back to plain polling if the stream can't be re-established.
- **Browser automation:** Playwright (Python, sync API), one persistent browser context per crawl so login session cookies carry over to every subsequently crawled page.
- **Accessibility scan:** Custom Python/Playwright DOM checks (`tools/accessibility.py`) — not axe-core.
- **PDF parsing:** Python PDF parsing library, with Gemini vision fallback for scanned/image-only documents.
- **OCR / Vision Engine:** Gemini (`gemini-2.0-flash`) via `google-genai`, used for document auto-crop, region detection, and image-based text extraction. Tesseract remains available as an offline fallback path.
- **LLM Reasoning Engine:** Gemini (`gemini-2.0-flash`) via the ADK `LlmAgent`, for executive-summary writing, finding-impact rewrites, and document summaries. Enhancement is strictly best-effort: if `GOOGLE_API_KEY` is unset or the call fails, the deterministic (non-AI) report text is kept and the run's `ai.status` records why (`unavailable` / `failed`), surfaced in the UI and in the report's "Skipped and Failed Steps" section.
- **Report export:** One Python module (`tools/reporting.py`) builds the HTML report directly (no template engine) and renders it to PDF via a headless Playwright Chromium print-to-PDF pass — a second HTML render is written to a temp file with `file://` screenshot paths so images resolve in the PDF context, then discarded.
- **Durable storage:** SQLite via SQLAlchemy (`repository.py`), one row per audit run keyed by `audit_run_id`, with the full run persisted as JSON alongside indexed summary columns for the history list.
- **Artifact storage:** Local filesystem (`AUDIT_STORAGE_DIR`) for screenshots, uploaded documents, crops, annotated evidence, and exported HTML/PDF/ticket files.
- **Deployment:** `render.yaml` deploys the FastAPI service directly (`uvicorn app.main:app`) with `CELERY_TASK_ALWAYS_EAGER=1` so a single web service needs no separate worker or Redis instance; the React build is deployed as a separate static site.

## 10. Tooling Positioning

ADK tool functions (`agents/adk_tools.py`) are the only internal tool interface. There is no MCP server or client in the production path; the earlier MCP-over-stdio design from the prototype phase lives only in `legacy/` as a reference implementation.

| Capability | Interface | Implementation |
|---|---|---|
| Browser automation | ADK tool (`crawl_site`) plus Celery job | Playwright Python, persistent context, optional authenticated login |
| Accessibility scan | ADK tool (`scan_accessibility`) plus Celery job | Custom Playwright-driven DOM checks |
| Filesystem/artifacts | Backend service abstraction (`artifacts.py`) | Screenshots, crops, uploads, HTML/PDF/ticket reports on local disk |
| Document vision/OCR | ADK tool (`parse_document`, `scan_document_image`) plus Celery job | Gemini vision, Tesseract fallback |
| Report generation | ADK tool (`generate_report`) plus Celery job | Direct HTML build + Playwright print-to-PDF |
| Text-to-speech | Browser feature | Web Speech API in the React report UI |

## 11. Personalized ADK Tool Design

Each tool is a plain Python function wrapped in `google.adk.tools.FunctionTool`, structured input/output via Pydantic schemas, persisting artifacts through the backend artifact service, and reporting progress by writing the audit run back to durable storage (which the SSE endpoint then observes).

### `crawl_site`
Input: `url`, `max_pages`, `same_domain_only`, optional `login_email`/`login_password`
Execution: Celery job (or in-process thread fallback)
Output: pages, PDFs, forms, detected sessions, crawl errors, `skippedActions`, `loginNotes`

### `scan_accessibility`
Input: `page` snapshot, `audit_id`
Execution: Celery job
Output: accessibility findings, affected selectors, severity, screenshots. Retried once per page on failure before being recorded as a partial-result error.

### `parse_document`
Input: `pdf_url` or uploaded file, `source_page_url`
Execution: Celery job
Output: extracted text, image-only flag, summary, matched flow instructions. Failures are recorded on the document (`error` field) rather than aborting the audit.

### `scan_document_image`
Input: `image_base64`
Execution: Celery job
Output: cropped image, detected regions (type, bounds, text, accessibility_notes), full_text, suggestions — via Gemini vision, or a deterministic single-region fallback when no API key is configured.

### `generate_report`
Input: full `AuditRun` (findings, pages, documents, guideline mappings, fix recommendations)
Execution: Celery job
Output: `report.html`, `report.pdf` (best-effort), `tickets.md`

## 12. Agentic Flow

```text
React + Vite UI
        |
        v
FastAPI API Gateway
- validates requests (URL/SSRF checks, credential-URL rejection)
- creates audit runs
- streams progress over SSE (polls durable storage; heartbeats keep the stream alive)
- serves reports and artifacts
        |
        +--> SQLite durable audit-run storage
        |
        v
Google ADK Python Orchestrator (agents/orchestrator.py)
- runs a linear, checkpointed pipeline (not a general state machine)
- re-checks stored status at each checkpoint so cancellation takes effect promptly
- invokes typed ADK tools
        |
        +--> Discovery (crawl_site)
        |    - persistent Playwright context, optional authenticated login
        |    - on crawl failure the whole run is marked failed with a clear error
        |
        +--> Accessibility Scan (scan_accessibility, per page)
        |    - one retry per page; unrecoverable failures recorded as partial results
        |
        +--> Document Review (parse_document, per linked/uploaded document)
        |    - parse failures recorded on the document, not silently dropped
        |
        +--> Remediation
        |    - deterministic severity ranking, WCAG mapping, plain-language fix + ticket + AI fix prompt
        |
        +--> AI Enhancement (adk_agent.py: LlmAgent + InMemoryRunner, Gemini)
        |    - best-effort narrative rewrite; deterministic text kept on any failure
        |
        +--> Report Export (generate_report)
        |    - HTML + PDF (Playwright print-to-PDF) + tickets.md
        |    - failure here marks the run failed rather than silently omitting artifacts
        |
        v
Celery Worker Pool (or in-process background thread when Redis is unavailable)
        |
        +--> Playwright Python DOM scans
        +--> PDF parsing and OCR
        +--> Gemini model calls
        +--> Screenshot annotation
        +--> HTML/PDF report generation
        |
        v
SQLite (audit runs, findings, job status) + Local Artifact Storage
```

The central audit state is durable and keyed by `audit_run_id`. Partial results are recorded explicitly (page/document errors, skipped actions, AI-unavailable notes) rather than silently omitted, and surface in both the live UI and the exported report's "Skipped and Failed Steps" section.

## 13. MVP User Journey

1. User opens Civic Flow Auditor.
2. User chooses tab: **Website Audit** or **Document Scan**.
3. **Website Audit:** User enters URL, optionally supplies login credentials, chooses depth, clicks "Start audit".
4. **Document Scan:** User drags-and-drops multiple scanned form/notice images.
5. System runs the crawler and DOM accessibility checks (Website) or auto-crops and detects regions using Gemini vision (Document).
6. System displays findings in the unified findings table (under mapped journey stages or "Document Scan" stage), with live progress streamed over SSE.
7. User selects a finding to view details, crop/screenshot evidence, resident impact, ticket draft, and the copy-paste AI fix prompt.
8. For document scan regions, user can click "Refine" to re-examine a specific bounding box.
9. User clicks "Listen mode" to hear issues read aloud.
10. User clicks "Enhance with AI" to let Gemini refine the executive summary and finding narratives.
11. User exports developer tickets or downloads the full HTML/PDF report.

## 14. Report Structure

The exported report includes:
1. Executive summary (Gemini-enhanced when configured, deterministic otherwise).
2. Website scan settings and journey coverage (stages reached, pages scanned vs. discovered).
3. Severity summary strip (critical/high/medium/low counts).
4. Pages audited table.
5. Accessibility issues ranked by severity with WCAG/ADA mapping, resident impact, fix, screenshot evidence, and a copy-paste AI fix prompt per finding.
6. Linked documents and scanned files summary.
7. **Skipped and Failed Steps** — explicit list of failed page scans, unparseable/image-only documents, guardrail-skipped actions, and AI-enhancement unavailability.
8. Safety and human-review reminders.

## 15. Issue Severity Model

### Critical
Blocks a user from completing a task, such as unlabeled required fields, keyboard traps, or image-only form PDFs/documents.

### High
Major barrier, such as missing input labels, low contrast, or positive tabindexes.

### Medium
Creates confusion/friction, such as vague link texts or missing headings.

### Low
Minor improvement items.

## 16. Safety And Compliance Positioning

The product must say:
- "This is an accessibility assistance report, not legal certification."
- "Automated testing cannot detect all accessibility issues."
- "The agent will not submit forms automatically" (except the one explicit, user-authorized login form).
- "Auto-filled or suggested values are drafts and must be reviewed by the user."

## 17. Success Metrics

### Hackathon Success
- Scans both website URLs (including authenticated pages via login) and uploaded document images.
- Uses Gemini for visual crop/label and for report text enhancement.
- Outputs labeled bounding boxes on screenshots/documents.
- Pipes document scan findings into the unified report.
- Exports HTML and PDF reports.
- Demonstrates listen mode.
- Shows agentic architecture using Google ADK tools and a real `LlmAgent`, with no MCP dependency.

## 18. Migration From Prototype To Production Foundation — Status

1. ✅ Kept the React/Vite frontend; preserved the Website Audit and Document Scan user journeys.
2. ✅ Replaced the Node/Express API with FastAPI endpoints for audit creation, upload handling, progress streaming, cancellation, artifact retrieval, and report download.
3. ✅ Ported the audit engine into Python ADK tools and Celery tasks.
4. ✅ Local in-process queue replaced with Celery/Redis, with an automatic in-process thread fallback for environments without Redis.
5. ✅ Run history moved into SQLite (via SQLAlchemy) keyed by `audit_run_id`. (PostgreSQL remains a drop-in swap via `DATABASE_URL` for higher-scale deployments; not required for the hackathon scope.)
6. ✅ Screenshots, uploaded files, and report exports are served through the artifact abstraction (`artifacts.py`, `/artifacts/{audit_id}/{filename}`).
7. **Not carried forward.** MCP is not wired into the production backend; the Node/MCP prototype is archived under `legacy/` as a reference only.
8. ✅ API response shapes were kept compatible with the original frontend contract (`shared/audit-contract.js`) so the React app needed no rewrite.

## 19. Non-Goals For V1 Production Foundation

- Do not claim legal certification or full WCAG/ADA compliance verification.
- Do not submit public forms automatically, other than the one explicit, user-supplied login form used solely to establish an authenticated crawl session.
- Do not rewrite the React frontend unless required by backend contract changes.
- Do not make MCP a required part of the production orchestration layer.
- Do not store raw uploaded documents or login credentials longer than needed to complete the audit run.

## 20. Production Acceptance Criteria

A production-foundation implementation is acceptable when:

1. Creating an audit produces a durable `audit_run_id` persisted in the database. ✅
2. The FastAPI API can start, cancel, fetch, and stream progress for an audit run. ✅
3. The ADK orchestrator calls at least three typed tools: crawl, accessibility scan, and report generation. ✅
4. Celery workers execute crawl, DOM scan, OCR/vision, and report jobs outside the API process (with an in-process fallback when no broker is configured). ✅
5. SSE-backed status events update the UI without page refresh, and recover from a dropped connection via reconnect-with-backoff or polling fallback. ✅
6. Custom DOM-check findings appear in the unified findings table. ✅
7. Uploaded document findings appear in the same issue model as website findings. ✅
8. Failed pages, failed documents, and unavailable AI enhancement are recorded as partial-result warnings, not silent omissions, and shown in both the UI and the exported report. ✅
9. HTML and PDF reports can be exported from stored run artifacts. ✅
10. Reports include the required human-review and non-certification disclaimers. ✅
11. Automated tests cover URL validation, no-auto-submit behavior, and job status transitions. ✅ (OCR/model fallback and full report-generation coverage are lighter-weight and worth expanding post-hackathon.)
12. A manual smoke test can complete one website audit and one document scan from the React UI. ✅

## 21. Kaggle Demo Plan

### Demo Script
1. Paste a public website URL, start the audit.
2. While it runs, switch to the "Document Scan" tab, upload a photo of a printed government notification form.
3. Show the Gemini-powered auto-crop and region auto-labeling (colored bounding boxes).
4. Refine a region, displaying detailed field/accessibility analysis.
5. Switch back to Website Audit, show mapped stages and findings, including any authenticated pages reached via login.
6. Show how the document scan findings are piped into the same findings table.
7. Open a finding, show the copy-paste AI fix prompt, and click "Enhance with AI" (Gemini) to refine the executive summary.
8. Export both the HTML report and the PDF.
9. Demonstrate listen mode reading the top issue.

## 22. Risks And Mitigations

| Risk | Severity | Mitigation / Concrete Code Solution |
|---|---:|---|
| Automated tools miss issues | High | State limits clearly, suggest manual review |
| Legal liability claims | High | Clear disclaimers that this is assistance only |
| Messy scanned images | Medium | Auto-crop, let user manually refine regions |
| Form auto-fill submissions | High | Block all form submissions completely, except the one explicit login form the user authorizes |
| Gemini API latency or rate-limit failures | High | AI enhancement runs as a best-effort step wrapped in a broad try/except; deterministic text is kept and `ai.status` records `unavailable`/`failed`, surfaced in the UI and the report |
| Responsive bounding box scaling on fluid UI | Medium | Vision model returns normalized percentage coordinates relative to image size; rendered in React with CSS percentage styles |
| Server/API overload from multi-image drops | Medium | Each upload is a Celery document job; concurrency and file-size limits apply |
| SSE stream drop | Medium | Frontend reconnects with exponential backoff (5 attempts) then falls back to REST polling; backend adds heartbeat comments to keep the connection alive |
| Audit stranded in "scanning" after a crawl/report failure | High | Crawl and report-generation failures now explicitly mark the run `failed` with an error message instead of leaving it stuck |
| Celery job stuck or duplicated | High | Idempotent `audit_run_id`, explicit job state transitions, retry limits |
| Redis unavailable | Medium | API automatically falls back to an in-process background thread and still returns 202 immediately |
| Playwright browser crash | Medium | Retry once at page level, save page-level failure metadata, generate partial reports instead of failing the full audit silently |
| Uploaded document privacy | High | Store uploads behind artifact access controls; delete raw uploads after the configured retention window |

## 23. Competitor Landscape

Representative alternatives: Siteimprove, Monsido, Silktide, Deque axe.
Gap: Most tools check website code. Civic Flow Auditor audits full user journeys (including authenticated flows), extracts/audits text from linked documents and uploaded form photos, provides visual crop/labeling evidence, and provides plain-language developer tickets with ready-to-use AI fix prompts.

## 24. Research Sources

- ADA.gov: https://www.ada.gov/resources/2024-03-08-web-rule/
- Federal Register compliance extension: https://www.federalregister.gov/documents/2026/04/20/2026-07663/extension-of-compliance-dates-for-nondiscrimination-on-the-basis-of-disability-accessibility-of-web
- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Playwright accessibility testing: https://playwright.dev/docs/accessibility-testing
- Google ADK documentation: https://google.github.io/adk-docs/
- Google Gemini API: https://ai.google.dev/gemini-api/docs
