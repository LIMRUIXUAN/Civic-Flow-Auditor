from __future__ import annotations

from uuid import uuid4

from ..schemas import DocumentSnapshot, Finding


def parse_document(pdf_url: str, source_page_url: str | None = None) -> dict:
    return DocumentSnapshot(
        url=pdf_url,
        title="Linked document",
        extractedText="",
        textLength=0,
        imageOnly=True,
        summary="Linked PDF requires manual accessibility review in this backend foundation build.",
        ocrStatus="not-run",
        matchedStage="pdf",
        matchedStageReason="PDF was discovered during crawl.",
        sourcePageUrl=source_page_url,
    ).model_dump(mode="json")


def scan_document_image(image_base64: str) -> dict:
    return {
        "regions": [
            {
                "label": "1",
                "type": "Body Text",
                "text": "OCR/vision provider is not configured in this deterministic backend path.",
                "x": 5,
                "y": 5,
                "width": 90,
                "height": 90,
                "accessibility_notes": "Provide a tagged digital version and verify reading order, labels, and contrast.",
            }
        ],
        "full_text": "",
        "suggestions": ["Verify the uploaded document has an accessible digital alternative."],
        "method": "deterministic",
        "aiReasoning": None,
    }


def build_document_findings(regions: list[dict], filename: str, cropped_image_path: str, cropped_image_url: str) -> tuple[list[dict], list[dict]]:
    findings: list[dict] = []
    enriched_regions: list[dict] = []
    for index, region in enumerate(regions or [], start=1):
        finding_id = f"doc-{uuid4().hex[:8]}"
        finding = Finding(
            id=finding_id,
            stage="document-scan",
            stageLabel="Document Scan",
            title=f"Document region {region.get('label', index)} needs accessibility review",
            impact=region.get("accessibility_notes") or "Residents may not be able to use this scanned document with assistive technology.",
            guideline="WCAG 1.3.1 Info and Relationships",
            severity="High",
            fix="Provide an accessible HTML or tagged PDF version with semantic labels and correct reading order.",
            ticket=f"Review {filename} region {region.get('label', index)} and create an accessible digital equivalent.",
            url=cropped_image_url,
            screenshotPath=cropped_image_path,
            screenshotUrl=cropped_image_url,
            issueBoxes=[{"x": region.get("x", 5), "y": region.get("y", 5), "width": region.get("width", 90), "height": region.get("height", 90), "label": str(region.get("label", index))}],
            evidenceScore=70,
            humanReviewNote="Scanned document analysis is assistance only and requires human review.",
        )
        findings.append(finding.model_dump(mode="json"))
        enriched_regions.append({**region, "findingId": finding_id})
    return findings, enriched_regions