from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

from ..config import settings
from ..schemas import PageSnapshot
from ..security import is_same_domain

try:
    from playwright.sync_api import sync_playwright
    _PLAYWRIGHT_AVAILABLE = True
except ImportError:
    _PLAYWRIGHT_AVAILABLE = False

import httpx

TAG_RE = re.compile(r"<[^>]+>")
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.I | re.S)
LINK_RE = re.compile(r"<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.I | re.S)
FORM_RE = re.compile(r"<form[^>]*>(.*?)</form>", re.I | re.S)


def _text(value: str) -> str:
    return re.sub(r"\s+", " ", TAG_RE.sub(" ", value or "")).strip()


def _session_for(url: str, title: str, text: str) -> tuple[str, str]:
    haystack = f"{url} {title} {text}".lower()
    if any(w in haystack for w in ["login", "sign in", "signin", "log in", "account/login"]):
        return "login", "Login"
    if any(w in haystack for w in ["register", "signup", "sign up", "apply", "application", "create account", "create-account"]):
        return "register", "Register / apply"
    if any(w in haystack for w in ["upload", "document", "attachment"]):
        return "document-upload", "Document upload"
    if any(w in haystack for w in ["submit", "confirmation", "review", "confirm"]):
        return "submit", "Review and submit"
    if any(w in haystack for w in ["profile", "my account", "account settings"]):
        return "profile", "User profile"
    if any(w in haystack for w in ["explore", "browse", "discover", "search"]):
        return "explore", "Explore"
    return "general", "General info"


def _clean_filename(url: str, index: int) -> str:
    parsed = urlparse(url)
    slug = re.sub(r"[^a-z0-9]+", "-", (parsed.path or "index").lower()).strip("-") or "index"
    return f"page-{str(index).zfill(2)}-{slug[:50]}.png"


def _try_login(page: object, login_email: str, login_password: str) -> bool:
    """Attempt to fill email + password fields and click submit. Returns True if attempted."""
    email_selectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[name="username"]',
        'input[name="user"]',
        'input[id*="email"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="username" i]',
    ]
    password_selectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[id*="password"]',
    ]
    submit_selectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Log in")',
        'button:has-text("Sign in")',
        'button:has-text("Login")',
        'button:has-text("Continue")',
    ]

    email_el = None
    for sel in email_selectors:
        try:
            el = page.locator(sel).first
            if el.is_visible(timeout=800):
                email_el = el
                break
        except Exception:
            continue

    pw_el = None
    for sel in password_selectors:
        try:
            el = page.locator(sel).first
            if el.is_visible(timeout=800):
                pw_el = el
                break
        except Exception:
            continue

    if not email_el or not pw_el:
        return False

    try:
        email_el.fill(login_email)
        pw_el.fill(login_password)
        for sel in submit_selectors:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=500):
                    btn.click()
                    page.wait_for_load_state("networkidle", timeout=8000)
                    return True
            except Exception:
                continue
    except Exception:
        pass
    return False


# ---------------------------------------------------------------------------
# Playwright-based crawler (primary path)
# ---------------------------------------------------------------------------

def _crawl_with_playwright(
    url: str,
    limit: int,
    same_domain_only: bool,
    audit_id: str,
    login_email: str | None,
    login_password: str | None,
) -> dict:
    from ..artifacts import artifact_url, get_run_dir

    run_dir = get_run_dir(audit_id)
    pages: list[PageSnapshot] = []
    documents: list[dict] = []
    errors: list[str] = []
    visited: set[str] = set()
    queued: list[str] = [url]

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1366, "height": 900},
            ignore_https_errors=True,
        )

        # Perform login before crawling if credentials provided
        if login_email and login_password:
            login_page = context.new_page()
            try:
                login_page.goto(url, wait_until="domcontentloaded", timeout=18000)
                try:
                    login_page.wait_for_load_state("networkidle", timeout=5000)
                except Exception:
                    pass
                _try_login(login_page, login_email, login_password)
            except Exception:
                pass
            finally:
                login_page.close()

        while queued and len(pages) < limit:
            current = queued.pop(0)
            if current in visited:
                continue
            visited.add(current)

            page = context.new_page()
            page.on("dialog", lambda d: d.dismiss())

            try:
                page.goto(current, wait_until="domcontentloaded", timeout=18000)
                try:
                    page.wait_for_load_state("networkidle", timeout=5000)
                except Exception:
                    pass

                final_url = page.url
                if same_domain_only and not is_same_domain(url, final_url):
                    continue
                if final_url in visited and final_url != current:
                    continue
                visited.add(final_url)

                # Skip already-added pages
                if any(p.url == final_url for p in pages):
                    continue

                page_index = len(pages) + 1
                screenshot_file = _clean_filename(final_url, page_index)
                screenshot_path = run_dir / screenshot_file
                try:
                    page.screenshot(path=str(screenshot_path), full_page=True)
                except Exception:
                    screenshot_path = None
                    screenshot_file = None

                snapshot = page.evaluate("""() => {
                    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
                    const links = [...document.querySelectorAll('a[href]')].map(a => ({
                        href: a.href, text: clean(a.innerText || a.getAttribute('aria-label') || '')
                    }));
                    const pdfs = links.filter(l => /\\.pdf($|[?#])/i.test(l.href));
                    const labelFor = field => {
                        const id = field.getAttribute('id');
                        const explicit = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]') : null;
                        const implicit = field.closest('label');
                        return clean(
                            explicit?.innerText || implicit?.innerText ||
                            field.getAttribute('aria-label') || field.getAttribute('placeholder') ||
                            field.getAttribute('name') || ''
                        );
                    };
                    const forms = [...document.querySelectorAll('form')].map(form => ({
                        name: clean(form.getAttribute('name') || form.getAttribute('aria-label') || ''),
                        action: form.getAttribute('action') || '',
                        method: (form.getAttribute('method') || 'get').toLowerCase(),
                        labels: [...form.querySelectorAll('input,select,textarea')].map(labelFor).filter(Boolean),
                        buttons: [...form.querySelectorAll('button,input[type=submit],input[type=button]')]
                            .map(b => clean(b.innerText || b.value || b.getAttribute('aria-label') || '')).filter(Boolean)
                    }));
                    return {
                        title: clean(document.title),
                        heading: clean(document.querySelector('h1,h2')?.innerText || ''),
                        textSample: clean(document.body?.innerText || '').slice(0, 600),
                        links, pdfs, forms
                    };
                }""")

                session, session_label = _session_for(
                    final_url, snapshot["title"], snapshot["textSample"]
                )

                # Queue new same-domain links
                for link in snapshot["links"]:
                    href = link["href"]
                    if (
                        len(queued) + len(pages) < limit
                        and href not in visited
                        and href not in queued
                        and not re.search(r"\.pdf($|[?#])", href, re.I)
                        and (not same_domain_only or is_same_domain(url, href))
                    ):
                        queued.append(href)

                for pdf in snapshot["pdfs"]:
                    documents.append({
                        "url": pdf["href"],
                        "title": pdf.get("text", "") or "Linked PDF",
                        "sourcePageUrl": final_url,
                    })

                pages.append(PageSnapshot(
                    url=final_url,
                    title=snapshot["title"],
                    heading=snapshot["heading"],
                    textSample=snapshot["textSample"],
                    links=[{"href": l["href"], "text": l["text"]} for l in snapshot["links"][:30]],
                    pdfs=[{"url": p["href"], "text": p.get("text", "")} for p in snapshot["pdfs"]],
                    forms=snapshot["forms"],
                    session=session,
                    sessionLabel=session_label,
                    screenshotPath=str(screenshot_path) if screenshot_path else None,
                    screenshotUrl=artifact_url(audit_id, screenshot_file) if screenshot_file else None,
                ))

            except Exception as exc:
                errors.append(f"{current}: {exc}")
            finally:
                try:
                    page.close()
                except Exception:
                    pass

        try:
            context.close()
        except Exception:
            pass
        try:
            browser.close()
        except Exception:
            pass

    return {
        "pages": [p.model_dump(mode="json") for p in pages],
        "documents": documents,
        "crawlErrors": errors,
        "skippedActions": [],
    }


# ---------------------------------------------------------------------------
# httpx fallback crawler (no Playwright)
# ---------------------------------------------------------------------------

def _crawl_with_httpx(url: str, limit: int, same_domain_only: bool) -> dict:
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
            links: list[dict] = []
            pdfs: list[dict] = []
            for href, label in LINK_RE.findall(html):
                absolute = urljoin(str(response.url), href)
                label_text = _text(label)
                if re.search(r"\.pdf($|[?#])", absolute, re.I):
                    pdfs.append({"url": absolute, "text": label_text})
                    documents.append({"url": absolute, "title": label_text or "Linked PDF", "sourcePageUrl": str(response.url)})
                    continue
                if (
                    len(queued) + len(pages) < limit
                    and absolute not in visited
                    and (not same_domain_only or is_same_domain(url, absolute))
                ):
                    queued.append(absolute)
                links.append({"href": absolute, "text": label_text})

            forms = [
                {"name": "", "action": "", "method": "get", "labels": [], "buttons": []}
                for _ in FORM_RE.findall(html)
            ]
            pages.append(PageSnapshot(
                url=str(response.url),
                title=title,
                heading=heading,
                textSample=body_text,
                links=links[:30],
                pdfs=pdfs,
                forms=forms,
                session=session,
                sessionLabel=session_label,
            ))

    return {
        "pages": [p.model_dump(mode="json") for p in pages],
        "documents": documents,
        "crawlErrors": errors,
        "skippedActions": [],
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def crawl_site(
    url: str,
    max_pages: int | None = None,
    same_domain_only: bool = True,
    audit_id: str = "manual",
    login_email: str | None = None,
    login_password: str | None = None,
) -> dict:
    limit = max(1, min(max_pages or settings.max_pages, settings.max_pages))
    if _PLAYWRIGHT_AVAILABLE:
        try:
            return _crawl_with_playwright(url, limit, same_domain_only, audit_id, login_email, login_password)
        except Exception:
            pass
    return _crawl_with_httpx(url, limit, same_domain_only)
