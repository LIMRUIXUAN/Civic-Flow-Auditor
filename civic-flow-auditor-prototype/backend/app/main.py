from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .api.audits import router as audits_router
from .api.documents import router as documents_router
from .api.events import router as events_router
from .config import settings


def create_app() -> FastAPI:
    app = FastAPI(title="Civic Flow Auditor API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.cors_origin, "http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    @app.exception_handler(HTTPException)
    async def http_exception_handler(_request: Request, exc: HTTPException):
        if isinstance(exc.detail, dict) and "error" in exc.detail:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        return JSONResponse(status_code=exc.status_code, content={"error": str(exc.detail)})

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_request: Request, exc: Exception):
        return JSONResponse(status_code=500, content={"error": "Internal server error.", "detail": str(exc)})

    app.include_router(audits_router)
    app.include_router(documents_router)
    app.include_router(events_router)
    return app


app = create_app()
