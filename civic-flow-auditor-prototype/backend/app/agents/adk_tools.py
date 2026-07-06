from __future__ import annotations

from typing import Any, Callable

from ..tools.accessibility import scan_accessibility
from ..tools.crawl import crawl_site
from ..tools.documents import parse_document, scan_document_image
from ..tools.reporting import generate_report

try:
    from google.adk.tools import FunctionTool
except Exception:  # pragma: no cover - allows local setup before google-adk is installed
    FunctionTool = None


def _tool(fn: Callable[..., Any]) -> Any:
    return FunctionTool(fn) if FunctionTool else fn


crawl_site_tool = _tool(crawl_site)
scan_accessibility_tool = _tool(scan_accessibility)
parse_document_tool = _tool(parse_document)
scan_document_image_tool = _tool(scan_document_image)
generate_report_tool = _tool(generate_report)

ADK_TOOLS = [
    crawl_site_tool,
    scan_accessibility_tool,
    parse_document_tool,
    scan_document_image_tool,
    generate_report_tool,
]