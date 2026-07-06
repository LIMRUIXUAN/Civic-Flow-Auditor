# Civic Flow Auditor

An AI-powered agentic system that audits public-service website journeys and scanned document forms/notices, finds accessibility barriers, maps them to ADA/WCAG guidelines, and exports an annotated report detailing exactly what and how to fix.

This project was built for the **Kaggle AI Agents Capstone Project**.

## Problem & Solution
Local governments struggle to keep up with 2027 ADA Title II compliance deadlines. Traditional automated scanners (like axe-core) only check static HTML and provide technical developer output, ignoring multi-page user journeys, PDF documents, and physical forms. 

**Civic Flow Auditor** solves this by using a multi-agent orchestrated workflow. It maps entire citizen journeys (e.g. applying for a permit), uses Vision models to audit printed forms/notices, and translates technical violations into plain-language recommendations and developer tickets.

## Architecture Highlights
- **Google Genkit (ADK):** A robust State Machine orchestrator that routes the audit across multiple specialized agents.
- **MCP Client Integration:** The orchestrator utilizes the official `@modelcontextprotocol/sdk` to securely call local audit tools (crawling, accessibility scanning, etc.) over an Stdio transport.
- **Security Guardrails:** Enforces strict URL validation and domain allowlisting to prevent cross-domain traversal, alongside a hardcoded "no-auto-submit" rule for public forms.
- **Real-Time UI Updates:** The Genkit flow streams updates via SSE directly to the React frontend.
- **Deployability:** The project includes a `render.yaml` for easy container-less deployment to Render.com.

For the full 2,500-word Capstone writeup and detailed technical architecture, please see [`kaggle_submission_architecture.md`](./kaggle_submission_architecture.md).

## Local Setup Instructions

**Prerequisites:** Node.js (v18+)

```bash
# 1. Navigate to the prototype directory
cd civic-flow-auditor-prototype

# 2. Install dependencies
npm install

# 3. Setup environment variables
cp .env.example .env
# Edit .env and add your Google Gemini API key and OpenRouter API key

# 4. Run tests
npm run test

# 5. Build for production (Optional)
npm run build

# 6. Start the local dev server
npm run dev
```

Visit `http://localhost:5173` to start an audit!
