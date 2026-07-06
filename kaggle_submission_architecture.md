# Civic Flow Auditor: AI Agents Capstone Project Architecture

## 1. Project Summary

**Product name:** Civic Flow Auditor
**Goal:** An AI-powered agentic system that audits public-service website journeys and scanned document forms/notices, finds accessibility barriers, maps them to ADA/WCAG guidelines, and exports an annotated report detailing exactly what and how to fix.

Civic Flow Auditor leverages a **Central Orchestrator** multi-agent architecture and the Model Context Protocol (MCP) to seamlessly blend web scraping, visual accessibility analysis, and automated compliance auditing.

---

## 2. Multi-Agent Orchestrator Architecture

Our system adopts a **Central Orchestrator Pattern**. A primary orchestrator agent manages the execution flow, receiving the user's initial prompt (e.g., a URL to a civic portal or an uploaded form image) and dynamically calling upon specialized sub-agents (via MCP tools) to complete the audit.

### Backend Implementation Details

- **Framework:** The Central Orchestrator is built using **Google ADK (Agent Development Kit)** to construct a robust multi-agent workflow. This aligns with the core course concepts and manages the dynamic tool usage.
- **Data Passing:** Context is passed between the ADK agents using a **Central Audit State Object**. This single shared JSON state is updated at the end of each agent execution.
- **UI Real-Time Updates:** As the ADK agents update the Central Audit State Object (`saveAuditRun`), it automatically triggers the existing Server-Sent Events (SSE) endpoint to push real-time progress updates to the React frontend.
- **Security Features:** The orchestrator enforces strict security guardrails, specifically **URL Validation and Domain Allowlisting** (to prevent cross-domain crawling attacks) and a hardcoded "no-auto-submit" rule for public forms.
- **Error Handling:** The orchestrator implements a **Retry with Fallback** strategy. If OpenRouter API rate limits are hit during reasoning, it will gracefully fallback to local/simpler models to ensure the audit always completes.

### Specialized Agents

1. **Intake and Safety Agent**
   - Validates user input (URL or file).
   - Enforces guardrails, issuing warnings against entering personally identifiable information (PII).
2. **Discovery Agent**
   - Crawls the provided public domain.
   - Discovers relevant web pages, internal links, PDF documents, and web forms.
3. **Vision & Evidence Agent**
   - Analyzes uploaded or discovered documents/forms.
   - Crops document scans to reduce noise.
   - Identifies and labels visual structural regions (headers, inputs, signatures) on the document using bounding boxes.
4. **Journey Mapper Agent**
   - Groups discovered pages into logical user sessions (e.g., General Info, Login, Register, Submit).
5. **Remediation Agent**
   - Ranks the severity of detected accessibility issues based on WCAG/ADA guidelines.
   - Drafts plain-language explanations of the barriers.
   - Generates actionable developer tickets to resolve the issues.
6. **Safety & Report Agent**
   - Assembles the findings into a cohesive, standalone HTML/PDF report.
   - Powers the "Listen Mode" by integrating with browser Text-to-Speech (TTS) APIs.
   - Applies the "no-auto-submit" guard, explicitly restricting agents from submitting civic forms on behalf of the user.

---

## 3. The Model Stack

To handle the complexity of visual layout analysis and deep compliance reasoning, the agents utilize NVIDIA Nemotron models accessed via **OpenRouter**:

*   **Vision Tasks (NVIDIA Nemotron 3 Nano Omni):** Used extensively by the Vision & Evidence Agent. It excels at document auto-cropping, visual region detection (returning coordinates for bounding boxes), and extracting unstructured text from complex form layouts.
*   **Reasoning & Orchestration (NVIDIA Nemotron 3 Ultra):** Powers the Central Orchestrator and the Remediation Agent. It handles the complex logic of mapping technical accessibility violations (`axe-core` output) to plain-language WCAG recommendations and developer ticket drafting.

---

## 4. MCP (Model Context Protocol) Integration

The central orchestrator interacts with the underlying infrastructure via an MCP Server.

### MCP Client Integration

Inside the ADK workflow, we utilize the `@modelcontextprotocol/sdk` client to connect to our local MCP server. This demonstrates true, decoupled MCP tool consumption, allowing the Orchestrator to securely call tools without hardcoding their execution logic.

### Exposed Tools

The `civic-flow-auditor-prototype` exposes the following custom tools to the agents:

*   `crawl_site`: Inputs a URL; outputs a list of discovered pages and PDFs.
*   `map_journey`: Inputs a list of pages; outputs classified user flow stages (e.g., authentication flow, submission flow).
*   `scan_accessibility`: Inputs a page URL; outputs `axe-core` violations, affected DOM selectors, severity rankings, and triggers screenshots.
*   `parse_document`: Inputs a PDF; extracts text and flags inaccessible image-only PDFs.
*   `crop_document_image`: Inputs an image path; outputs a cropped image isolating the main document.
*   `analyze_document_regions`: Inputs a document image; outputs detected regions (type, bounds, text) and accessibility suggestions.
*   `annotate_screenshot`: Inputs a screenshot and issue coordinates; outputs a new screenshot with colored issue frames rendered on top.
*   `generate_report`: Compiles the unified findings into HTML and PDF deliverables.

---

## 5. Kaggle Capstone Demo Script (5-Minute Video)

This structured storyboard acts as a guide for recording the required Kaggle Capstone demo video.

**0:00 - 0:45 | Introduction & The Problem**
*   **Visual:** The Civic Flow Auditor home page.
*   **Narration:** Introduce the project. Briefly mention the 2027 ADA Title II compliance deadlines and how small local governments struggle with accessibility audits. Explain that Civic Flow Auditor maps entire citizen journeys and physical forms, not just code.

**0:45 - 1:45 | Website Audit & Journey Mapping**
*   **Visual:** Enter a public civic URL (e.g., a local DMV or library site) into the "Website Audit" tab. Click Start.
*   **Narration:** Show the Central Orchestrator delegating to the Discovery Agent to find pages and the Journey Mapper Agent to group them into a logical flow (e.g., Login -> Application -> Submit).

**1:45 - 3:00 | Vision & Document Scanning**
*   **Visual:** Switch to the "Document Scan" tab. Upload a photo of a printed government notification or form.
*   **Narration:** Highlight the integration of **NVIDIA Nemotron 3 Nano Omni**. Watch as the Vision Agent auto-crops the image and draws labeled bounding boxes around regions (headers, inputs, signatures).
*   **Visual:** Click "Refine" on one specific bounding box to show the detailed accessibility extraction for that field.

**3:00 - 4:00 | AI Remediation & Unified Report**
*   **Visual:** Switch back to the main unified findings table where both website `axe-core` findings and document scan findings have been aggregated.
*   **Narration:** Highlight how the Remediation Agent (using **NVIDIA Nemotron 3 Ultra**) took the raw technical output and drafted a plain-language explanation and a ready-to-use developer ticket.

**4:00 - 5:00 | Export, Antigravity & Conclusion**
*   **Visual:** Show the user utilizing **Antigravity** within the IDE (e.g., dynamically modifying a UI component based on the accessibility report or reviewing the architecture). Click the "Listen Mode" button to hear the browser read a finding aloud. Then, click export and open the standalone PDF report.
*   **Narration:** Highlight how Antigravity accelerated the vibe coding process for this project. Reiterate the security features (domain allowlisting and no automatic form submissions). Conclude with how this ADK and MCP architecture empowers civic agencies.
