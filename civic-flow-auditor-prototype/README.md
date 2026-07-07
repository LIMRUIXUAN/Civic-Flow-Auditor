# Civic Flow Auditor Prototype

Civic Flow Auditor is an automated tool designed to audit public civic websites for accessibility, citizen journey mapping, and document analysis. It utilizes modern web automation, OCR, and Large Language Models (LLMs) to scan pages, map user journeys (e.g., login, forms, document uploads), and test for accessibility compliance. 

The project includes an API, a frontend application, and a **Model Context Protocol (MCP)** server integration.

## Features

- **Site Crawling & Journey Mapping**: Discovers public pages, forms, and PDFs on civic domains and classifies them into distinct stages of the citizen journey (login, register, personal info, upload, submit, etc.).
- **Accessibility Scanning**: Leverages `axe-core` and custom checks to scan public pages for accessibility violations and renders them into annotated screenshots for easy review.
- **Document & Form Parsing**: Extracts text from civic PDFs and detects image-only documents using OCR (`Tesseract.js`) and `pdf-parse`.
- **Vision-based Region Analysis**: Uses Google Gemini vision (via the Google Agent Development Kit) to analyze layout regions of printed/photographed documents, providing auto-cropping and layout accessibility insights.
- **Comprehensive Reporting**: Generates standalone HTML and PDF artifacts summarizing audit runs.
- **MCP Server**: Fully compatible with the Model Context Protocol, enabling AI assistants to directly invoke tools like `crawl_site`, `scan_accessibility`, and `run_civic_flow_audit`.

## Tech Stack

- **Frontend**: React 19, Vite, Lucide-React
- **Backend**: Python, FastAPI, Google Agent Development Kit (ADK), Celery, SQLAlchemy/SQLite
- **AI**: Google Gemini (`gemini-2.0-flash`) driven through ADK `LlmAgent` + `Runner`
- **Auditing/Scraping**: Playwright, Axe-Core
- **Document processing**: pdfplumber / pypdf, Pillow

> The original Node/Express backend has been migrated to Python ADK and archived under
> [`legacy/`](legacy/README.md). It is no longer used or deployed.

## Getting Started

### Prerequisites

- Python 3.11+ (the ADK backend)
- Node.js v18+ and NPM (frontend build + convenience run scripts)

### Installation

1. Install frontend dependencies (repo root):
   ```bash
   npm install
   ```

2. Install the Python ADK backend dependencies:
   ```bash
   pip install -r backend/requirements.txt
   python -m playwright install chromium
   ```

3. Environment Variables:
   Copy `backend/.env.example` to `backend/.env` and set `GOOGLE_API_KEY`
   (get one at https://aistudio.google.com/apikey). Without a key the backend
   still runs, but produces deterministic reports instead of Gemini-enhanced ones.
   ```bash
   cp backend/.env.example backend/.env
   ```

### Running the Application

The convenience NPM scripts wrap the Python backend so you can run everything from the repo root.

- **Start the Python ADK API server** (FastAPI on `:8787`):
  ```bash
  npm run dev:api
  ```
  *(equivalently: `cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8787`)*

- **Start the frontend** (Vite dev server; proxies `/api` to `:8787`):
  ```bash
  npm run dev
  ```

- **Start the Celery worker** (optional — the API falls back to in-process execution):
  ```bash
  npm run worker
  ```

- **Run the backend tests** (pytest):
  ```bash
  npm test
  ```

You can also expose the audit tools to `adk web` / `adk run`; the ADK `root_agent`
lives in `backend/app/agents/adk_agent.py`.

### Build for Production

To create a production build of the frontend:
```bash
npm run build
```

## Available MCP Tools

When connected via MCP, the server provides the following tools:
- `crawl_site`: Crawl a public civic site to discover pages and PDFs.
- `map_journey`: Classify pages into journey stages.
- `scan_accessibility`: Run axe-core and custom civic checks against a URL.
- `parse_document`: Extract text and flag image-only PDFs.
- `crop_document_image`: Auto-crop photos of documents.
- `analyze_document_regions`: Identify structural regions and layout accessibility on document images.
- `annotate_screenshot`: Render colored issue frames onto screenshots.
- `generate_report`: Generate HTML/PDF report artifacts.
- `run_civic_flow_audit`: Run a full, end-to-end civic flow audit.


## Python Backend Foundation

A production-foundation backend has been added under `backend/` to match the PRD refactor target: FastAPI, Google ADK Python tool wrappers, Celery task boundaries, Redis-compatible events, SQLAlchemy persistence, and local artifact storage.

Local development commands:

```bash
cd backend
pip install -r requirements.txt
python -m playwright install chromium
uvicorn app.main:app --host 127.0.0.1 --port 8787
celery -A app.worker.celery_app worker --loglevel=info
pytest
```

The Python backend preserves the current frontend API routes such as `/api/audits`, `/api/audits/{id}/events`, `/api/scan-image`, `/reports/{id}.html`, and `/artifacts/{id}/{file}`. The existing Node backend remains in place as the prototype reference while parity work continues.

## License

This project is created as a prototype.
