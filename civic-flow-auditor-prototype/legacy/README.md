# Legacy Node.js backend (archived)

This folder holds the original Node/Express backend (`server/`) and its JavaScript
tests (`test/`). The project has fully migrated to the **Python Google ADK backend**
in [`../backend`](../backend), which is now the only active/supported backend.

These files are kept for reference and git history only. They are **not** wired into
any run script and are not deployed. The React frontend in `../src` talks to the
Python backend over HTTP (Vite proxies `/api`, `/reports`, `/artifacts` to
`http://127.0.0.1:8787`).

To run the app now:

```bash
# terminal 1 — Python ADK backend (from repo root)
npm run dev:api        # -> uvicorn app.main:app on :8787
npm run worker         # -> Celery worker (optional; falls back to in-process)

# terminal 2 — frontend
npm run dev            # -> Vite dev server
```

Set `GOOGLE_API_KEY` in `backend/.env` to enable Gemini; without it the backend
runs deterministically.
