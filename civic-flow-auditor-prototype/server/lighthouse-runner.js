import { config } from "./config.js";
import { validateScanTarget } from "./security.js";

export async function runLighthouseAccessibility(url) {
  if (!config.enableLighthouse) {
    return { status: "not-run" };
  }

  let chrome;
  try {
    const safeUrl = await validateScanTarget(url, { checkRedirects: false });
    const lighthouseModule = await import("lighthouse");
    const chromeLauncher = await import("chrome-launcher");
    const lighthouse = lighthouseModule.default;
    chrome = await chromeLauncher.launch({
      chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage"],
    });
    const result = await lighthouse(safeUrl, {
      port: chrome.port,
      onlyCategories: ["accessibility"],
      logLevel: "error",
    });
    const score = result?.lhr?.categories?.accessibility?.score;
    return {
      status: "complete",
      accessibilityScore: typeof score === "number" ? Math.round(score * 100) : undefined,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await chrome?.kill?.().catch(() => {});
  }
}
