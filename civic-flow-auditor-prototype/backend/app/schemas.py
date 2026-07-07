from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator

ScanDepth = Literal["quick", "standard", "form"]
AuditStatus = Literal["idle", "queued", "validating", "scanning", "report-ready", "failed", "cancelled"]
StepStatus = Literal["queued", "running", "complete", "failed", "cancelled"]
Severity = Literal["Critical", "High", "Medium", "Low"]
OcrStatus = Literal["not-needed", "not-run", "complete", "unavailable", "failed"]
AiProvider = Literal["none", "openrouter"]
AiStatus = Literal["deterministic", "pending", "enhanced", "unavailable", "failed"]

SAFETY_NOTES = [
    "This is an accessibility assistance report, not legal certification.",
    "Automated testing cannot detect all accessibility issues.",
    "Human review with disabled users or accessibility professionals is recommended.",
    "The agent will not submit forms automatically.",
    "Auto-filled or suggested values are drafts and must be reviewed by the user.",
]

SCAN_DEPTHS = {
    "quick": {"name": "Quick", "detail": "Up to 3 pages", "maxPages": 3},
    "standard": {"name": "Standard", "detail": "Up to 10 pages", "maxPages": 10},
    "form": {"name": "Form journey", "detail": "Follow forms end-to-end", "maxPages": 10},
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_depth(depth: str | None) -> ScanDepth:
    return depth if depth in SCAN_DEPTHS else "standard"


class LinkSnapshot(BaseModel):
    href: str
    text: str = ""


class PdfSnapshot(BaseModel):
    url: str
    text: str = ""


class FormSnapshot(BaseModel):
    name: str = ""
    action: str = ""
    method: str = "get"
    labels: list[str] = Field(default_factory=list)
    buttons: list[str] = Field(default_factory=list)


class PageSnapshot(BaseModel):
    url: str
    title: str = ""
    heading: str = ""
    textSample: str = ""
    links: list[LinkSnapshot] = Field(default_factory=list)
    pdfs: list[PdfSnapshot] = Field(default_factory=list)
    forms: list[FormSnapshot] = Field(default_factory=list)
    session: str = "general"
    sessionLabel: str = "General info"
    screenshotPath: str | None = None
    screenshotUrl: str | None = None
    scanned: bool = False
    error: str | None = None


class DocumentSnapshot(BaseModel):
    url: str
    title: str = "Document"
    extractedText: str = ""
    textLength: int = 0
    imageOnly: bool = False
    summary: str = ""
    ocrText: str = ""
    ocrStatus: OcrStatus = "not-run"
    ocrPages: int = 0
    matchedStage: str = "pdf"
    matchedStageReason: str | None = None
    sourcePageUrl: str | None = None
    error: str | None = None


class Stage(BaseModel):
    id: str
    name: str
    pages: int = 0
    documents: int = 0
    critical: int = 0
    serious: int = 0
    minor: int = 0


class GuidelineRef(BaseModel):
    label: str
    url: HttpUrl


class IssueBox(BaseModel):
    x: float
    y: float
    width: float
    height: float
    label: str


class Finding(BaseModel):
    id: str
    stage: str
    stageLabel: str
    title: str
    impact: str
    guideline: str
    severity: Severity
    status: str = "To do"
    fix: str
    ticket: str
    url: str | None = None
    selector: str | None = None
    rule: str | None = None
    guidelineRefs: list[GuidelineRef] = Field(default_factory=list)
    humanReviewNote: str | None = None
    matchedStageReason: str | None = None
    occurrenceCount: int = 1
    relatedSelectors: list[str] = Field(default_factory=list)
    evidenceScore: int = Field(default=0, ge=0, le=100)
    sourceSnippet: str | None = None
    screenshotPath: str | None = None
    screenshotUrl: str | None = None
    issueBoxes: list[IssueBox] = Field(default_factory=list)


class AgentStep(BaseModel):
    name: str
    detail: str
    status: StepStatus = "queued"


class SkippedAction(BaseModel):
    url: str = ""
    action: str
    reason: str
    method: str | None = None
    stage: str | None = None
    createdAt: str | None = None


class AiMetadata(BaseModel):
    provider: AiProvider = "none"
    model: str = "deterministic"
    status: AiStatus = "deterministic"
    generatedFields: list[str] = Field(default_factory=list)
    error: str | None = None
    enhancedAt: str | None = None


class LighthouseMetadata(BaseModel):
    status: Literal["not-run", "complete", "unavailable", "failed"] = "not-run"
    accessibilityScore: int | None = None
    error: str | None = None


class OcrMetadata(BaseModel):
    status: Literal["not-run", "complete", "unavailable", "failed"] = "not-run"
    pagesLimit: int = 2
    documentsAttempted: int = 0


class TimingMetadata(BaseModel):
    startedAt: str | None = None
    finishedAt: str | None = None
    durationMs: int | None = None
    targetMs: int = 180000
    withinTarget: bool | None = None


class ScannerMetadata(BaseModel):
    lighthouse: LighthouseMetadata = Field(default_factory=LighthouseMetadata)
    ocr: OcrMetadata = Field(default_factory=OcrMetadata)
    timing: TimingMetadata = Field(default_factory=TimingMetadata)


class Artifacts(BaseModel):
    htmlReportPath: str | None = None
    htmlReportUrl: str | None = None
    pdfReportPath: str | None = None
    pdfReportUrl: str | None = None
    ticketReportPath: str | None = None
    ticketReportUrl: str | None = None
    screenshots: list[str] = Field(default_factory=list)


class AuditRun(BaseModel):
    id: str
    url: str
    depth: ScanDepth = "standard"
    status: AuditStatus = "idle"
    progress: int = Field(default=0, ge=0, le=100)
    executiveSummary: str = ""
    pages: list[PageSnapshot] = Field(default_factory=list)
    documents: list[DocumentSnapshot] = Field(default_factory=list)
    stages: list[Stage] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    agentSteps: list[AgentStep] = Field(default_factory=list)
    ai: AiMetadata = Field(default_factory=AiMetadata)
    scanner: ScannerMetadata = Field(default_factory=ScannerMetadata)
    skippedActions: list[SkippedAction] = Field(default_factory=list)
    artifacts: Artifacts = Field(default_factory=Artifacts)
    safetyNotes: list[str] = Field(default_factory=lambda: list(SAFETY_NOTES))
    error: str | None = None
    createdAt: str
    updatedAt: str

    @field_validator("depth", mode="before")
    @classmethod
    def validate_depth(cls, value: Any) -> str:
        return normalize_depth(value)


class CreateAuditRequest(BaseModel):
    url: str
    depth: str | None = "standard"
    login_email: str | None = None
    login_password: str | None = None


class SaveDocumentAuditRequest(BaseModel):
    auditRun: dict[str, Any]


class ScanImageRequest(BaseModel):
    image: str
    filename: str | None = None


class RefineImageRequest(BaseModel):
    image: str
    region: dict[str, Any]
    filename: str | None = None
    findingId: str | None = None
    croppedImageUrl: str | None = None


def create_audit_run_base(audit_id: str, url: str, depth: str | None = "standard") -> AuditRun:
    timestamp = now_iso()
    return AuditRun(
        id=audit_id,
        url=url,
        depth=normalize_depth(depth),
        status="idle",
        progress=0,
        createdAt=timestamp,
        updatedAt=timestamp,
    )


def create_timing_metadata(started_at: str, finished_at: str, target_ms: int = 180000) -> TimingMetadata:
    try:
        started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        finished = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
        duration = int((finished - started).total_seconds() * 1000)
    except ValueError:
        duration = None
    return TimingMetadata(startedAt=started_at, finishedAt=finished_at, durationMs=duration, targetMs=target_ms, withinTarget=None if duration is None else duration <= target_ms)


def build_deterministic_summary(run: AuditRun) -> str:
    critical = len([finding for finding in run.findings if finding.severity == "Critical"])
    high = len([finding for finding in run.findings if finding.severity == "High"])
    image_only = len([document for document in run.documents if document.imageOnly])
    return " ".join(
        [
            f"This audit assistance run reviewed {len(run.pages)} pages and {len(run.documents)} linked or scanned documents for {run.url}.",
            f"{len(run.findings)} findings were identified, including {critical} Critical and {high} High severity issues.",
            f"{image_only} documents may need manual accessibility review because they appear image-only or scan-derived.",
            "This is not legal certification; human accessibility review is still required.",
        ]
    )