from __future__ import annotations

import re
from pathlib import Path
from uuid import uuid4

from ..schemas import Finding, PageSnapshot

try:
    from playwright.sync_api import sync_playwright
    _PLAYWRIGHT_AVAILABLE = True
except ImportError:
    _PLAYWRIGHT_AVAILABLE = False

try:
    from PIL import Image, ImageDraw, ImageFont
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False


# ---------------------------------------------------------------------------
# Screenshot cropping helper
# ---------------------------------------------------------------------------

def _crop_screenshot_for_issue(
    screenshot_path: str,
    box: dict,
    label: str,
    output_path: str,
    title: str = "",
) -> bool:
    """
    Crop a full-page screenshot to a region centered on `box` (with padding),
    draw a red box and a label badge on the cropped image.
    Returns True on success.
    """
    if not _PIL_AVAILABLE or not screenshot_path or not Path(screenshot_path).exists():
        return False
    try:
        img = Image.open(screenshot_path).convert("RGBA")
        iw, ih = img.size

        x = float(box.get("x", 0))
        y = float(box.get("y", 0))
        bw = max(float(box.get("width", 60)), 30)
        bh = max(float(box.get("height", 30)), 20)

        # Crop region: center on element, at least 640x400
        pad_x, pad_y = 120, 100
        crop_w = max(bw + pad_x * 2, 640)
        crop_h = max(bh + pad_y * 2, 400)

        cx, cy = x + bw / 2, y + bh / 2
        left = max(0, int(cx - crop_w / 2))
        top = max(0, int(cy - crop_h / 2))
        right = min(iw, left + int(crop_w))
        bottom = min(ih, top + int(crop_h))

        cropped = img.crop((left, top, right, bottom)).convert("RGB")
        draw = ImageDraw.Draw(cropped)

        # Highlight box (adjusted for crop offset)
        bx1 = int(x - left)
        by1 = int(y - top)
        bx2 = bx1 + int(bw)
        by2 = by1 + int(bh)

        # Red semi-transparent overlay
        overlay = Image.new("RGBA", cropped.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        od.rectangle([bx1, by1, bx2, by2], outline=(220, 38, 38, 255), width=4)
        cropped = Image.alpha_composite(cropped.convert("RGBA"), overlay).convert("RGB")
        draw = ImageDraw.Draw(cropped)

        # Label badge above the box
        badge_text = f"  {label}  "
        badge_x = max(bx1, 0)
        badge_y = max(by1 - 28, 4)
        draw.rectangle([badge_x, badge_y, badge_x + len(badge_text) * 8, badge_y + 22], fill=(220, 38, 38))
        draw.text((badge_x + 4, badge_y + 4), badge_text.strip(), fill=(255, 255, 255))

        # Issue title strip at bottom
        if title:
            strip_text = title[:80]
            sw, sh = len(strip_text) * 7 + 16, 28
            sx = max(0, min(bx1, cropped.width - sw - 4))
            sy = min(by2 + 6, cropped.height - sh - 4)
            draw.rectangle([sx, sy, sx + sw, sy + sh], fill=(15, 53, 87))
            draw.text((sx + 8, sy + 6), strip_text, fill=(255, 255, 255))

        cropped.save(output_path)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Custom DOM checks (mirrors Node.js collectCustomChecks)
# ---------------------------------------------------------------------------

_CUSTOM_CHECKS_JS = """() => {
    const clean = v => String(v || '').replace(/\\s+/g, ' ').trim();
    const cssPath = el => {
        if (!el || el.nodeType !== 1) return '';
        if (el.id) return '#' + CSS.escape(el.id);
        const parts = []; let cur = el;
        while (cur && cur.nodeType === 1 && parts.length < 4) {
            const tag = cur.tagName.toLowerCase();
            const siblings = [...(cur.parentElement?.children || [])].filter(n => n.tagName === cur.tagName);
            const idx = siblings.indexOf(cur) + 1;
            parts.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + idx + ')' : ''));
            cur = cur.parentElement;
        }
        return parts.join(' > ');
    };
    const fieldLabel = field => {
        const id = field.getAttribute('id');
        const explicit = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]') : null;
        const implicit = field.closest('label');
        return clean(explicit?.innerText || implicit?.innerText ||
            field.getAttribute('aria-label') || field.getAttribute('aria-labelledby') || '');
    };
    const fields = [...document.querySelectorAll('input,select,textarea')]
        .filter(f => !['hidden','submit','button','reset'].includes((f.getAttribute('type')||'').toLowerCase()));
    const missingLabels = fields.filter(f => !fieldLabel(f)).slice(0,5)
        .map(f => ({ selector: cssPath(f), html: f.outerHTML.slice(0,280) }));
    const requiredNoInstructions = fields
        .filter(f => f.required && !clean(
            f.getAttribute('aria-describedby') || f.getAttribute('placeholder') ||
            f.closest('label')?.innerText || ''))
        .slice(0,5).map(f => ({ selector: cssPath(f), html: f.outerHTML.slice(0,280) }));
    const vagueLinks = [...document.querySelectorAll('a[href]')]
        .filter(a => /^(click here|here|read more|more|learn more)$/i.test(
            clean(a.innerText || a.getAttribute('aria-label') || '')))
        .slice(0,5).map(a => ({ selector: cssPath(a), text: clean(a.innerText || a.getAttribute('aria-label') || '') }));
    const positiveTabIndex = [...document.querySelectorAll('[tabindex]')]
        .filter(n => Number(n.getAttribute('tabindex')) > 0).slice(0,5)
        .map(n => ({ selector: cssPath(n), tabindex: n.getAttribute('tabindex') }));
    const hasHeading = Boolean(document.querySelector('h1,h2'));
    const imagesNoAlt = [...document.querySelectorAll('img:not([alt])')].slice(0,5)
        .map(img => ({ selector: cssPath(img), src: img.src.slice(0,120) }));
    const submitButtons = [...document.querySelectorAll('button,input[type=submit]')]
        .filter(b => /submit|send|apply|finish|complete/i.test(
            clean(b.innerText || b.value || b.getAttribute('aria-label') || '')))
        .slice(0,5).map(b => ({ selector: cssPath(b), text: clean(b.innerText || b.value || b.getAttribute('aria-label') || '') }));

    // Color contrast (WCAG 1.4.3). Approximate: only assesses text on a solid
    // computed background colour. Text over background images/gradients is
    // skipped to avoid false positives, and flagged findings still say
    // "verify manually" since ancestor backgrounds cannot always be resolved.
    const parseColor = c => {
        const m = String(c || '').match(/rgba?\\(([^)]+)\\)/);
        if (!m) return null;
        const p = m[1].split(',').map(s => parseFloat(s.trim()));
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lum = ({ r, g, b }) => {
        const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const effectiveBg = el => {
        let cur = el;
        while (cur && cur.nodeType === 1) {
            const st = getComputedStyle(cur);
            if (st.backgroundImage && st.backgroundImage !== 'none') return null;
            const bg = parseColor(st.backgroundColor);
            if (bg && bg.a >= 0.9) return bg;
            cur = cur.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
    };
    const contrastRatio = (fg, bg) => {
        const l1 = lum(fg), l2 = lum(bg);
        const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
        return (hi + 0.05) / (lo + 0.05);
    };
    const lowContrast = [];
    const seenContrast = new Set();
    const textEls = [...document.querySelectorAll('p,span,a,li,td,th,label,button,h1,h2,h3,h4,h5,h6')];
    for (const el of textEls) {
        if (lowContrast.length >= 5) break;
        const directText = [...el.childNodes].some(n => n.nodeType === 3 && clean(n.textContent).length > 1);
        if (!directText) continue;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) === 0) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const fg = parseColor(st.color);
        if (!fg || fg.a === 0) continue;
        const bg = effectiveBg(el);
        if (!bg) continue;
        const cr = contrastRatio(fg, bg);
        const size = parseFloat(st.fontSize);
        const bold = (parseInt(st.fontWeight) || 400) >= 700;
        const large = size >= 24 || (size >= 18.66 && bold);
        const required = large ? 3 : 4.5;
        if (cr < required) {
            const sel = cssPath(el);
            if (seenContrast.has(sel)) continue;
            seenContrast.add(sel);
            lowContrast.push({ selector: sel, ratio: Math.round(cr * 100) / 100, required, text: clean(el.textContent).slice(0, 60) });
        }
    }
    return { missingLabels, requiredNoInstructions, vagueLinks, positiveTabIndex, hasHeading, imagesNoAlt, submitButtons, lowContrast };
}"""


def _box_for_selector(page: object, selector: str) -> dict | None:
    """Return playwright bounding box dict for a selector, or None."""
    if not selector or " on " in selector:
        return None
    try:
        box = page.locator(selector).first.bounding_box(timeout=2000)
        return box  # {x, y, width, height} or None
    except Exception:
        return None


def _make_finding(
    rule: str,
    prefix: str,
    page_data: dict,
    title: str,
    impact: str,
    guideline: str,
    severity: str,
    fix: str,
    selector: str = "",
    source_snippet: str = "",
    screenshot_path: str | None = None,
    screenshot_url: str | None = None,
    issue_boxes: list | None = None,
) -> Finding:
    return Finding(
        id=f"{prefix.lower()}-{uuid4().hex[:8]}",
        stage=page_data.get("session", "general"),
        stageLabel=page_data.get("sessionLabel", "General info"),
        title=title,
        impact=impact,
        guideline=guideline,
        severity=severity,
        fix=fix,
        ticket=f"{title} — {page_data.get('url', '')}",
        url=page_data.get("url"),
        selector=selector or None,
        rule=rule,
        humanReviewNote="Automated checks cannot cover every accessibility scenario.",
        evidenceScore=70 if screenshot_path else 55,
        sourceSnippet=source_snippet or None,
        screenshotPath=screenshot_path,
        screenshotUrl=screenshot_url,
        issueBoxes=[{"x": b["x"], "y": b["y"], "width": b["width"], "height": b["height"], "label": str(i + 1)} for i, b in enumerate(issue_boxes or [])],
    )


def _scan_with_playwright(page_data: dict, audit_id: str) -> dict:
    from ..artifacts import artifact_url, get_run_dir

    run_dir = get_run_dir(audit_id)
    page_url = page_data.get("url", "")
    findings: list[Finding] = []
    base_screenshot_path: str | None = page_data.get("screenshotPath")
    base_screenshot_url: str | None = page_data.get("screenshotUrl")
    scan_error: str | None = None

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1366, "height": 900}, ignore_https_errors=True)
        page = context.new_page()
        page.on("dialog", lambda d: d.dismiss())

        checks: dict | None = None
        try:
            # Navigation and DOM evaluation are hard requirements. A failure
            # here is a real scan failure that must be surfaced as a partial
            # result, NOT silently returned as "scanned fine, 0 issues found".
            page.goto(page_url, wait_until="domcontentloaded", timeout=18000)
            try:
                page.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                pass

            # Take a fresh screenshot if we don't have one from the crawl.
            if not base_screenshot_path:
                host = re.sub(r"[^a-z0-9]+", "-", (page_url.split("//")[-1].split("/")[0] or "page").lower())
                scan_file = f"scan-{host}-{uuid4().hex[:6]}.png"
                scan_path = run_dir / scan_file
                try:
                    page.screenshot(path=str(scan_path), full_page=True)
                    base_screenshot_path = str(scan_path)
                    base_screenshot_url = artifact_url(audit_id, scan_file)
                except Exception:
                    pass

            checks = page.evaluate(_CUSTOM_CHECKS_JS)
        except Exception as exc:
            scan_error = f"Could not load or analyze page: {exc}"[:200]

        if checks is not None:
            def _annotated(selector: str, label: str, rule: str, title_text: str) -> tuple[str | None, str | None]:
                """Create a cropped annotated screenshot for a selector. Returns (path, url)."""
                if not base_screenshot_path:
                    return base_screenshot_path, base_screenshot_url
                box = _box_for_selector(page, selector)
                if not box:
                    return base_screenshot_path, base_screenshot_url
                safe_rule = re.sub(r"[^a-z0-9]+", "-", rule.lower())
                crop_file = f"crop-{safe_rule}-{uuid4().hex[:6]}.png"
                crop_path = str(run_dir / crop_file)
                ok = _crop_screenshot_for_issue(base_screenshot_path, box, label, crop_path, title_text)
                if ok:
                    return crop_path, artifact_url(audit_id, crop_file)
                return base_screenshot_path, base_screenshot_url

            # Finding construction is best-effort: navigation and DOM checks
            # already succeeded, so an error building one card (e.g. a
            # screenshot crop) must not be reported as a navigation failure.
            try:
                # Missing heading
                if not checks.get("hasHeading"):
                    findings.append(_make_finding(
                        rule="missing-heading",
                        prefix="HEAD",
                        page_data=page_data,
                        title="Page is missing a clear primary heading",
                        impact="Screen reader users may not understand the purpose of the page.",
                        guideline="WCAG 2.4.6 Headings and Labels",
                        severity="Medium",
                        fix="Add a descriptive H1 or H2 that names the public-service task or page purpose.",
                        screenshot_path=base_screenshot_path,
                        screenshot_url=base_screenshot_url,
                    ))

                # Missing form labels
                for item in checks.get("missingLabels", []):
                    sp, su = _annotated(item["selector"], "!", "form-missing-label", "Missing label")
                    findings.append(_make_finding(
                        rule="form-missing-label",
                        prefix="FORM",
                        page_data=page_data,
                        title="Form control is missing a programmatic label",
                        impact="Screen reader users may not know what information the form field is asking for.",
                        guideline="WCAG 1.3.1 Info and Relationships / 2.1 Labels or Instructions",
                        severity="Critical",
                        fix="Add a visible <label> with a matching for/id pair, or connect the control with aria-labelledby.",
                        selector=item["selector"],
                        source_snippet=item["html"],
                        screenshot_path=sp,
                        screenshot_url=su,
                    ))

                # Required fields without instructions
                for item in checks.get("requiredNoInstructions", []):
                    sp, su = _annotated(item["selector"], "!", "required-no-instructions", "Required field lacks instructions")
                    findings.append(_make_finding(
                        rule="required-no-instructions",
                        prefix="REQ",
                        page_data=page_data,
                        title="Required field lacks nearby instructions",
                        impact="Residents may miss required field rules or error-prevention instructions before submitting.",
                        guideline="WCAG 3.3.2 Labels or Instructions",
                        severity="High",
                        fix="Place clear required-field instructions near the input and reference them with aria-describedby.",
                        selector=item["selector"],
                        source_snippet=item["html"],
                        screenshot_path=sp,
                        screenshot_url=su,
                    ))

                # Vague link text
                for item in checks.get("vagueLinks", []):
                    sp, su = _annotated(item["selector"], "!", "vague-link-text", "Vague link text")
                    findings.append(_make_finding(
                        rule="vague-link-text",
                        prefix="LINK",
                        page_data=page_data,
                        title="Link text is too vague to describe its destination",
                        impact="Screen reader users navigating by links may not know which step the link opens.",
                        guideline="WCAG 2.4.4 Link Purpose",
                        severity="Medium",
                        fix=f"Replace \"{item['text']}\" with descriptive text such as \"Read business license requirements\".",
                        selector=item["selector"],
                        source_snippet=item["text"],
                        screenshot_path=sp,
                        screenshot_url=su,
                    ))

                # Positive tabindex
                for item in checks.get("positiveTabIndex", []):
                    sp, su = _annotated(item["selector"], "!", "positive-tabindex", "Positive tabindex")
                    findings.append(_make_finding(
                        rule="positive-tabindex",
                        prefix="KEY",
                        page_data=page_data,
                        title="Positive tabindex disrupts focus order",
                        impact="Keyboard-only residents may move through the page in an order that does not match the visual journey.",
                        guideline="WCAG 2.4.3 Focus Order",
                        severity="High",
                        fix="Remove positive tabindex values and let DOM order match the visual reading flow.",
                        selector=item["selector"],
                        source_snippet=f'tabindex="{item["tabindex"]}"',
                        screenshot_path=sp,
                        screenshot_url=su,
                    ))

                # Images without alt text
                for item in checks.get("imagesNoAlt", []):
                    sp, su = _annotated(item["selector"], "!", "image-missing-alt", "Image missing alt text")
                    findings.append(_make_finding(
                        rule="image-missing-alt",
                        prefix="IMG",
                        page_data=page_data,
                        title="Image is missing alternative text",
                        impact="Screen reader users will not receive any description of the image content.",
                        guideline="WCAG 1.1.1 Non-text Content",
                        severity="Critical",
                        fix="Add descriptive alt text to the <img> element, or alt=\"\" if it is decorative.",
                        selector=item["selector"],
                        source_snippet=item["src"],
                        screenshot_path=sp,
                        screenshot_url=su,
                    ))

                # Low color contrast
                for item in checks.get("lowContrast", []):
                    sp, su = _annotated(item["selector"], "!", "low-contrast", "Low color contrast")
                    ratio = item.get("ratio")
                    required = item.get("required")
                    findings.append(_make_finding(
                        rule="low-contrast",
                        prefix="CONTRAST",
                        page_data=page_data,
                        title="Text color contrast is below the WCAG minimum",
                        impact="Low-vision residents and people in bright light may be unable to read this text.",
                        guideline="WCAG 1.4.3 Contrast (Minimum)",
                        severity="High",
                        fix=f"Increase the contrast ratio to at least {required}:1 (measured about {ratio}:1). Verify manually — text over images or gradients is not assessed automatically.",
                        selector=item["selector"],
                        source_snippet=f'"{item.get("text", "")}" — {ratio}:1 (needs {required}:1)',
                        screenshot_path=sp,
                        screenshot_url=su,
                    ))
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

    result = {
        "findings": [f.model_dump(mode="json") for f in findings],
        "screenshotPath": base_screenshot_path,
        "screenshotUrl": base_screenshot_url,
        "skippedActions": [],
    }
    if scan_error:
        result["error"] = scan_error
    return result


def _scan_basic(page_data: dict) -> dict:
    """Fallback when Playwright is unavailable: check PageSnapshot fields only."""
    findings: list[Finding] = []

    if not page_data.get("heading"):
        findings.append(_make_finding(
            rule="missing-heading",
            prefix="HEAD",
            page_data=page_data,
            title="Page may be missing a clear primary heading",
            impact="Residents using screen readers may not understand the purpose of the page.",
            guideline="WCAG 2.4.6 Headings and Labels",
            severity="Medium",
            fix="Add one descriptive H1 that explains the page purpose.",
        ))

    if page_data.get("forms"):
        findings.append(_make_finding(
            rule="form-label-manual-check",
            prefix="FORM",
            page_data=page_data,
            title="Form requires manual label and submission review",
            impact="A resident may be blocked if form fields do not expose accessible labels or errors.",
            guideline="WCAG 3.3.2 Labels or Instructions",
            severity="High",
            fix="Verify every input has a programmatic label, clear instructions, and accessible error messaging.",
        ))

    return {
        "findings": [f.model_dump(mode="json") for f in findings],
        "screenshotPath": page_data.get("screenshotPath"),
        "screenshotUrl": page_data.get("screenshotUrl"),
        "skippedActions": [],
    }


def scan_accessibility(page: PageSnapshot | dict, audit_id: str = "manual") -> dict:
    page_data = page if isinstance(page, dict) else page.model_dump()
    if _PLAYWRIGHT_AVAILABLE and page_data.get("url"):
        try:
            return _scan_with_playwright(page_data, audit_id)
        except Exception:
            pass
    return _scan_basic(page_data)
