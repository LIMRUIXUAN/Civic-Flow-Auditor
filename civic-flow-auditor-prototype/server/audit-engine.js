import fs from "node:fs/promises";
import path from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { PDFParse } from "pdf-parse";
import { chromium } from "playwright";
import { nowIso, safetyNotes } from "../shared/audit-contract.js";
import { defaultAgentSteps } from "../shared/demo-data.js";
import {
  buildStagesFromPagesAndFindings,
  classifyJourney,
  createFinding,
  dedupeAndSortFindings,
  depthToMaxPages,
  guidelineFromTags,
  isImageOnlyPdfText,
  isSameDomainUrl,
  mapAxeImpactToSeverity,
  normalizeDepth,
  summarizePdfText,
} from "../shared/audit-utils.js";
import { buildDeterministicExecutiveSummary } from "./ai-provider.js";
import { config } from "./config.js";
import { runLighthouseAccessibility } from "./lighthouse-runner.js";
import { ocrPdfFirstPages } from "./ocr.js";
import { generateReport } from "./report.js";
import { createSkippedAction, unsafeHttpMethods, validateScanTarget } from "./security.js";
import { artifactUrl, ensureRunDir } from "./store.js";

const defaultViewport = { width: 1366, height: 900 };

function compactText(value = "", limit = 4000) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanFilePart(value) {
  return String(value).replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "page";
}

function emptyAgentSteps() {
  return defaultAgentSteps.map((step) => ({ ...step, status: "queued" }));
}

function throwIfCancelled(signal) {
  if (signal?.aborted) {
    throw new Error("Audit cancelled by the user.");
  }
}

function pushSkipped(skippedActions, action) {
  if (!Array.isArray(skippedActions)) return;
  skippedActions.push(createSkippedAction(action));
}

async function installSafeRoutes(context, skippedActions, stage) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (unsafeHttpMethods.has(method)) {
      pushSkipped(skippedActions, {
        url: request.url(),
        method,
        action: "blocked-http-method",
        reason: "Scanner blocks state-changing HTTP methods.",
        stage,
      });
      await route.abort().catch(() => {});
      return;
    }

    if (request.isNavigationRequest()) {
      try {
        await validateScanTarget(request.url(), { checkRedirects: false, tolerateNetworkErrors: true });
      } catch (error) {
        pushSkipped(skippedActions, {
          url: request.url(),
          method,
          action: "blocked-navigation",
          reason: error instanceof Error ? error.message : String(error),
          stage,
        });
        await route.abort().catch(() => {});
        return;
      }
    }

    await route.continue().catch(() => {});
  });
}

function setAgentStep(steps, name, status, detail) {
  return steps.map((step) => (step.name === name ? { ...step, status, detail: detail || step.detail } : step));
}

function mergeUniqueDocuments(existing, incoming) {
  const seen = new Set(existing.map((doc) => doc.url));
  const merged = [...existing];
  for (const doc of incoming) {
    if (!seen.has(doc.url)) {
      seen.add(doc.url);
      merged.push(doc);
    }
  }
  return merged;
}

async function fetchFallbackSnapshot(url, maxPages, { skippedActions = [], signal } = {}) {
  const pages = [];
  const documents = [];
  const visited = new Set();
  const queue = [url];

  while (queue.length && pages.length < maxPages) {
    throwIfCancelled(signal);
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    try {
      const safeCurrent = await validateScanTarget(current, { checkRedirects: false });
      const response = await fetch(safeCurrent, { redirect: "manual", signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location) {
          const redirectUrl = new URL(location, safeCurrent).href;
          try {
            await validateScanTarget(redirectUrl, { checkRedirects: false });
            if (!visited.has(redirectUrl) && pages.length + queue.length < maxPages) queue.push(redirectUrl);
          } catch (error) {
            pushSkipped(skippedActions, {
              url: redirectUrl,
              action: "blocked-redirect",
              reason: error instanceof Error ? error.message : String(error),
              stage: "Discovery",
            });
          }
        }
        continue;
      }
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("text/html")) continue;
      const html = await response.text();
      const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] || "";
      const heading = html.match(/<h1[^>]*>(.*?)<\/h1>/is)?.[1] || "";
      const textSample = compactText(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "));
      const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)].map((match) => {
        const href = new URL(match[1], current).href;
        const text = compactText(match[2].replace(/<[^>]+>/g, " "), 140);
        return { href, text };
      });
      const pdfs = links.filter((link) => /\.pdf($|[?#])/i.test(link.href)).map((link) => ({ url: link.href, text: link.text }));
      documents.push(...pdfs.map((pdf) => ({ url: pdf.url, title: pdf.text || "Linked PDF", matchedStage: "pdf" })));

      const journey = classifyJourney({ url: current, title, heading, textSample });
      pages.push({
        url: current,
        title,
        heading,
        textSample,
        links,
        pdfs,
        forms: [],
        session: journey.id,
        sessionLabel: journey.label,
        scanned: false,
      });

      for (const link of links) {
        if (pages.length + queue.length >= maxPages) break;
        if (!isSameDomainUrl(link.href, url) || /\.pdf($|[?#])/i.test(link.href) || visited.has(link.href)) continue;
        queue.push(link.href);
      }
    } catch {
      // Fallback crawler is best-effort. Individual failures should not stop the audit.
    }
  }

  return { pages, documents, crawlErrors: pages.length ? [] : ["Playwright and fetch fallback could not read the target site."], skippedActions };
}

export async function crawlSite({ url, max_pages = config.maxPages, same_domain_only = true, auditId = "manual", signal, skippedActions = [] }) {
  const safeUrl = await validateScanTarget(url);

  const maxPages = Math.min(Number(max_pages) || config.maxPages, config.maxPages);
  const runDir = await ensureRunDir(auditId);
  const pages = [];
  const documents = [];
  const visited = new Set();
  const queue = [safeUrl];
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: defaultViewport });
    await installSafeRoutes(context, skippedActions, "Discovery");

    while (queue.length && pages.length < maxPages) {
      throwIfCancelled(signal);
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);

      const page = await context.newPage();
      page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

      try {
        await page.goto(current, { waitUntil: "domcontentloaded", timeout: 18000 });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        const finalUrl = await validateScanTarget(page.url(), { checkRedirects: false });
        if (same_domain_only && !isSameDomainUrl(finalUrl, safeUrl)) {
          pushSkipped(skippedActions, {
            url: finalUrl,
            action: "blocked-cross-domain-redirect",
            reason: "Scanner stays on the starting domain for the pilot.",
            stage: "Discovery",
          });
          continue;
        }

        const pageIndex = pages.length + 1;
        const currentUrl = finalUrl;
        const screenshotFile = `page-${String(pageIndex).padStart(2, "0")}-${cleanFilePart(new URL(currentUrl).hostname)}.png`;
        const screenshotPath = path.join(runDir, screenshotFile);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

        const snapshot = await page.evaluate(() => {
          const clean = (value = "") => String(value).replace(/\s+/g, " ").trim();
          const linkNodes = [...document.querySelectorAll("a[href]")];
          const links = linkNodes.map((node) => ({
            href: node.href,
            text: clean(node.innerText || node.getAttribute("aria-label") || node.getAttribute("title") || ""),
          }));
          const pdfs = links.filter((link) => /\.pdf($|[?#])/i.test(link.href));
          const labelFor = (field) => {
            const id = field.getAttribute("id");
            const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
            const implicit = field.closest("label");
            return clean(
              explicit?.innerText ||
                implicit?.innerText ||
                field.getAttribute("aria-label") ||
                field.getAttribute("placeholder") ||
                field.getAttribute("name") ||
                "",
            );
          };
          const forms = [...document.querySelectorAll("form")].map((form) => ({
            name: clean(form.getAttribute("name") || form.getAttribute("aria-label") || ""),
            action: form.getAttribute("action") || "",
            method: (form.getAttribute("method") || "get").toLowerCase(),
            labels: [...form.querySelectorAll("input, select, textarea")].map(labelFor).filter(Boolean),
            buttons: [...form.querySelectorAll("button, input[type='submit'], input[type='button']")]
              .map((button) => clean(button.innerText || button.value || button.getAttribute("aria-label") || ""))
              .filter(Boolean),
          }));

          return {
            title: clean(document.title),
            heading: clean(document.querySelector("h1,h2")?.innerText || ""),
            textSample: clean(document.body?.innerText || "").slice(0, 4000),
            links,
            pdfs,
            forms,
          };
        });

        const journey = classifyJourney({ url: currentUrl, ...snapshot });
        if (journey.id === "login") {
          pushSkipped(skippedActions, {
            url: currentUrl,
            action: "login-page-observed",
            reason: "Authenticated flows are out of scope for the pilot scanner.",
            stage: "Discovery",
          });
        }
        for (const form of snapshot.forms || []) {
          if (String(form.method || "get").toUpperCase() !== "GET") {
            pushSkipped(skippedActions, {
              url: currentUrl,
              method: String(form.method || "get").toUpperCase(),
              action: "form-submission-skipped",
              reason: "The scanner records form structure but never submits forms.",
              stage: journey.label,
            });
          }
        }
        pages.push({
          url: currentUrl,
          title: snapshot.title,
          heading: snapshot.heading,
          textSample: snapshot.textSample,
          links: snapshot.links,
          pdfs: snapshot.pdfs,
          forms: snapshot.forms,
          session: journey.id,
          sessionLabel: journey.label,
          screenshotPath,
          screenshotUrl: artifactUrl(auditId, screenshotFile),
          scanned: false,
        });

        const incomingDocs = snapshot.pdfs.map((pdf) => ({ url: pdf.href || pdf.url, title: pdf.text || "Linked PDF", matchedStage: "pdf" }));
        documents.splice(0, documents.length, ...mergeUniqueDocuments(documents, incomingDocs));

        for (const link of snapshot.links) {
          if (pages.length + queue.length >= maxPages) break;
          if (/\.pdf($|[?#])/i.test(link.href)) continue;
          if (same_domain_only && !isSameDomainUrl(link.href, safeUrl)) continue;
          if (visited.has(link.href) || queue.includes(link.href)) continue;
          queue.push(link.href);
        }
      } catch (error) {
        pages.push({
          url: current,
          title: "",
          heading: "",
          textSample: "",
          links: [],
          pdfs: [],
          forms: [],
          session: "general",
          sessionLabel: "General info",
          scanned: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await page.close().catch(() => {});
      }
    }

    await context.close();
  } catch {
    return fetchFallbackSnapshot(safeUrl, maxPages, { skippedActions, signal });
  } finally {
    await browser?.close().catch(() => {});
  }

  return { pages, documents, crawlErrors: [], skippedActions };
}

function selectorForCustomFinding(kind, pageUrl) {
  return `${kind} on ${pageUrl}`;
}

async function collectCustomChecks(page) {
  return page.evaluate(() => {
    const clean = (value = "") => String(value).replace(/\s+/g, " ").trim();
    const cssPath = (element) => {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return "";
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const siblings = [...(current.parentElement?.children || [])].filter((node) => node.tagName === current.tagName);
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}${siblings.length > 1 ? `:nth-of-type(${index})` : ""}`);
        current = current.parentElement;
      }
      return parts.join(" > ");
    };
    const fieldLabel = (field) => {
      const id = field.getAttribute("id");
      const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const implicit = field.closest("label");
      return clean(explicit?.innerText || implicit?.innerText || field.getAttribute("aria-label") || field.getAttribute("aria-labelledby") || "");
    };
    const fields = [...document.querySelectorAll("input, select, textarea")].filter((field) => !["hidden", "submit", "button", "reset"].includes((field.getAttribute("type") || "").toLowerCase()));
    const missingLabels = fields.filter((field) => !fieldLabel(field)).slice(0, 5).map((field) => ({
      selector: cssPath(field),
      html: field.outerHTML.slice(0, 280),
    }));
    const requiredWithoutInstructions = fields
      .filter((field) => field.required && !clean(field.getAttribute("aria-describedby") || field.getAttribute("placeholder") || field.closest("label")?.innerText || ""))
      .slice(0, 5)
      .map((field) => ({ selector: cssPath(field), html: field.outerHTML.slice(0, 280) }));
    const vagueLinks = [...document.querySelectorAll("a[href]")]
      .filter((link) => /^(click here|here|read more|more|learn more)$/i.test(clean(link.innerText || link.getAttribute("aria-label") || "")))
      .slice(0, 5)
      .map((link) => ({ selector: cssPath(link), text: clean(link.innerText || link.getAttribute("aria-label") || "") }));
    const positiveTabIndex = [...document.querySelectorAll("[tabindex]")]
      .filter((node) => Number(node.getAttribute("tabindex")) > 0)
      .slice(0, 5)
      .map((node) => ({ selector: cssPath(node), tabindex: node.getAttribute("tabindex") }));
    const hasHeading = Boolean(document.querySelector("h1,h2"));
    const submitButtons = [...document.querySelectorAll("button, input[type='submit']")]
      .filter((button) => /submit|send|apply|finish|complete/i.test(clean(button.innerText || button.value || button.getAttribute("aria-label") || "")))
      .slice(0, 5)
      .map((button) => ({ selector: cssPath(button), text: clean(button.innerText || button.value || button.getAttribute("aria-label") || "") }));

    return { missingLabels, requiredWithoutInstructions, vagueLinks, positiveTabIndex, hasHeading, submitButtons };
  });
}

async function boxForSelector(page, selector, label) {
  try {
    if (!selector || selector.includes(" on ")) return [];
    const box = await page.locator(selector).first().boundingBox();
    if (!box) return [];
    return [{ ...box, label }];
  } catch {
    return [];
  }
}

export async function scanAccessibility({ page_url, viewport = defaultViewport, auditId = "manual", pageSnapshot, signal, skippedActions = [] }) {
  const safeUrl = await validateScanTarget(page_url);

  const runDir = await ensureRunDir(auditId);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  await installSafeRoutes(context, skippedActions, "Accessibility Audit");
  const page = await context.newPage();
  const findings = [];

  try {
    throwIfCancelled(signal);
    await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 18000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    const finalUrl = await validateScanTarget(page.url(), { checkRedirects: false });
    const screenshotFile = `scan-${cleanFilePart(new URL(page.url()).hostname)}-${Date.now()}.png`;
    const screenshotPath = path.join(runDir, screenshotFile);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const journey = classifyJourney(pageSnapshot || { url: safeUrl });
    const pageInfo = {
      ...(pageSnapshot || {}),
      url: finalUrl,
      session: pageSnapshot?.session || journey.id,
      sessionLabel: pageSnapshot?.sessionLabel || journey.label,
      screenshotPath,
      screenshotUrl: artifactUrl(auditId, screenshotFile),
    };

    const axeResult = await new AxeBuilder({ page }).analyze();
    let index = 1;
    for (const violation of axeResult.violations) {
      for (const node of violation.nodes.slice(0, 2)) {
        const selector = node.target?.[0] || "";
        const issueBoxes = await boxForSelector(page, selector, String(index));
        findings.push(
          createFinding({
            index,
            prefix: "AXE",
            page: pageInfo,
            title: violation.help,
            impact: violation.description,
            guideline: guidelineFromTags(violation.tags),
            severity: mapAxeImpactToSeverity(violation.impact),
            fix: node.failureSummary || violation.helpUrl || "Review the affected element and apply the WCAG guidance.",
            selector,
            sourceSnippet: node.html,
            issueBoxes,
          }),
        );
        index += 1;
      }
    }

    const custom = await collectCustomChecks(page);
    for (const item of custom.missingLabels) {
      findings.push(
        createFinding({
          index: findings.length + 1,
          prefix: "FORM",
          page: pageInfo,
          title: "Form control is missing a programmatic label",
          impact: "Screen reader users may not know what information the public-service form is asking for.",
          guideline: "WCAG 2.1 1.3.1",
          severity: "Critical",
          fix: "Add a visible label with a matching for/id pair or connect the control with aria-labelledby.",
          selector: item.selector,
          sourceSnippet: item.html,
          issueBoxes: await boxForSelector(page, item.selector, String(findings.length + 1)),
        }),
      );
    }
    for (const item of custom.requiredWithoutInstructions) {
      findings.push(
        createFinding({
          index: findings.length + 1,
          prefix: "REQ",
          page: pageInfo,
          title: "Required field lacks nearby instructions",
          impact: "Residents may miss required field rules or error-prevention instructions before submitting.",
          guideline: "WCAG 2.1 3.3.2",
          severity: "High",
          fix: "Place clear required-field instructions near the input and reference them with aria-describedby.",
          selector: item.selector,
          sourceSnippet: item.html,
          issueBoxes: await boxForSelector(page, item.selector, String(findings.length + 1)),
        }),
      );
    }
    for (const item of custom.vagueLinks) {
      findings.push(
        createFinding({
          index: findings.length + 1,
          prefix: "LINK",
          page: pageInfo,
          title: "Link text is too vague",
          impact: "Screen reader users navigating by links may not know which public-service step the link opens.",
          guideline: "WCAG 2.1 2.4.4",
          severity: "Medium",
          fix: "Replace vague link text with the destination or action, such as 'Read business license requirements'.",
          selector: item.selector,
          sourceSnippet: item.text,
          issueBoxes: await boxForSelector(page, item.selector, String(findings.length + 1)),
        }),
      );
    }
    for (const item of custom.positiveTabIndex) {
      findings.push(
        createFinding({
          index: findings.length + 1,
          prefix: "KEY",
          page: pageInfo,
          title: "Positive tabindex can create confusing focus order",
          impact: "Keyboard-only residents may move through the form in an order that does not match the visual journey.",
          guideline: "WCAG 2.1 2.4.3",
          severity: "High",
          fix: "Remove positive tabindex values and let DOM order match the visual flow.",
          selector: item.selector,
          sourceSnippet: `tabindex="${item.tabindex}"`,
          issueBoxes: await boxForSelector(page, item.selector, String(findings.length + 1)),
        }),
      );
    }
    if (!custom.hasHeading) {
      findings.push(
        createFinding({
          index: findings.length + 1,
          prefix: "HEAD",
          page: pageInfo,
          title: "Page is missing a clear heading",
          impact: "Screen reader and keyboard users may not understand which civic task or flow step they are on.",
          guideline: "WCAG 2.1 2.4.6",
          severity: "Medium",
          fix: "Add a descriptive h1 or h2 that names the public-service task step.",
          selector: selectorForCustomFinding("heading", pageInfo.url),
          sourceSnippet: "",
        }),
      );
    }
    for (const item of custom.submitButtons) {
      findings.push(
        createFinding({
          index: findings.length + 1,
          prefix: "SAFE",
          page: pageInfo,
          title: "Submission step needs human review guardrail",
          impact: "People may submit public-service data before reviewing draft or auto-filled values.",
          guideline: "Safety review",
          severity: "Low",
          fix: "Keep a visible review step before submission and never let the agent submit forms automatically.",
          selector: item.selector,
          sourceSnippet: item.text,
          issueBoxes: await boxForSelector(page, item.selector, String(findings.length + 1)),
        }),
      );
    }

    return { findings, screenshotPath, screenshotUrl: artifactUrl(auditId, screenshotFile), scannedUrl: finalUrl, skippedActions };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function parseDocument({ pdf_url, auditId = "manual", signal }) {
  const safeUrl = await validateScanTarget(pdf_url);
  const response = await fetch(safeUrl, { signal, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      await validateScanTarget(new URL(location, safeUrl).href, { checkRedirects: false });
    }
    throw new Error("PDF request redirected and was skipped for safety.");
  }
  if (!response.ok) {
    throw new Error(`Could not fetch PDF (${response.status})`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const extractedText = result.text || "";
    const imageOnly = isImageOnlyPdfText(extractedText);
    const ocr = imageOnly ? await ocrPdfFirstPages(buffer, { pagesLimit: 2 }) : { status: "not-needed", text: "", pages: 0 };
    const combinedText = ocr.text ? `${extractedText}\n${ocr.text}`.trim() : extractedText;
    return {
      url: safeUrl,
      title: path.basename(new URL(safeUrl).pathname) || "Linked PDF",
      extractedText: combinedText,
      textLength: combinedText.length,
      imageOnly: isImageOnlyPdfText(combinedText),
      summary: summarizePdfText(combinedText) || ocr.error || "",
      ocrText: ocr.text || "",
      ocrStatus: ocr.status,
      ocrPages: ocr.pages || 0,
      matchedStage: "pdf",
    };
  } finally {
    await parser.destroy().catch(() => {});
    await ensureRunDir(auditId);
  }
}

export async function mapJourney({ pages = [], documents = [] }) {
  const mappedPages = pages.map((page) => {
    const journey = classifyJourney(page);
    return { ...page, session: journey.id, sessionLabel: journey.label };
  });

  return {
    pages: mappedPages,
    documents,
    stages: buildStagesFromPagesAndFindings(mappedPages, documents, []),
  };
}

export async function annotateScreenshot({ screenshotPath, issueBoxes = [], auditId = "manual" }) {
  if (!screenshotPath || !issueBoxes.length) {
    return { annotatedScreenshotPath: screenshotPath };
  }

  const bytes = await fs.readFile(screenshotPath);
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  const runDir = await ensureRunDir(auditId);
  const outputPath = path.join(runDir, `annotated-${path.basename(screenshotPath)}`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const boxes = issueBoxes
    .map(
      (box) => `<div class="box" style="left:${box.x}px;top:${box.y}px;width:${Math.max(box.width, 24)}px;height:${Math.max(box.height, 24)}px"><b>${box.label}</b></div>`,
    )
    .join("");

  try {
    await page.setContent(
      `<!doctype html><html><head><style>
        body { margin: 0; background: white; }
        .wrap { position: relative; display: inline-block; }
        img { display: block; max-width: none; }
        .box { position: absolute; border: 5px solid #0f766e; outline: 3px solid #f59e0b; box-sizing: border-box; }
        .box b { position: absolute; left: -5px; top: -34px; background: #0f3557; color: white; border-radius: 999px; padding: 5px 10px; font: 700 16px Arial; }
      </style></head><body><div class="wrap"><img src="${dataUrl}" alt="">${boxes}</div></body></html>`,
      { waitUntil: "load" },
    );
    await page.screenshot({ path: outputPath, fullPage: true });
    return { annotatedScreenshotPath: outputPath, annotatedScreenshotUrl: artifactUrl(auditId, path.basename(outputPath)) };
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function generateReportArtifact({ auditRun }) {
  return generateReport(auditRun);
}

export async function runCivicFlowAudit({ id, url, depth = "standard", onUpdate = async () => {}, signal }) {
  const normalizedDepth = normalizeDepth(depth);
  const safeUrl = await validateScanTarget(url);

  let run = {
    id,
    url: safeUrl,
    depth: normalizedDepth,
    status: "validating",
    progress: 5,
    executiveSummary: "",
    pages: [],
    documents: [],
    stages: [],
    findings: [],
    agentSteps: setAgentStep(emptyAgentSteps(), "Intake and Safety", "running", "Validating public URL and safety scope."),
    ai: { provider: "none", model: "deterministic", status: "deterministic", generatedFields: [] },
    scanner: { lighthouse: { status: "not-run" }, ocr: { status: "not-run", pagesLimit: 2, documentsAttempted: 0 } },
    skippedActions: [],
    artifacts: { screenshots: [] },
    safetyNotes,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const update = async (patch) => {
    run = { ...run, ...patch, updatedAt: nowIso() };
    await onUpdate(run);
  };

  try {
    throwIfCancelled(signal);
    await update({
      status: "scanning",
      progress: 10,
      agentSteps: setAgentStep(run.agentSteps, "Intake and Safety", "complete", "URL validated, no-login and no-auto-submit guard active."),
    });

    await update({ agentSteps: setAgentStep(run.agentSteps, "Discovery", "running", "Crawling public same-domain pages and linked PDFs.") });
    const crawl = await crawlSite({
      url: safeUrl,
      max_pages: depthToMaxPages(normalizedDepth, config.maxPages),
      same_domain_only: true,
      auditId: id,
      signal,
      skippedActions: run.skippedActions,
    });
    await update({
      pages: crawl.pages,
      documents: crawl.documents,
      skippedActions: crawl.skippedActions || run.skippedActions,
      progress: 28,
      agentSteps: setAgentStep(run.agentSteps, "Discovery", "complete", `${crawl.pages.length} pages and ${crawl.documents.length} PDFs found.`),
    });

    await update({ agentSteps: setAgentStep(run.agentSteps, "Journey Mapper", "running", "Classifying pages into civic task sessions.") });
    const journey = await mapJourney({ pages: run.pages, documents: run.documents });
    await update({
      pages: journey.pages,
      stages: journey.stages,
      progress: 38,
      agentSteps: setAgentStep(run.agentSteps, "Journey Mapper", "complete", `${journey.stages.length} public-service sessions mapped.`),
    });

    await update({
      progress: 42,
      agentSteps: setAgentStep(setAgentStep(run.agentSteps, "Guideline", "complete", "WCAG 2.1 AA, WCAG 2.2 notes, and ADA safety language loaded."), "Accessibility Audit", "running", "Running axe-core and custom checks."),
    });

    throwIfCancelled(signal);
    const lighthouse = await runLighthouseAccessibility(run.url);
    await update({
      scanner: { ...run.scanner, lighthouse },
    });

    const findings = [];
    const pages = [];
    for (const page of run.pages) {
      throwIfCancelled(signal);
      try {
        const scan = await scanAccessibility({ page_url: page.url, auditId: id, pageSnapshot: page, signal, skippedActions: run.skippedActions });
        findings.push(...scan.findings);
        pages.push({ ...page, scanned: true, screenshotPath: scan.screenshotPath || page.screenshotPath, screenshotUrl: scan.screenshotUrl || page.screenshotUrl });
      } catch (error) {
        throwIfCancelled(signal);
        pages.push({ ...page, scanned: false, error: error instanceof Error ? error.message : String(error) });
      }
      const scanProgress = 42 + Math.round((pages.length / Math.max(run.pages.length, 1)) * 25);
      await update({ pages, findings, skippedActions: run.skippedActions, progress: Math.min(scanProgress, 67) });
    }

    const dedupedFindings = dedupeAndSortFindings(findings);
    await update({
      findings: dedupedFindings,
      progress: 68,
      agentSteps: setAgentStep(run.agentSteps, "Accessibility Audit", "complete", `${dedupedFindings.length} automated and custom findings drafted.`),
    });

    await update({ agentSteps: setAgentStep(run.agentSteps, "Document Review", "running", "Extracting linked PDF text where possible.") });
    const parsedDocuments = [];
    let ocrDocumentsAttempted = 0;
    for (const doc of run.documents.slice(0, 3)) {
      throwIfCancelled(signal);
      try {
        const parsedDocument = await parseDocument({ pdf_url: doc.url, auditId: id, signal });
        if (parsedDocument.ocrStatus === "complete" || parsedDocument.ocrStatus === "failed") ocrDocumentsAttempted += 1;
        parsedDocuments.push(parsedDocument);
      } catch (error) {
        throwIfCancelled(signal);
        pushSkipped(run.skippedActions, {
          url: doc.url,
          action: "pdf-parse-failed",
          reason: error instanceof Error ? error.message : String(error),
          stage: "Document Review",
        });
        parsedDocuments.push({
          ...doc,
          extractedText: "",
          textLength: 0,
          imageOnly: true,
          summary: "The PDF could not be parsed in this scan and needs manual accessibility review.",
          ocrStatus: "failed",
          ocrPages: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const pdfFindings = parsedDocuments
      .filter((doc) => doc.imageOnly)
      .map((doc, index) =>
        createFinding({
          index: index + 1,
          prefix: "PDF",
          page: { url: doc.url, session: "pdf", sessionLabel: "Handbook / PDF" },
          title: "PDF appears to be image-only or unreadable",
          impact: "Screen reader users may not be able to read deadlines, eligibility rules, or required document instructions.",
          guideline: "WCAG 2.1 1.1.1",
          severity: "Critical",
          fix: "Replace the PDF with a tagged, text-selectable document that includes headings and accessible form structure.",
          selector: doc.url,
          sourceSnippet: doc.summary,
        }),
      );

    await update({
      documents: parsedDocuments,
      findings: dedupeAndSortFindings([...run.findings, ...pdfFindings]),
      scanner: {
        ...run.scanner,
        ocr: {
          status: ocrDocumentsAttempted ? "complete" : "not-run",
          pagesLimit: 2,
          documentsAttempted: ocrDocumentsAttempted,
        },
      },
      skippedActions: run.skippedActions,
      progress: 76,
      agentSteps: setAgentStep(run.agentSteps, "Document Review", "complete", `${parsedDocuments.length} linked PDFs reviewed.`),
    });

    await update({ agentSteps: setAgentStep(run.agentSteps, "Evidence Annotation", "running", "Rendering numbered, colorblind-safe screenshot frames.") });
    const annotatedFindings = [];
    for (const finding of run.findings) {
      throwIfCancelled(signal);
      if (finding.screenshotPath && finding.issueBoxes?.length) {
        try {
          const annotated = await annotateScreenshot({ screenshotPath: finding.screenshotPath, issueBoxes: finding.issueBoxes, auditId: id });
          annotatedFindings.push({ ...finding, screenshotPath: annotated.annotatedScreenshotPath, screenshotUrl: annotated.annotatedScreenshotUrl || finding.screenshotUrl });
          continue;
        } catch {
          // Keep the original screenshot if annotation fails.
        }
      }
      annotatedFindings.push(finding);
    }

    const finalFindings = dedupeAndSortFindings(annotatedFindings);
    const artifacts = {
      ...run.artifacts,
      screenshots: [...new Set(finalFindings.map((finding) => finding.screenshotPath).filter(Boolean))],
    };
    const finalStages = buildStagesFromPagesAndFindings(run.pages, run.documents, finalFindings);
    await update({
      findings: finalFindings,
      stages: finalStages,
      artifacts,
      progress: 84,
      agentSteps: setAgentStep(run.agentSteps, "Evidence Annotation", "complete", "Issue frames and callouts prepared."),
    });

    await update({
      executiveSummary: buildDeterministicExecutiveSummary(run),
      progress: 88,
      agentSteps: setAgentStep(run.agentSteps, "Remediation", "complete", "Plain-language fixes and developer tickets drafted."),
    });
    await update({
      progress: 92,
      agentSteps: setAgentStep(run.agentSteps, "Safety Review", "complete", "Human-review and no-auto-submit disclaimers attached."),
    });
    await update({ agentSteps: setAgentStep(run.agentSteps, "Report Export", "running", "Writing standalone HTML and PDF artifacts.") });

    const reportArtifacts = await generateReport(run);
    await update({
      artifacts: { ...run.artifacts, ...reportArtifacts },
      status: "report-ready",
      progress: 100,
      agentSteps: setAgentStep(run.agentSteps, "Report Export", "complete", "Standalone HTML report ready."),
    });

    return run;
  } catch (error) {
    const cancelled = signal?.aborted || /cancelled/i.test(error instanceof Error ? error.message : String(error));
    await update({
      status: cancelled ? "cancelled" : "failed",
      progress: Math.max(run.progress, 10),
      error: error instanceof Error ? error.message : String(error),
      agentSteps: run.agentSteps.map((step) => (step.status === "running" || (cancelled && step.status === "queued") ? { ...step, status: cancelled ? "cancelled" : "failed" } : step)),
    });
    return run;
  }
}
