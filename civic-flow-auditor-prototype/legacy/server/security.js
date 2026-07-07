import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { validatePublicUrl } from "../shared/audit-utils.js";

const blockedRanges = new Set([
  "unspecified",
  "broadcast",
  "multicast",
  "linkLocal",
  "loopback",
  "private",
  "uniqueLocal",
  "ipv4Mapped",
  "carrierGradeNat",
  "reserved",
  "benchmarking",
  "documentation",
  "as112",
  "amt",
  "ietfProtocolAssignments",
  "orchid2",
]);

export const unsafeHttpMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function cleanHostname(hostname = "") {
  return String(hostname).replace(/^\[/, "").replace(/\]$/, "");
}

export function isBlockedIpAddress(address) {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) {
    parsed = parsed.toIPv4Address();
  }
  return blockedRanges.has(parsed.range());
}

export async function resolvePublicAddresses(hostname) {
  const clean = cleanHostname(hostname);
  if (ipaddr.isValid(clean)) {
    if (isBlockedIpAddress(clean)) {
      throw new Error("Private, localhost, reserved, and internal network URLs are blocked.");
    }
    return [clean];
  }

  const answers = await dns.lookup(clean, { all: true, verbatim: true });
  if (!answers.length) {
    throw new Error("The target host did not resolve to an address.");
  }

  const blocked = answers.find((answer) => isBlockedIpAddress(answer.address));
  if (blocked) {
    throw new Error(`The target host resolves to a blocked network address (${blocked.address}).`);
  }

  return answers.map((answer) => answer.address);
}

export async function validateRedirectChain(url, { fetchImpl = fetch, maxRedirects = 5, timeoutMs = 5000, tolerateNetworkErrors = true } = {}) {
  let current = url;
  for (let index = 0; index <= maxRedirects; index += 1) {
    const validation = validatePublicUrl(current);
    if (!validation.ok) throw new Error(validation.error);
    const parsed = new URL(validation.url);
    await resolvePublicAddresses(parsed.hostname);

    let response;
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      response = await fetchImpl(validation.url, {
        method: "HEAD",
        redirect: "manual",
        signal: timeout,
      });
    } catch (error) {
      if (tolerateNetworkErrors) return { ok: true, url: validation.url, redirectsChecked: index };
      throw error;
    }

    const location = response.headers?.get?.("location");
    if (!location || response.status < 300 || response.status >= 400) {
      return { ok: true, url: validation.url, redirectsChecked: index };
    }

    current = new URL(location, validation.url).href;
  }

  throw new Error("Too many redirects while validating the audit target.");
}

export async function validateScanTarget(url, options = {}) {
  const validation = validatePublicUrl(url);
  if (!validation.ok) throw new Error(validation.error);
  const parsed = new URL(validation.url);
  await resolvePublicAddresses(parsed.hostname);

  if (options.checkRedirects !== false) {
    await validateRedirectChain(validation.url, options);
  }

  return validation.url;
}

export function createSkippedAction({ url = "", action, reason, method, stage }) {
  return {
    url,
    action,
    reason,
    method,
    stage,
    createdAt: new Date().toISOString(),
  };
}
