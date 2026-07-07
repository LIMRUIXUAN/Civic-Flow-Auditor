# Civic Flow Auditor Python Backend

Production-foundation backend for the PRD refactor. This service is designed to replace the Node/Express API while preserving the React frontend's current API routes and `AuditRun` JSON shape.

## Services

- FastAPI API gateway
- Google ADK orchestration layer
- Celery worker tasks
- Redis event/progress channel
- PostgreSQL audit persistence
- Local artifact storage for development

## Prerequisite: install Python 3.11+ and make sure `python --version` works in PowerShell. Then run these local commands

```bash
pip install -r requirements.txt
python -m playwright install chromium
uvicorn app.main:app --host 127.0.0.1 --port 8787
celery -A app.worker.celery_app worker --loglevel=info
pytest
```

Set `DATABASE_URL`, `REDIS_URL`, `GOOGLE_API_KEY` (Gemini via Google ADK), and model env vars in `.env` or the shell.