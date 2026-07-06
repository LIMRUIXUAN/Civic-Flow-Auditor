from __future__ import annotations

import re
from html import escape
from urllib.parse import urljoin

import httpx

from ..config import settings
from ..schemas import PageSnapshot
from ..security import is_same_domain

TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.I | re.S)
LINK_RE = re.compile(r"<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.I | re.S)
FORM_RE = re.compile(r"<form[^>]*>(.*?)</form>", re.I | re.S)
TAG_RE = re.compile(r"<[^>]+>")


def _text(value: str) -> str:
    return re.sub(r"\s+", " ", TAG_RE.sub(" ", value or "")).strip()


def _session_for(url: str, title: str, text: str) -> tuple[str, str]:
    haystack = f"{url} {title} {text}".lower()
    if any(word in haystack for word in ["login", "sign in", "account"]):
        return "login", "Login"
    if any(word in haystack for word in ["register", "signup", "apply", "application"]):
        return "register", "Register / apply"
    if any(word in haystack for word in ["upload", "document"]):
        return "document-upload", "Document upload"
    if any(word in haystack for word in ["submit", "confirmation", "review"]):
        return "submit", "Review and submit"
    return "general", "General info"


def crawl_site(url: str, max_pages: int | None = None, same_domain_only: bool = True) -> dict:
    limit = max(1, min(max_pages or settings.max_pages, settings.max_pages))
    visited: set[str] = set()
    queued = [url]
    pages: list[PageSnapshot] = []
    documents: list[dict] = []
    errors: list[str] = []

    with httpx.Client(timeout=10.0, follow_redirects=True) as client:
        while queued and len(pages) < limit:
            current = queued.pop(0)
            if current in visited:
                continue
            visited.add(current)
            try:
                response = client.get(current)
                response.raise_for_status()
                html = response.text
            except Exception as exc:
                errors.append(f"{current}: {exc}")
                continue

            title = _text((TITLE_RE.search(html) or ["", ""])[1])
            heading = _text((H1_RE.search(html) or ["", ""])[1])
            body_text = _text(html)[:600]
            session, session_label = _session_for(str(response.url), title, body_text)
            links = []
            pdfs = []
            for href, label in LINK_RE.findall(html):
                absolute = urljoin(str(response.url), href)
                label_text = _text(label)
                if absolute.lower().split("?")[0].endswith(".pdf"):
                    pdfs.append({"url": absolute, "text": label_text})
                    documents.append({"url": absolute, "title": label_text or "Linked PDF", "sourcePageUrl": str(response.url)})
                    continue
                if len(queued) + len(pages) < limit and absolute not in visited and (not same_domain_only or is_same_domain(url, absolute)):
                    queued.append(absolute)
                links.append({"href": absolute, "text": label_text})
            forms = [{"name": "", "action": "", "method": "get", "labels": [], "buttons": []} for _ in FORM_RE.findall(html)]
            pages.append(
                PageSnapshot(
                    url=str(response.url),
                    title=title,
                    heading=heading,
                    textSample=body_text,
                    links=links[:30],
                    pdfs=pdfs,
                    forms=forms,
                    session=session,
                    sessionLabel=session_label,
                )
            )
    return {"pages": [page.model_dump(mode="json") for page in pages], "documents": documents, "crawlErrors": errors, "skippedActions": []}