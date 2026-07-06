from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

UNSAFE_HTTP_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@dataclass(frozen=True)
class UrlValidation:
    ok: bool
    url: str = ""
    error: str = ""


def _is_blocked_address(address: str) -> bool:
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return False
    return parsed.is_private or parsed.is_loopback or parsed.is_link_local or parsed.is_multicast or parsed.is_reserved or parsed.is_unspecified


def validate_public_url(url: str) -> UrlValidation:
    candidate = (url or "").strip()
    if not candidate:
        return UrlValidation(False, error="URL is required.")
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"}:
        return UrlValidation(False, error="Only public HTTP and HTTPS URLs can be audited.")
    if not parsed.hostname:
        return UrlValidation(False, error="The audit target must include a hostname.")
    if parsed.username or parsed.password:
        return UrlValidation(False, error="URLs with embedded credentials are blocked.")
    return UrlValidation(True, url=candidate)


def resolve_public_addresses(hostname: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(hostname.strip("[]"), None)
    except socket.gaierror as exc:
        raise ValueError("The target host did not resolve to an address.") from exc
    addresses = sorted({info[4][0] for info in infos})
    if not addresses:
        raise ValueError("The target host did not resolve to an address.")
    blocked = [address for address in addresses if _is_blocked_address(address)]
    if blocked:
        raise ValueError(f"The target host resolves to a blocked network address ({blocked[0]}).")
    return addresses


def validate_scan_target(url: str) -> str:
    validation = validate_public_url(url)
    if not validation.ok:
        raise ValueError(validation.error)
    parsed = urlparse(validation.url)
    resolve_public_addresses(parsed.hostname or "")
    return validation.url


def is_same_domain(base_url: str, href: str) -> bool:
    base = urlparse(base_url)
    target = urlparse(urljoin(base_url, href))
    return base.hostname == target.hostname and target.scheme in {"http", "https"}


def create_skipped_action(action: str, reason: str, url: str = "", method: str | None = None, stage: str | None = None) -> dict[str, str]:
    from .schemas import now_iso

    result = {"url": url, "action": action, "reason": reason, "createdAt": now_iso()}
    if method:
        result["method"] = method
    if stage:
        result["stage"] = stage
    return result