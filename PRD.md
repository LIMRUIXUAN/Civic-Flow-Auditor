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
A focused version can be built with Playwright, axe-core, PDF parsing, screenshot annotation, LLM report writing (using NVIDIA Nemotron 3 Ultra), document scanning (using NVIDIA Nemotron 3 Nano Omni), and a React-based web UI.

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
5. What the team should fix.
6. What needs human review before submission or publication.

## 6. Scope Choices

### Choice A: Hackathon MVP / Prototype

Build a dual-mode public website and document auditor with:
- **Intake Tab Switcher:**
  - **Website Audit Mode:** Crawl up to 10 pages on a domain, detect forms/documents, run axe-core accessibility checks, and generate annotated screenshots.
  - **Document Scan Mode:** Drag-and-drop multiple document images (printed forms or notices), auto-crop using AI, detect visual regions, and generate accessibility suggestions.
- **NVIDIA AI Integration:**
  - **NVIDIA Nemotron 3 Nano Omni (Vision):** Handles document auto-cropping, visual region detection (labels bounding boxes), and text extraction.
  - **NVIDIA Nemotron 3 Ultra (Text):** Performs report text enhancement, plain-language fix writing, and developer ticket drafting.
- **Unified Findings Report:**
  - Document scan findings feed directly into the main issue queue under the "Document Scan" stage, exporting into one cohesive HTML/PDF report.
- **Listen Mode:** Using browser text-to-speech Web Speech API.
- **Safety and Guardrails:** Safety notices warning that suggestions are drafts, the agent never auto-submits, and human review is required.

### Choice B: Production Foundation, Recommended For Refactor

Refactor the product architecture to keep the same user-facing audit experience while making the backend production-ready:
- **React/Vite Frontend:** Preserve the current intake, findings, evidence, listen-mode, and export workflows.
- **FastAPI Gateway:** Own request validation, audit creation, uploads, cancellation, progress streaming, and report/artifact access.
- **Google ADK Python Orchestration:** Coordinate specialized agents and typed tools for discovery, journey mapping, document analysis, remediation, and report assembly.
- **Celery/Redis Worker Layer:** Run long-running crawl, Playwright/axe, OCR, vision, annotation, and report-generation jobs outside the API process.
- **Durable State:** Persist audit runs, findings, job states, and artifact references in PostgreSQL and object/local artifact storage.
- **Optional MCP Adapter:** Keep MCP available only as a demo or interoperability layer over the same ADK-backed tools.

## 7. Functional Requirements

### 7.1 Website URL Intake & Document Upload Tab

The user enters either:
1. A public website URL to crawl and audit.
2. One or more scanned document images (drag-and-drop) to inspect layout regions and extract accessibility suggestions.

The UI displays a tasteful "Powered by NVIDIA Nemotron" badge highlighting the active AI engines.

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
- Extract text from PDFs using Python PDF parsing (`pypdf` or `pdfplumber`) or NVIDIA Vision fallback.
- Flag scanned/image-only PDFs.
- Summarize instructions from linked documents.
- Map instructions to matching web flow steps.

### 7.6 Accessibility Audit

The system should run automated checks using:
- axe-core for rendered page accessibility issues.
- Custom checks for flow-level problems (missing required-field instructions, positive tabindexes, vague link texts).
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
- Issue title, flow stage, affected element, screenshot reference, source snippet, WCAG/ADA reference, plain-language explanation, recommended fix, developer ticket text, and human-review note.

### 7.9 Listen Mode

The report supports a listen mode:
- Read summary and individual findings/fixes aloud using browser Web Speech API.

### 7.10 Safety And Rollback Reminder

If any guided flow involves filling fields, the system treats values as drafts only. The agent never submits public forms automatically.

### 7.11 Document Image Scanning (Vision Tab)

For uploaded form or letter images:
1. **AI-Powered Auto-Crop:** The system sends the uploaded image to NVIDIA Nemotron 3 Nano Omni to locate the boundary of the printed page/form, cropping out background noise with 5% padding.
2. **Visual Region Detection & Auto-Labeling:** The model identifies regions (headers, form inputs, body text blocks, signatures, stamps) and returns coordinates. Bounding boxes with numbered labels are drawn over the cropped image in the UI.
3. **Side-by-Side Details & suggestions:** Beside the interactive image, the UI lists detected regions, showing their type, extracted text, and accessibility suggestions.
4. **Per-Region Refine:** A "Refine" button allows users to re-submit just the cropped region image to the vision model for a detailed, highly focused analysis.
5. **Queued Multi-Image Processing:** Multiple dropped images are submitted as document jobs, processed by the backend worker queue, and accumulated into one findings set.
6. **Unified Findings Feed:** All extracted suggestions feed into the main findings table under the "Document Scan" stage, appearing in the final exported report.

## 8. Non-Functional Requirements

- The system must avoid storing sensitive personal data.
- The system must not claim legal certification.
- The system must cite sources for rule explanations.
- The system must export a readable standalone HTML/PDF report.
- The UI must be keyboard accessible and avoid color-only status signals.
- The scan should finish in under 3 minutes.

## 9. Recommended Tech Stack

### Production Foundation Stack

Use Google ADK as the agent orchestration layer, with Python as the backend runtime. ADK supports multiple languages, including Python and TypeScript, so Python is a product architecture choice rather than a platform limitation. Python is preferred here because the production backend needs long-running worker jobs, browser automation, PDF/OCR processing, structured artifact handling, and reliable queue orchestration.

- **Frontend:** React with Vite.
- **UI:** CSS modules / Vanilla CSS tailored for hyper-legibility.
- **API Gateway:** FastAPI for audit creation, upload handling, report retrieval, cancellation, and realtime progress endpoints.
- **Agent Orchestration:** Google ADK Python for the central orchestrator and specialized agents.
- **Worker Queue:** Celery with Redis broker/result backend for crawl, scan, OCR, vision, annotation, and report-generation jobs.
- **Realtime Updates:** FastAPI Server-Sent Events (SSE) or WebSocket endpoint backed by Redis audit progress events.
- **Browser automation:** Playwright Python.
- **Accessibility scan:** axe-core injected through Playwright page context, with custom Python checks for journey-level issues.
- **PDF parsing:** `pypdf` or `pdfplumber`, with NVIDIA Vision fallback for scanned/image-only documents.
- **OCR Engine:** NVIDIA Nemotron 3 Nano Omni (via OpenRouter) as primary for visual document understanding; Tesseract OCR as offline fallback.
- **LLM Reasoning Engine:** NVIDIA Nemotron 3 Ultra (via OpenRouter) for report text enhancement, issue explanation, WCAG mapping, and developer ticket generation.
- **Report export:** Jinja2 HTML report first, Playwright print-to-PDF second.
- **Durable storage:** PostgreSQL for audit runs, findings, job status, and report metadata.
- **Artifact storage:** Local filesystem for development; S3-compatible object storage for screenshots, uploaded documents, crops, annotated evidence, and exported reports in production.
- **Deployment:** Docker Compose for local production simulation; container deployment to Cloud Run, GKE, Render, or equivalent for hosted environments.

### Prototype Compatibility

The existing React/Vite prototype can remain the frontend. Production work should preserve the current user-facing flow while replacing the Node/Express backend implementation with the Python ADK backend. API response shapes should stay compatible where practical to reduce frontend rewrite risk.

## 10. Tooling And MCP Positioning

ADK tool functions are the primary internal interface for production. MCP is optional and useful for hackathon/demo integrations or external assistant access, but the production product should not depend on MCP as the core service boundary.

| Capability | Production interface | Implementation |
|---|---|---|
| Browser automation | ADK tool plus Celery job | Playwright Python runs in isolated workers |
| Accessibility scan | ADK tool plus Celery job | axe-core injected through Playwright, plus Python custom checks |
| Filesystem/artifacts | Backend service abstraction | Store screenshots, crops, uploads, HTML, and PDF reports in local/S3-compatible storage |
| Document vision/OCR | ADK tool plus Celery job | NVIDIA Vision via OpenRouter with Tesseract fallback |
| Report generation | ADK tool plus Celery job | Jinja2 HTML and Playwright PDF export |
| External tool access | Optional MCP adapter | Expose selected ADK-backed tools for demo/client interoperability |
| Text-to-speech | Browser feature | Web Speech API in the React report UI |

## 11. Personalized ADK Tool Design

Build a custom internal tool layer exposed as Python ADK tool functions. Each tool must use structured input/output schemas, persist artifacts through the backend artifact service, and report progress through Redis-backed audit events.

### `crawl_site`
Input: `url`, `max_pages`, `same_domain_only`
Execution: Celery job
Output: pages, PDFs, forms, detected sessions, crawl errors

### `scan_accessibility`
Input: `page_url`, `viewport`
Execution: Celery job
Output: axe violations, affected selectors, severity, screenshots

### `parse_document`
Input: `pdf_url` or uploaded file
Execution: Celery job
Output: extracted text, image-only flag, summary, matched flow instructions

### `crop_document_image`
Input: `image_path` or `image_base64`, `padding`
Execution: Celery job
Output: cropped image path, crop bounds, original size

### `analyze_document_regions`
Input: `image_path` or `image_base64`
Execution: Celery job
Output: detected regions (type, bounds, text, accessibility_notes), full_text, suggestions

### `map_journey`
Input: pages, documents
Execution: ADK synchronous reasoning step after crawl/document summaries are available
Output: login flow, register flow, personal info flow, authentication flow, submit flow, documents

### `annotate_screenshot`
Input: screenshot path, issue boxes, labels
Execution: Celery job
Output: annotated screenshot path

### `generate_report`
Input: scan results, screenshots, guideline mappings, fix recommendations
Execution: Celery job
Output: standalone HTML and PDF reports

## 12. Agentic Flow

```text
React + Vite UI
        |
        v
FastAPI API Gateway
- validates requests
- creates audit runs
- streams progress over SSE/WebSocket
- serves reports and artifacts
        |
        +--> Redis progress/events
        |
        v
Google ADK Python Orchestrator
- owns audit plan and agent routing
- invokes typed ADK tools
- stores central audit state
        |
        +--> Intake and Safety Agent
        |    - validates URL/file input safety
        |    - warns not to enter private data
        |    - blocks automatic form submission
        |
        +--> Discovery Agent
        |    - schedules crawl jobs
        |    - finds PDFs, forms, links, and candidate flows
        |
        +--> Journey Mapper Agent
        |    - groups pages and documents into user sessions
        |    - maps linked instructions to flow stages
        |
        +--> Document and Vision Agent
        |    - schedules OCR, crop, and region-analysis jobs
        |    - normalizes document findings into the issue model
        |
        +--> Remediation Agent
        |    - ranks severity
        |    - maps findings to WCAG/ADA references
        |    - drafts plain-language fixes and developer tickets
        |
        +--> Safety and Report Agent
        |    - verifies report disclaimers
        |    - assembles HTML/PDF exports
        |    - prepares listen-mode content
        |
        v
Celery Worker Pool
        |
        +--> Playwright Python + axe-core scans
        +--> PDF parsing and OCR
        +--> NVIDIA/OpenRouter model calls
        +--> Screenshot annotation
        +--> HTML/PDF report generation
        |
        v
PostgreSQL + Artifact Storage
- audit runs
- findings
- job statuses
- screenshots/crops/uploads/reports
```

The central audit state is durable and keyed by `audit_run_id`. Agents should be able to resume from persisted state after worker failure, API restart, or transient model/API errors. Partial results are acceptable when a page, PDF, or model call fails, but the final report must identify skipped or failed steps.

## 13. MVP User Journey

1. User opens Civic Flow Auditor.
2. User chooses tab: **Website Audit** or **Document Scan**.
3. **Website Audit:** User enters URL, chooses depth, clicks "Start audit".
4. **Document Scan:** User drags-and-drops multiple scanned form/notice images.
5. System runs crawler/axe-core (Website) or auto-crops and detects regions using NVIDIA Nemotron Nano Omni (Document).
6. System displays findings in the unified findings table (under mapped journey stages or "Document Scan" stage).
7. User selects a finding to view details, crop/screenshot evidence, resident impact, and ticket drafts.
8. For document scan regions, user can click "Refine" to re-examine a specific bounding box.
9. User clicks "Listen mode" to hear issues read aloud.
10. User clicks "Enhance with AI" to let NVIDIA Nemotron 3 Ultra refine details.
11. User exports developer tickets or downloads the full HTML/PDF report.

## 14. Report Structure

The exported report includes:
1. Executive summary (AI-enhanced by Nemotron 3 Ultra).
2. Website scan settings.
3. Linked documents and scanned files summary.
4. User journey map (with Website and Document Scan stages).
5. Accessibility issues ranked by severity with WCAG/ADA mapping.
6. Screenshot/cropped image evidence with numbered label frames.
7. Plain-language suggested fixes and developer ticket drafts.
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
- "The agent will not submit forms automatically."
- "Auto-filled or suggested values are drafts and must be reviewed by the user."

## 17. Success Metrics

### Hackathon Success
- Scans both website URLs and uploaded document images.
- Uses NVIDIA Nemotron Nano Omni for visual crop/label and Ultra for report text.
- Outputs labeled bounding boxes on screenshots/documents.
- Pipes document scan findings into the unified report.
- Exports HTML/PDF report.
- Demonstrates listen mode.
- Shows agentic multi-agent architecture using Google ADK tools, with MCP only as an optional demo adapter if needed.

## 18. Migration From Prototype To Production Foundation

The current prototype should be treated as a reference implementation for UX, data shape, and demo behavior, not as the final backend architecture.

1. Keep the React/Vite frontend and preserve the Website Audit and Document Scan user journeys.
2. Replace the Node/Express API with FastAPI endpoints for audit creation, document upload, progress streaming, cancellation, artifact retrieval, and report download.
3. Port the existing audit engine behavior into Python ADK tools and Celery tasks.
4. Replace the local in-process audit queue with Celery and Redis.
5. Move run history from local JSON/SQLite-style storage into PostgreSQL tables keyed by `audit_run_id`.
6. Move screenshots, crops, uploaded files, and report exports behind an artifact storage abstraction.
7. Keep MCP only as an optional adapter that can call the same ADK-backed tool functions for demos or external assistant integrations.
8. Preserve API response compatibility where practical so the frontend can migrate incrementally.

## 19. Non-Goals For V1 Production Foundation

- Do not claim legal certification or full WCAG/ADA compliance verification.
- Do not submit public forms automatically.
- Do not handle resident login credentials or private authenticated civic portals.
- Do not rewrite the React frontend unless required by backend contract changes.
- Do not make MCP the required production orchestration layer.
- Do not store raw uploaded documents longer than the configured retention window.

## 20. Production Acceptance Criteria

A production-foundation implementation is acceptable when:

1. Creating an audit produces a durable `audit_run_id` persisted in PostgreSQL.
2. The FastAPI API can start, cancel, fetch, and stream progress for an audit run.
3. The ADK orchestrator calls at least three typed tools: crawl, accessibility scan, and report generation.
4. Celery workers execute crawl, Playwright/axe, OCR/vision, annotation, and report jobs outside the API process.
5. Redis-backed status events update the UI without page refresh.
6. Playwright + axe-core findings appear in the unified findings table.
7. Uploaded document findings appear in the same issue model as website findings.
8. Failed pages, failed documents, and failed model calls are recorded as partial-result warnings, not silent omissions.
9. HTML and PDF reports can be exported from stored run artifacts.
10. Reports include the required human-review and non-certification disclaimers.
11. Automated tests cover URL validation, no-auto-submit behavior, job status transitions, fallback OCR/model handling, and report generation.
12. A manual smoke test can complete one website audit and one document scan from the React UI.

## 21. Kaggle Demo Plan

### Demo Script
1. Paste a public website URL, start the audit.
2. While it runs, switch to the "Document Scan" tab, upload a photo of a printed government notification form.
3. Show the NVIDIA Nano Omni auto-crop and region auto-labeling (colored bounding boxes).
4. Refine a region, displaying detailed field/accessibility analysis.
5. Switch back to Website Audit, show mapped stages and axe-core findings.
6. Show how the document scan findings are piped into the same findings table.
7. Click "Enhance with AI" using NVIDIA Nemotron 3 Ultra to refine the executive summary.
8. Export the unified HTML/PDF report.
9. Demonstrate listen mode reading the top issue.

## 22. Risks And Mitigations

| Risk | Severity | Mitigation / Concrete Code Solution |
|---|---:|---|
| Automated tools miss issues | High | State limits clearly, suggest manual review |
| Legal liability claims | High | Clear disclaimers that this is assistance only |
| Messy scanned images | Medium | Auto-crop, let user manually refine regions |
| Form auto-fill submissions | High | Block all form submissions completely |
| **OpenRouter API latency or rate-limit failures** | High | Add ADK tool-level retries with bounded backoff, persist partial status, fall back to local Tesseract OCR where possible, and show a UI warning banner. |
| **Responsive bounding box scaling on fluid UI** | Medium | Command the vision model to return normalized percentage coordinates (0-100) relative to image size. Render dynamically in React absolute container using CSS percentage styles. |
| **Server/API overload from multi-image drops** | Medium | Submit each upload as a Celery document job, cap worker concurrency, enforce file-size limits, and stream queue position/progress through Redis-backed events. |
| **Inaccurate or hallucinated ticket details in vision** | Medium | Split the pipeline into a two-pass system: Pass 1 uses Nemotron Nano Omni for visual structure extraction; Pass 2 passes source-grounded JSON to Nemotron Ultra for WCAG reasoning. Require every AI-generated recommendation to link back to a finding, screenshot, DOM selector, or document region. |
| **Celery job stuck or duplicated** | High | Use idempotent `audit_run_id` and task keys, explicit job state transitions, retry limits, timeouts, and cancellation checks before writing final artifacts. |
| **Redis unavailable** | High | API accepts no new audit jobs, reports degraded queue status, and preserves existing PostgreSQL audit records for later recovery. |
| **Playwright browser crash** | Medium | Retry at page level, save page-level failure metadata, and generate partial reports instead of failing the full audit silently. |
| **Uploaded document privacy** | High | Store uploads behind artifact access controls, redact sensitive previews where possible, and delete raw uploads after the configured retention window. |

## 23. Competitor Landscape

Representative alternatives: Siteimprove, Monsido, Silktide, Deque axe.
Gap: Most tools check website code. Civic Flow Auditor audits full user journeys, extracts/audits text from linked documents and uploaded form photos, provides visual crop/labeling evidence, and provides plain-language developer tickets.

## 24. Research Sources

- ADA.gov: https://www.ada.gov/resources/2024-03-08-web-rule/
- Federal Register compliance extension: https://www.federalregister.gov/documents/2026/04/20/2026-07663/extension-of-compliance-dates-for-nondiscrimination-on-the-basis-of-disability-accessibility-of-web
- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- axe-core npm: https://www.npmjs.com/package/axe-core
- Playwright accessibility testing: https://playwright.dev/docs/accessibility-testing
- Google ADK documentation: https://adk.dev/
- NVIDIA Vision/Language API: https://openrouter.ai/models
