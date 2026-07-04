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

### Choice A: Hackathon MVP, Recommended (Implemented)

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
- Extract text from PDFs using pdf-parse or NVIDIA Vision fallback.
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
5. **Sequential Multi-Image Processing:** Multiple dropped images are queued and analyzed sequentially, accumulating findings.
6. **Unified Findings Feed:** All extracted suggestions feed into the main findings table under the "Document Scan" stage, appearing in the final exported report.

## 8. Non-Functional Requirements

- The system must avoid storing sensitive personal data.
- The system must not claim legal certification.
- The system must cite sources for rule explanations.
- The system must export a readable standalone HTML/PDF report.
- The UI must be keyboard accessible and avoid color-only status signals.
- The scan should finish in under 3 minutes.

## 9. Recommended Tech Stack

### Implemented Hackathon Stack

- **Frontend:** React with Vite.
- **UI:** CSS modules / Vanilla CSS tailored for hyper-legibility.
- **Backend:** Express.js API server.
- **Browser automation:** Playwright.
- **Accessibility scan:** `@axe-core/playwright`.
- **PDF parsing:** `pdf-parse` with NVIDIA Vision fallback.
- **OCR Engine:** NVIDIA Nemotron 3 Nano Omni (via OpenRouter) as primary; Tesseract OCR as offline fallback.
- **LLM Reasoning Engine:** NVIDIA Nemotron 3 Ultra (via OpenRouter) for report text enhancement and ticket generation.
- **Report export:** HTML first, Playwright print-to-PDF second.
- **Storage:** Local JSON SQLite for run histories.
- **MCP Server:** Exposes custom audit and vision tools.

## 10. MCP Reality Check

| Capability | Actually available? | Implementation |
|---|---:|---|
| Browser automation | Yes | Playwright controlled by backend, triggered by agent flow |
| Filesystem access | Yes | Save screenshots, JSON runs, and HTML/PDF reports |
| Custom Accessibility MCP | Custom | Expose page scanner and crawler tools |
| Custom PDF/OCR/Vision MCP | Custom | Expose `crop_document_image` and `analyze_document_regions` tools calling NVIDIA Vision API |
| Text-to-speech | Browser | Web Speech API |

## 11. Personalized Tool Design

Build a custom internal tool layer. If using MCP for the hackathon, expose these as MCP tools:

### `crawl_site`
Input: `url`, `max_pages`, `same_domain_only`
Output: pages, PDFs, forms, detected sessions, crawl errors

### `scan_accessibility`
Input: `page_url`, `viewport`
Output: axe violations, affected selectors, severity, screenshots

### `parse_document`
Input: `pdf_url` or uploaded file
Output: extracted text, image-only flag, summary, matched flow instructions

### `crop_document_image`
Input: `image_path` or `image_base64`, `padding`
Output: cropped image path, crop bounds, original size

### `analyze_document_regions`
Input: `image_path` or `image_base64`
Output: detected regions (type, bounds, text, accessibility_notes), full_text, suggestions

### `map_journey`
Input: pages, documents
Output: login flow, register flow, personal info flow, authentication flow, submit flow, documents

### `annotate_screenshot`
Input: screenshot path, issue boxes, labels
Output: annotated screenshot path

### `generate_report`
Input: scan results, screenshots, guideline mappings, fix recommendations
Output: standalone HTML and PDF reports

## 12. Agentic Flow

```text
User initiates audit (URL or Document Upload)
        |
        v
Intake and Safety Agent
- validates URL/file input safety
- warns not to enter private data
        |
        +-----------------------------------+
        | (Website mode)                    | (Document mode)
        v                                   v
Discovery Agent                     Vision & Evidence Agent
- crawls public pages               - crops scan image using Nano Omni
- finds PDFs, forms, links          - detects visual regions & labels boxes
        |                                   |
        v                                   v
Journey Mapper Agent                Document & Guideline Agent
- groups pages into sessions        - maps layout/text warnings to WCAG
        |                                   |
        +-----------------+-----------------+
                          |
                          v
               Document & Guideline Agent
               - summarizes linked PDFs
               - maps instructions to sessions
                          |
                          v
               Vision & Evidence Agent
               - captures screenshots
               - marks issue regions with boxes
                          |
                          v
               Remediation Agent (uses Ultra)
               - ranks severity
               - writes plain-language fixes
               - drafts developer tickets
                          |
                          v
               Safety & Report Agent
               - applies no-auto-submit guard
               - exports standalone HTML/PDF
               - powers listen mode
```

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
- Shows agentic multi-agent architecture and custom MCP tools.

## 18. Kaggle Demo Plan

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

## 19. Risks And Mitigations

| Risk | Severity | Mitigation / Concrete Code Solution |
|---|---:|---|
| Automated tools miss issues | High | State limits clearly, suggest manual review |
| Legal liability claims | High | Clear disclaimers that this is assistance only |
| Messy scanned images | Medium | Auto-crop, let user manually refine regions |
| Form auto-fill submissions | High | Block all form submissions completely |
| **OpenRouter API Latency or rate limit failures** | High | Wrap API requests in a try/catch block with automatic fallback to local Tesseract OCR, alerting the user via UI warning banner. |
| **Responsive bounding box scaling on fluid UI** | Medium | Command the vision model to return normalized percentage coordinates (0-100) relative to image size. Render dynamically in React absolute container using CSS percentage styles. |
| **Server/API overload from multi-image drops** | Medium | Maintain an array upload queue state in React. Iterate sequentially using async/await loops to process one document at a time. |
| **Inaccurate or hallucinated ticket details in vision** | Medium | Split the pipeline into a two-pass system: Pass 1 uses Nemotron Nano Omni for visual structure extraction; Pass 2 passes the text JSON to Nemotron Ultra for deep WCAG reasoning. |

## 20. Competitor Landscape

Representative alternatives: Siteimprove, Monsido, Silktide, Deque axe.
Gap: Most tools check website code. Civic Flow Auditor audits full user journeys, extracts/audits text from linked documents and uploaded form photos, provides visual crop/labeling evidence, and provides plain-language developer tickets.

## 21. Research Sources

- ADA.gov: https://www.ada.gov/resources/2024-03-08-web-rule/
- Federal Register compliance extension: https://www.federalregister.gov/documents/2026/04/20/2026-07663/extension-of-compliance-dates-for-nondiscrimination-on-the-basis-of-disability-accessibility-of-web
- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- axe-core npm: https://www.npmjs.com/package/axe-core
- Playwright accessibility testing: https://playwright.dev/docs/accessibility-testing
- NVIDIA Vision/Language API: https://openrouter.ai/models
