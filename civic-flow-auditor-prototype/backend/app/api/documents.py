from __future__ import annotations

import base64
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from ..artifacts import artifact_url, write_bytes_artifact
from ..schemas import RefineImageRequest, ScanImageRequest, create_timing_metadata, now_iso
from ..tools.documents import build_document_findings, scan_document_image

router = APIRouter()


def _scan_title(filename: str | None) -> str:
    cleaned = (filename or "").replace("\\", "/").split("/")[-1].strip()[:120]
    return cleaned or "Scanned document"


@router.post("/api/scan-image")
def scan_image(payload: ScanImageRequest) -> dict[str, Any]:
    started = now_iso()
    try:
        raw = base64.b64decode(payload.image.split(",")[-1], validate=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail={"error": "Image data (base64) is required."}) from exc

    audit_id = "doc-scan"
    filename = f"crop-{uuid4().hex[:8]}.png"
    path, url = write_bytes_artifact(audit_id, filename, raw)
    result = scan_document_image(payload.image)
    title = _scan_title(payload.filename)
    findings, regions = build_document_findings(result.get("regions", []), title, str(path), url)
    finished = now_iso()
    document = {
        "url": url,
        "title": title,
        "extractedText": result.get("full_text", ""),
        "textLength": len(result.get("full_text", "")),
        "imageOnly": True,
        "summary": (result.get("suggestions") or ["Scanned document form layout."])[0],
        "ocrText": result.get("full_text", ""),
        "ocrStatus": "complete",
        "ocrPages": 1,
        "matchedStage": "document-scan",
        "matchedStageReason": "Uploaded image was analyzed in Document Scan mode.",
    }
    return {
        "croppedImageUrl": url,
        "croppedImagePath": str(path),
        "croppedBase64": payload.image,
        "document": document,
        "findings": findings,
        "regions": regions,
        "fullText": result.get("full_text", ""),
        "suggestions": result.get("suggestions", []),
        "method": result.get("method", "deterministic"),
        "aiReasoning": result.get("aiReasoning"),
        "timing": create_timing_metadata(started, finished).model_dump(mode="json"),
    }


@router.post("/api/scan-image/refine")
def refine_image(payload: RefineImageRequest) -> dict[str, Any]:
    region = payload.region or {}
    finding_id = payload.findingId or f"doc-{uuid4().hex[:8]}"
    text = region.get("text") or "Detailed refinement requires the vision provider to be configured."
    return {
        "label": region.get("label", "1"),
        "findingId": finding_id,
        "type": region.get("type", "Document Region"),
        "text": text,
        "accessibility_notes": region.get("accessibility_notes", "Verify contrast, labels, reading order, and availability of a digital alternative."),
        "fix": "Verify this region manually and provide an accessible digital version with semantic labels.",
        "findingPatch": {
            "id": finding_id,
            "fix": "Verify this region manually and provide an accessible digital version with semantic labels.",
            "humanReviewNote": "Region refinement is source-bound but still requires human accessibility review.",
        },
        "method": "deterministic",
        "aiReasoning": None,
    }