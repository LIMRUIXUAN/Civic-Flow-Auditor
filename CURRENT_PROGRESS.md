# Civic Flow Auditor — Project Context & Current Progress

> **Purpose**: This document is a complete briefing prompt for any AI agent, developer, or reviewer picking up this project. Read this before touching any code.

---

## 1. What This Project Is

**Civic Flow Auditor** is an AI agent that audits public-service websites and scanned civic documents for accessibility barriers. It crawls public pages, maps the citizen journey (login → register → form → upload → submit → confirmation), runs accessibility scans using axe-core, parses linked PDFs, analyzes scanned paper documents via vision AI, and generates annotated HTML/PDF audit reports with WCAG-mapped fix instructions.

- **Kaggle Competition**: https://www.kaggle.com/competitions/vibecoding-agents-capstone-project
- **Competition Sponsor**: Google
- **Track**: Agents for Good (primary) / Agents for Business (secondary)
- **Prize**: Kaggle swag (non-monetary)

### Why it exists
ADA Title II rules require state and local governments to meet WCAG 2.1 Level AA by 2027–2028. Small public agencies (libraries, schools, councils) have no dedicated accessibility staff. Existing tools list technical failures but do not explain the whole citizen journey, do not annotate screenshots, and do not produce plain-language fix instructions. Civic Flow Auditor fills that gap.

---

## 2. Repository Layout

```
d:\kaggle_hackathon\
├── PRD.md                          # Full product requirements document
├── README.md                       # Root readme (minimal)
├── CURRENT_PROGRESS.md             # THIS FILE — project briefing and status
└── civic-flow-auditor-prototype\   # Main project directory
    ├── src\                        # React 19 frontend (Vite)
    │   ├── App.jsx                 # Main UI (~66KB) — full audit dashboard
    │   ├── styles.css              # Design system (~40KB)
    │   └── main.jsx                # React entry
    ├── server\                     # Node.js backend + MCP server
    │   ├── api.js                  # Express 5 REST API (~20KB)
    │   ├── audit-engine.js         # Core audit logic — Playwright, axe-core (~40KB)
    │   ├── mcp-server.js           # MCP server (8 tools via @modelcontextprotocol/sdk)
    │   ├── security.js             # SSRF protection, DNS resolution guards
    │   ├── ai-provider.js          # OpenRouter AI (NVIDIA Nemotron text model)
    │   ├── vision-provider.js      # NVIDIA Vision model for document image analysis
    │   ├── report.js               # HTML + PDF report generator (~13KB)
    │   ├── store.js                # SQLite artifact storage
    │   ├── auto-crop.js            # Document photo auto-cropping via vision AI
    │   ├── genkit-orchestrator.js  # LEGACY — old Genkit orchestrator, possibly orphaned
    │   ├── config.js               # Environment config
    │   ├── ocr.js                  # Tesseract.js OCR for PDFs
    │   ├── lighthouse-runner.js    # Lighthouse accessibility score
    │   └── smoke-audit.js          # Quick smoke test script
    ├── backend\                    # Python FastAPI + Google ADK layer
    │   └── app\
    │       ├── main.py             # FastAPI app factory with CORS
    │       ├── config.py           # Settings dataclass (reads .env)
    │       ├── schemas.py          # Pydantic models (AuditRun, Finding, etc.)
    │       ├── repository.py       # SQLite persistence (SQLAlchemy)
    │       ├── security.py         # Python SSRF guards (mirrors JS security.js)
    │       ├── artifacts.py        # File artifact path management
    │       ├── worker.py           # Celery task definitions
    │       ├── agents\
    │       │   ├── orchestrator.py # Full audit pipeline (crawl -> scan -> report)
    │       │   └── adk_tools.py    # ADK FunctionTool wrappers (NO Agent/Runner yet)
    │       ├── api\
    │       │   ├── audits.py       # /api/audits CRUD + queue
    │       │   ├── documents.py    # /api/scan-image endpoint
    │       │   └── events.py       # SSE streaming events
    │       └── tools\
    │           ├── crawl.py        # Playwright site crawler
    │           ├── accessibility.py # Deterministic a11y checks
    │           ├── documents.py    # PDF parsing + image scan
    │           └── reporting.py    # Jinja2 HTML report generator
    ├── shared\                     # JS utilities shared between server + frontend
    ├── test\                       # Node.js test suite (5 test files)
    ├── .env                        # Local env vars (NOT committed)
    ├── .env.example                # Template for env setup
    ├── render.yaml                 # Render.com deployment config
    └── package.json                # Node deps: React 19, Express 5, Playwright, axe-core, MCP SDK
```

---

## 3. Tech Stack

### Node.js Layer (Primary / Currently Running)

| Component | Technology |
|-----------|------------|
| Frontend framework | React 19 + Vite 6 |
| API server | Express 5 |
| Database | Better-SQLite3 |
| Web automation | Playwright (Chromium) |
| Accessibility testing | axe-core via @axe-core/playwright |
| PDF parsing | pdf-parse |
| OCR | Tesseract.js |
| MCP protocol | @modelcontextprotocol/sdk v1.29 |
| Security | ipaddr.js + DNS SSRF guards |
| AI text model | OpenRouter -> NVIDIA Nemotron 3 Ultra 550B |
| AI vision model | OpenRouter -> NVIDIA Nemotron 3 Nano Omni 30B |
| Performance | Lighthouse v13 |

### Python Layer (Google ADK / FastAPI)

| Component | Technology |
|-----------|------------|
| API framework | FastAPI + uvicorn |
| ADK integration | google-adk >= 1.0.0 |
| Task queue | Celery + Redis (falls back to threading) |
| Database | SQLAlchemy + SQLite |
| Schemas | Pydantic v2 |
| Web automation | Playwright (Chromium) |
| PDF parsing | pypdf + pdfplumber |
| Image processing | Pillow |
| Report templates | Jinja2 |
| Testing | pytest |

---

## 4. What Is Fully Working

- **React 19 frontend** — full audit dashboard, real-time progress steps, findings table, document scanner tab, report download links
- **Node.js REST API** (`server/api.js`) — all endpoints functional: POST /api/audits, GET /api/audits, GET /api/audits/:id, cancel, scan-image, HTML reports, artifact files
- **MCP Server** (`server/mcp-server.js`) — 8 tools: crawl_site, map_journey, scan_accessibility, parse_document, crop_document_image, analyze_document_regions, annotate_screenshot, generate_report
- **Security (both JS and Python)** — SSRF protection blocks private IPs, loopback, link-local, reserved ranges; DNS resolution enforced before any crawl; unsafe HTTP methods blocked during crawls
- **Python FastAPI backend** — all routes, schemas, repository, artifacts module, and orchestrator pipeline are structurally complete
- **Node.js tests** — 5 test files covering security, audit-utils, document-findings, api, ai-provider

---

## 5. What Is Broken or Missing

### CRITICAL — Google ADK Agent Never Actually Runs

**File**: `backend/app/agents/adk_tools.py`

Current state: The file imports `google.adk.tools.FunctionTool` and wraps 5 audit functions into ADK tool objects. But **no `Agent` object is ever instantiated** and **no `Runner` is ever created**. The `orchestrator.py` calls the raw Python functions directly, bypassing ADK entirely. The ADK integration is cosmetic only and will not satisfy the competition judging criterion.

What needs to be created — `backend/app/agents/adk_agent.py`:

```python
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from .adk_tools import ADK_TOOLS

civic_agent = LlmAgent(
    name="civic-flow-auditor",
    model="gemini-2.0-flash",
    tools=ADK_TOOLS,
    instruction=(
        "You are a civic accessibility auditor. Use the provided tools to "
        "crawl the given URL, scan pages for accessibility issues, parse "
        "linked documents, and generate a comprehensive audit report."
    ),
)
```

Then wire the `Runner` into the FastAPI `POST /api/audits` endpoint so audit runs go through the ADK agent loop.

### CRITICAL — genkit-orchestrator.js Status Unknown

`server/genkit-orchestrator.js` (8KB) is likely the old Genkit-based orchestrator from before the ADK pivot. Need to verify it is not still imported anywhere causing startup errors. If unused, delete it or add a comment marking it as legacy.

### MISSING — Kaggle Submission Assets (all required to submit)

| Asset | Status | Requirement |
|-------|--------|-------------|
| YouTube video (max 5 min) | NOT recorded | Required |
| Kaggle Writeup (max 2500 words) | NOT drafted | Required |
| Cover image in media gallery | MISSING | Required to submit |
| Public project link or GitHub URL | NOT set up | Required |
| Architecture diagram image | MISSING | Strongly recommended |

### Competition Evaluation Criteria Gaps

The competition requires demonstrating **at least 3** of the following:

| Concept | Requirement | Current Status |
|---------|-------------|----------------|
| Agent / Multi-agent system (ADK) | Must show in Code | BROKEN — wrappers exist, no Agent/Runner |
| MCP Server | Must show in Code | COMPLETE (Node.js MCP server) |
| Antigravity | Must show in Video | Used during dev — must capture in video |
| Security features | Code or Video | COMPLETE in code (both layers) |
| Deployability | Must show in Video | render.yaml exists, not yet shown in video |
| Agent skills / Agents CLI | Code or Video | Not yet demonstrated |

---

## 6. Environment Variables

Key variables (see `.env.example`):

```
OPENROUTER_API_KEY=...
AI_PROVIDER=openrouter
VISION_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
TEXT_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
AUDIT_STORAGE_DIR=.audit-runs
PORT=8787
MAX_PAGES=10
ENABLE_OCR=1
ENABLE_LIGHTHOUSE=0
```

---

## 7. How to Run Locally

### Node.js stack (primary)

```bash
cd civic-flow-auditor-prototype
npm install
npx playwright install chromium
cp .env.example .env   # fill in OPENROUTER_API_KEY

# Terminal 1 — API server (port 8787)
npm run dev:api

# Terminal 2 — Frontend (port 5173)
npm run dev

# MCP server (stdio, for AI client connections)
npm run mcp:start
```

### Python stack (Google ADK / FastAPI)

```bash
cd civic-flow-auditor-prototype/backend
pip install -r requirements.txt
python -m playwright install chromium

# API server (port 8787)
uvicorn app.main:app --host 127.0.0.1 --port 8787

# Background task worker (optional — falls back to threading without Redis)
celery -A app.worker.celery_app worker --loglevel=info

# Tests
pytest
```

---

## 8. Immediate Action Plan (Priority Order)

### P0 — Required for Competition Scoring

1. **Create `backend/app/agents/adk_agent.py`** — Instantiate a real `LlmAgent` with `ADK_TOOLS` and a `Runner`. Wire it into the `POST /api/audits` FastAPI endpoint so the ADK agent drives the audit pipeline. This is the single most important fix.

2. **Audit `server/genkit-orchestrator.js`** — Determine if it is still imported. If not, delete it or add a comment marking it as a legacy reference.

### P1 — Required for Kaggle Submission

3. **Update `README.md`** — Add architecture diagram, full setup instructions for both stacks, ADK explanation, MCP tool list with descriptions.

4. **Record YouTube demo video** (max 5 minutes) covering:
   - Problem statement (civic accessibility gap, ADA Title II deadlines)
   - Architecture overview with diagram
   - Live demo of an audit running against a real public civic site
   - Show Antigravity IDE being used to build it
   - Show MCP server in action via mcp:inspect or similar
   - Show `render.yaml` deployment config

5. **Draft Kaggle Writeup** (max 2500 words) — problem, solution, architecture, build journey. Attach video and cover image to media gallery.

6. **Submit to Kaggle** before deadline.

### P2 — Polish

7. Add Python pytest tests for `orchestrator.py`, `security.py`, and `tools/` modules
8. Add architecture diagram SVG/PNG to repo and embed in README
9. Verify `render.yaml` correctly starts the Python backend (not the Node.js one)

---

## 9. Important Notes for Future Work

- **Never commit API keys.** Use `.env` only (already in `.gitignore`).
- The Node.js `server/` layer is the battle-tested primary runtime. The Python `backend/` is the Google ADK demo layer for the competition.
- Both backends expose the same API surface (`/api/audits`, `/reports/`, `/artifacts/`) so the React frontend works with either.
- The Python backend gracefully falls back from Celery+Redis to a simple daemon thread if Redis is unavailable — no extra infrastructure needed for demos.
- The `shared/` directory contains JS utilities used by both `server/` and `src/` — do not duplicate them in Python.
- WCAG 2.1 Level AA is the target compliance standard for all findings.
- The MCP server runs over stdio — it is a separate process from the HTTP API server.
- The project was originally built with a Genkit orchestrator, then migrated to Google ADK. The migration is **incomplete** — tools are wrapped but the agent is not instantiated.
