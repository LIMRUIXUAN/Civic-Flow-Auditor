import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeArtifactName } from "../server/store.js";
import { isBlockedIpAddress, validateRedirectChain, validateScanTarget } from "../server/security.js";

test("validateScanTarget rejects credentials, private IPv4, and private IPv6 literals", async () => {
  await assert.rejects(() => validateScanTarget("https://user:pass@example.com", { checkRedirects: false }), /usernames|passwords|embedded/i);
  await assert.rejects(() => validateScanTarget("http://127.0.0.1:5173", { checkRedirects: false }), /blocked/i);
  await assert.rejects(() => validateScanTarget("http://[::1]/", { checkRedirects: false }), /blocked/i);
  await assert.rejects(() => validateScanTarget("http://[fd00::1]/", { checkRedirects: false }), /blocked/i);
});

test("isBlockedIpAddress blocks internal ranges and allows public unicast", () => {
  assert.equal(isBlockedIpAddress("10.0.0.1"), true);
  assert.equal(isBlockedIpAddress("192.168.1.10"), true);
  assert.equal(isBlockedIpAddress("172.16.0.10"), true);
  assert.equal(isBlockedIpAddress("8.8.8.8"), false);
});

test("validateRedirectChain rejects redirects into blocked networks", async () => {
  const fetchImpl = async () => ({
    status: 302,
    headers: {
      get(name) {
        return name.toLowerCase() === "location" ? "http://127.0.0.1/private" : null;
      },
    },
  });

  await assert.rejects(
    () => validateRedirectChain("http://93.184.216.34/start", { fetchImpl, tolerateNetworkErrors: false }),
    /blocked/i,
  );
});

test("artifact filename guard blocks path traversal", () => {
  assert.equal(assertSafeArtifactName("report.png"), "report.png");
  assert.throws(() => assertSafeArtifactName("../secret.txt"), /Invalid artifact path/);
  assert.throws(() => assertSafeArtifactName("nested/file.png"), /Invalid artifact path/);
});
