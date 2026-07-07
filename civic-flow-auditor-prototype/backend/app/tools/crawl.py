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


_EMAIL_SELECTORS = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[name="login"]',
    'input[name="user"]',
    'input[id*="email" i]',
    'input[id*="username" i]',
    'input[autocomplete="username"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="username" i]',
]
_PASSWORD_SELECTORS = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id*="password" i]',
    'input[autocomplete="current-password"]',
]
_SUBMIT_SELECTORS = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Sign in")',
    'button:has-text("Login")',
    'button:has-text("Sign In")',
    'button:has-text("Continue")',
    'button:has-text("Next")',
]
_LOGIN_LINK_SELECTORS = [
    'a[href*="login" i]',
    'a[href*="signin" i]',
    'a[href*="sign-in" i]',
    'a[href*="log-in" i]',
    'a[href*="account/login" i]',
    'a[href*="auth" i]',
    'a:has-text("Log in")',
    'a:has-text("Login")',
    'a:has-text("Sign in")',
    'a:has-text("Sign In")',
]
_COMMON_LOGIN_PATHS = [
    "/login",
    "/signin",
    "/sign-in",
    "/account/login",
    "/accounts/login",
    "/users/sign_in",
    "/auth/login",
]


def _first_visible(page: object, selectors: list[str], timeout: int = 600) -> object | None:
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if el.is_visible(timeout=timeout):
                return el
        except Exception:
            continue
    return None


def _password_visible(page: object) -> bool:
    return _first_visible(page, _PASSWORD_SELECTORS, timeout=400) is not None


def _fill_and_submit(page: object, login_email: str, login_password: str) -> bool:
    """Fill the login form on the current page and submit it.

    Handles both single-step forms and two-step flows where the password field
    only appears after the email is entered and a "Continue"/"Next" button is
    clicked. Returns True when a submit was actually attempted.
    """
    email_el = _first_visible(page, _EMAIL_SELECTORS)
    if not email_el:
        return False

    try:
        email_el.fill(login_email)
    except Exception:
        return False

    pw_el = _first_visible(page, _PASSWORD_SELECTORS, timeout=400)
    if not pw_el:
        # Two-step flow: submit the email to reveal the password field.
        advance = _first_visible(page, _SUBMIT_SELECTORS, timeout=400)
        if advance:
            try:
                advance.click()
                page.wait_for_timeout(1200)
            except Exception:
                pass
        pw_el = _first_visible(page, _PASSWORD_SELECTORS, timeout=1500)

    if not pw_el:
        return False

    try:
        pw_el.fill(login_password)
    except Exception:
        return False

    submit = _first_visible(page, _SUBMIT_SELECTORS, timeout=600)
    try:
        if submit:
            submit.click()
        else:
            pw_el.press("Enter")
        try:
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        return True
    except Exception:
        return False


def _perform_login(
    context: object, base_url: str, login_email: str, login_password: str
) -> tuple[bool, str | None, str]:
    """Authenticate the browser context before crawling.

    Strategy: try the landing page, then any discoverable login link, then a set
    of common login paths. Cookies persist in ``context`` so every subsequent
    page in the crawl is fetched as the authenticated user.

    Returns ``(success, landing_url, note)`` where ``landing_url`` is the URL the
    site redirected to after login (worth crawling — often a dashboard/profile).
    """
    page = context.new_page()
    page.on("dialog", lambda d: d.dismiss())
    note = "No login form was found; crawled as an anonymous visitor."
    landing_url: str | None = None

    def _attempt() -> bool:
        try:
            page.wait_for_load_state("networkidle", timeout=4000)
        except Exception:
            pass
        return _fill_and_submit(page, login_email, login_password)

    try:
        page.goto(base_url, wait_until="domcontentloaded", timeout=18000)
        submitted = _attempt()

        # Not on a login page yet — follow a login link if one exists.
        if not submitted:
            link = _first_visible(page, _LOGIN_LINK_SELECTORS, timeout=800)
            if link:
                try:
                    link.click()
                    page.wait_for_load_state("domcontentloaded", timeout=10000)
                    submitted = _attempt()
                except Exception:
                    submitted = False

        # Still nothing — probe common login URLs.
        if not submitted:
            for path in _COMMON_LOGIN_PATHS:
                try:
                    page.goto(urljoin(base_url, path), wait_until="domcontentloaded", timeout=12000)
                except Exception:
                    continue
                if _fill_and_submit(page, login_email, login_password):
                    submitted = True
                    break

        if submitted:
            landing_url = page.url
            success = not _password_visible(page)
            note = (
                f"Logged in and landed on {landing_url}."
                if success
                else "Login form was submitted but a password field is still visible; "
                "credentials may be incorrect or an extra step (e.g. MFA) is required."
            )
            return success, landing_url, note
    except Exception as exc:
        note = f"Login attempt failed: {exc}"
    finally:
        try:
            page.close()
        except Exception:
            pass

    return False, landing_url, note


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
    login_notes: list[str] = []
    visited: set[str] = set()
    queued: list[str] = [url]

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1366, "height": 900},
            ignore_https_errors=True,
        )

        # Authenticate the whole browser context before crawling if credentials
        # were provided. Cookies persist so protected pages become crawlable.
        if login_email and login_password:
            success, landing_url, note = _perform_login(context, url, login_email, login_password)
            login_notes.append(note)
            if landing_url and is_same_domain(url, landing_url) and landing_url not in queued:
                # Crawl the post-login landing page (dashboard / profile) first.
                queued.insert(0, landing_url)

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
        "loginNotes": login_notes,
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
