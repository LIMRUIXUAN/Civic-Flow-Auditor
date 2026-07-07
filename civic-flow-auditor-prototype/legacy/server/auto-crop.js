import { chromium } from "playwright";
import { identifyCropBounds } from "./vision-provider.js";
import fs from "node:fs/promises";

export async function cropDocumentImage(imagePathOrBase64, { paddingPercent = 5 } = {}) {
  let base64Data = "";
  if (imagePathOrBase64.startsWith("data:") || imagePathOrBase64.length > 500) {
    base64Data = imagePathOrBase64;
  } else {
    const bytes = await fs.readFile(imagePathOrBase64);
    base64Data = `data:image/png;base64,${bytes.toString("base64")}`;
  }

  // 1. Get bounds from Gemini Vision
  let bounds = { x: 0, y: 0, width: 100, height: 100 };
  try {
    bounds = await identifyCropBounds(base64Data);
  } catch (error) {
    console.error("Gemini crop bounds failed, using full size", error);
  }

  // 2. Launch browser to perform the crop
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <style>
            body { margin: 0; padding: 0; background: transparent; }
            img { display: block; max-width: none; }
          </style>
        </head>
        <body>
          <img src="${base64Data}" alt="" id="target-img" />
        </body>
      </html>
    `, { waitUntil: "load" });

    const dimensions = await page.evaluate(() => {
      const img = document.getElementById("target-img");
      return { width: img.naturalWidth, height: img.naturalHeight };
    });

    const pxX = Math.round((bounds.x / 100) * dimensions.width);
    const pxY = Math.round((bounds.y / 100) * dimensions.height);
    const pxW = Math.round((bounds.width / 100) * dimensions.width);
    const pxH = Math.round((bounds.height / 100) * dimensions.height);

    const padX = Math.round(dimensions.width * (paddingPercent / 100));
    const padY = Math.round(dimensions.height * (paddingPercent / 100));

    const clipX = Math.max(0, pxX - padX);
    const clipY = Math.max(0, pxY - padY);
    const clipW = Math.min(dimensions.width - clipX, pxW + padX * 2);
    const clipH = Math.min(dimensions.height - clipY, pxH + padY * 2);

    await page.setViewportSize({ width: dimensions.width, height: dimensions.height });

    const croppedBuffer = await page.screenshot({
      clip: { x: clipX, y: clipY, width: clipW, height: clipH },
      type: "png",
    });

    return {
      croppedBuffer,
      cropBounds: bounds,
      croppedBase64: `data:image/png;base64,${croppedBuffer.toString("base64")}`,
      originalSize: dimensions,
      croppedSize: { width: clipW, height: clipH }
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function cropSubRegion(parentBase64, bounds) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <style>
            body { margin: 0; padding: 0; background: transparent; }
            img { display: block; max-width: none; }
          </style>
        </head>
        <body>
          <img src="${parentBase64}" alt="" id="target-img" />
        </body>
      </html>
    `, { waitUntil: "load" });

    const dimensions = await page.evaluate(() => {
      const img = document.getElementById("target-img");
      return { width: img.naturalWidth, height: img.naturalHeight };
    });

    const clipX = Math.max(0, Math.round((bounds.x / 100) * dimensions.width));
    const clipY = Math.max(0, Math.round((bounds.y / 100) * dimensions.height));
    const clipW = Math.min(dimensions.width - clipX, Math.round((bounds.width / 100) * dimensions.width));
    const clipH = Math.min(dimensions.height - clipY, Math.round((bounds.height / 100) * dimensions.height));

    await page.setViewportSize({ width: dimensions.width, height: dimensions.height });

    const croppedBuffer = await page.screenshot({
      clip: { x: clipX, y: clipY, width: clipW, height: clipH },
      type: "png",
    });

    return `data:image/png;base64,${croppedBuffer.toString("base64")}`;
  } finally {
    await browser.close().catch(() => {});
  }
}
