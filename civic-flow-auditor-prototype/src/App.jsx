import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  GitBranch,
  Globe2,
  Headphones,
  Landmark,
  ListChecks,
  Play,
  Route,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Volume2,
  Workflow,
} from "lucide-react";
import { scanDepths } from "../shared/audit-contract.js";
import { createDemoAuditRun, toolDefinitions } from "../shared/demo-data.js";
import { buildStagesFromPagesAndFindings, guidelineRefsFor, humanReviewNoteFor } from "../shared/audit-utils.js";

const demoAuditRun = createDemoAuditRun();
const demoQueryEnabled = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1";

function createEmptyAuditRun(overrides = {}) {
  return createDemoAuditRun({
    id: overrides.id || "empty-audit",
    url: overrides.url || "https://example.com/",
    depth: overrides.depth || "standard",
    status: overrides.status || "idle",
    progress: overrides.progress ?? 0,
    pages: overrides.pages || [],
    documents: overrides.documents || [],
    stages: overrides.stages || [],
    findings: overrides.findings || [],
    agentSteps: overrides.agentSteps || [],
  });
}

const iconMap = {
  Camera,
  CheckCircle2,
  FileSearch,
  FileText,
  Globe2,
  Route,
};

function SeverityMark({ type, value }) {
  return (
    <span className={`severity-mark ${type}`} aria-label={`${value} ${type} findings`}>
      <span>{value}</span>
    </span>
  );
}

function AppLogo() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <Landmark size={24} strokeWidth={2.2} />
    </div>
  );
}

function ToolNode({ tool, isLast }) {
  const Icon = iconMap[tool.icon] || Workflow;
  return (
    <>
      <div className="tool-node">
        <span className="tool-icon">
          <Icon size={22} />
        </span>
        <strong>
          {tool.name.split("_").map((part, index, parts) => (
            <span className="tool-name-part" key={`${tool.name}-${part}-${index}`}>
              {part}
              {index < parts.length - 1 ? "_" : null}
              {index < parts.length - 1 ? <wbr /> : null}
            </span>
          ))}
        </strong>
        <small>{tool.agent}</small>
        <em>{tool.output}</em>
      </div>
      {!isLast ? <ArrowRight className="tool-arrow" size={20} strokeWidth={1.8} aria-hidden="true" /> : null}
    </>
  );
}

function BackendFlowPanel({ setNotice }) {
  return (
    <section className="backend-flow-section" aria-label="Backend audit system">
      <div className="tools-panel footer-tools-panel">
        <div className="panel-title-row">
          <div>
            <span className="eyebrow">Backend flow</span>
            <h2>Tools behind this audit</h2>
          </div>
          <button className="text-button" type="button" onClick={() => setNotice("These tools are exposed through the local API and the custom MCP server.")}>
            What do these tools do?
            <ExternalLink size={15} />
          </button>
        </div>
        <div className="tool-flow" aria-label="Backend tool flow">
          {toolDefinitions.map((tool, index) => (
            <ToolNode key={tool.name} tool={tool} isLast={index === toolDefinitions.length - 1} />
          ))}
        </div>
        <p className="panel-copy">
          We discover pages, map the journey, run accessibility checks with axe-core, parse documents,
          capture annotated screenshots, and generate a plain-language report.
        </p>
      </div>
    </section>
  );
}

function AuditHistoryPanel({ history, loadHistoryAudit, refreshHistory, compact = false }) {
  return (
    <section className={`history-section${compact ? " intake-history-section" : ""}`} aria-label="Audit history">
      <div className="history-panel standalone-history-panel">
        <div className="history-head">
          <div>
            <span className="eyebrow">History</span>
            <h2>Audit history</h2>
            <p className="panel-copy">Saved local audits and scan states.</p>
          </div>
          <button className="text-button" type="button" onClick={refreshHistory}>
            <Workflow size={15} />
            Refresh
          </button>
        </div>
        <div className="history-list">
          {history.length ? (
            history.slice(0, 5).map((item) => (
              <button className="history-item" type="button" key={item.id} onClick={() => loadHistoryAudit(item.id)}>
                <span>
                  <strong>{item.url}</strong>
                  <small>{new Date(item.updatedAt).toLocaleString()} | {item.status} | {item.findings} findings</small>
                </span>
                <span className={`mode-badge ${item.ai?.status === "enhanced" ? "ai" : "deterministic"}`}>{item.ai?.status === "enhanced" ? "AI" : "DET"}</span>
              </button>
            ))
          ) : (
            <div className="empty-state compact">No saved live audits yet.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function EvidenceImage({ issue }) {
  const [imageSize, setImageSize] = useState(null);
  const focusBox = issue?.issueBoxes?.[0];
  const focusStyle =
    focusBox && imageSize?.width && imageSize?.height
      ? {
          objectPosition: `${Math.max(0, Math.min(100, ((focusBox.x + focusBox.width / 2) / imageSize.width) * 100))}% ${Math.max(
            0,
            Math.min(100, ((focusBox.y + focusBox.height / 2) / imageSize.height) * 100),
          )}%`,
        }
      : { objectPosition: "50% 28%" };

  return (
    <div className="mock-browser evidence-image-frame">
      <img
        className="focused-evidence-image"
        src={issue.screenshotUrl}
        alt={`Annotated evidence for ${issue.id}`}
        style={focusStyle}
        onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      />
    </div>
  );
}

function MockEvidencePreview() {
  return (
    <div className="mock-browser" aria-label="Annotated screenshot preview">
      <div className="mock-header">
        <span>Example City</span>
        <nav>Services Departments News Contact</nav>
      </div>
      <div className="mock-flow">
        <span className="active-step">1 Register</span>
        <span>2 Personal info</span>
        <span>3 Verification</span>
      </div>
      <h3>Create your account</h3>
      <label>Email address</label>
      <div className="mock-input highlighted">
        <span>you@example.com</span>
        <b>1</b>
      </div>
      <p className="mock-error">Please enter your email address.</p>
      <label>Create password</label>
      <div className="mock-input">
        <span>At least 8 characters</span>
        <b className="second">2</b>
      </div>
      <button className="mock-next" type="button">Next</button>
    </div>
  );
}

function statusLabel(status) {
  if (status === "queued") return "Queued";
  if (status === "validating") return "Validating URL";
  if (status === "scanning") return "Scanning in progress";
  if (status === "report-ready") return "Report ready";
  if (status === "failed") return "Audit failed";
  if (status === "cancelled") return "Audit cancelled";
  return "Ready to scan";
}

function App() {
  const [scanDepth, setScanDepth] = useState("standard");
  const [url, setUrl] = useState(demoQueryEnabled ? demoAuditRun.url : "https://example.com/");
  const [auditRun, setAuditRun] = useState(demoQueryEnabled ? demoAuditRun : createEmptyAuditRun());
  const [selectedStage, setSelectedStage] = useState(demoQueryEnabled ? "register" : "all");
  const [selectedIssueId, setSelectedIssueId] = useState(demoQueryEnabled ? "AXE-001" : "");
  const [notice, setNotice] = useState("");
  const [backendMode, setBackendMode] = useState(demoQueryEnabled ? "demo" : "empty");
  const [backendStatus, setBackendStatus] = useState("checking");
  const [history, setHistory] = useState([]);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const eventSourceRef = useRef(null);

  // Document Scan tab state
  const [activeTab, setActiveTab] = useState("website"); // "website" or "document"
  const [scanQueue, setScanQueue] = useState([]);
  const [scannedImages, setScannedImages] = useState([]);
  const [selectedScanImageId, setSelectedScanImageId] = useState(null);
  const [isScanningImage, setIsScanningImage] = useState(false);
  const [refiningRegionId, setRefiningRegionId] = useState(null);
  const documentScanRef = useRef({ documents: [], findings: [] });

  const isRunning = auditRun.status === "queued" || auditRun.status === "validating" || auditRun.status === "scanning";
  const stages = auditRun.stages;
  const findings = auditRun.findings;
  const agentSteps = auditRun.agentSteps;
  const pagesScanned = auditRun.pages.filter((page) => page.scanned).length || auditRun.pages.length;
  const isDemoAudit = backendMode === "demo";
  const aiEnhanced = auditRun.ai?.status === "enhanced";
  const aiPending = auditRun.ai?.status === "pending";
  const deterministicMode = !aiEnhanced && !aiPending;

  const visibleIssues = useMemo(() => {
    if (selectedStage === "all") return findings;
    const stageIssues = findings.filter((issue) => issue.stage === selectedStage);
    return stageIssues.length ? stageIssues : findings;
  }, [findings, selectedStage]);

  const selectedIssue = findings.find((issue) => issue.id === selectedIssueId) || visibleIssues[0] || null;
  const selectedGuidelineRefs = selectedIssue ? (selectedIssue.guidelineRefs?.length ? selectedIssue.guidelineRefs : guidelineRefsFor(selectedIssue.guideline)) : [];
  const selectedHumanReviewNote = selectedIssue ? selectedIssue.humanReviewNote || humanReviewNoteFor(selectedIssue.guideline) : "";
  const selectedIssueIndex = visibleIssues.findIndex((issue) => issue.id === selectedIssue?.id);
  const canNavigateIssues = visibleIssues.length > 1 && selectedIssueIndex >= 0;

  async function persistDocumentAuditRun(nextRun) {
    const response = await fetch("/api/audits/document-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auditRun: nextRun }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Document report could not be saved.");
    setAuditRun(payload);
    setBackendMode("live");
    await refreshHistory();
    return payload;
  }

  function mergeDocumentScanOutput(run) {
    const { documents, findings } = documentScanRef.current;
    if (!documents.length && !findings.length) return run;
    const seenDocuments = new Set((run.documents || []).map((document) => document.url));
    const seenFindings = new Set((run.findings || []).map((finding) => finding.id));
    const mergedDocuments = [...(run.documents || []), ...documents.filter((document) => !seenDocuments.has(document.url))];
    const mergedFindings = [...(run.findings || []), ...findings.filter((finding) => !seenFindings.has(finding.id))];
    return {
      ...run,
      documents: mergedDocuments,
      findings: mergedFindings,
      stages: buildStagesFromPagesAndFindings(run.pages || [], mergedDocuments, mergedFindings),
    };
  }

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // Queue logic and image processing
  async function handleImageDrop(files) {
    if (!files || !files.length) return;
    setNotice("Adding image(s) to scan queue...");

    const newItems = [];
    for (const file of files) {
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
      });
      newItems.push({
        id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        name: file.name,
        originalBase64: base64,
        croppedBase64: "",
        croppedImageUrl: "",
        status: "queued",
        regions: [],
        fullText: "",
        suggestions: [],
        error: ""
      });
    }

    setScannedImages((prev) => {
      const updated = [...prev, ...newItems];
      if (!selectedScanImageId && updated.length) {
        setSelectedScanImageId(newItems[0].id);
      }
      return updated;
    });

    setScanQueue((prev) => [...prev, ...newItems]);
  }

  useEffect(() => {
    if (scanQueue.length === 0 || isScanningImage) return;

    async function processNextScan() {
      setIsScanningImage(true);
      const active = scanQueue[0];
      
      setScannedImages((prev) =>
        prev.map((item) => (item.id === active.id ? { ...item, status: "processing" } : item))
      );

      try {
        const response = await fetch("/api/scan-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: active.originalBase64, filename: active.name }),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Failed to scan image.");
        }

        const data = await response.json();
        const newFindings = data.findings || [];
        const nextDocumentFromServer = data.document || {
          url: data.croppedImageUrl,
          title: active.name,
          extractedText: data.fullText,
          textLength: data.fullText?.length || 0,
          imageOnly: true,
          summary: data.suggestions?.[0] || "Scanned document form layout.",
          ocrStatus: "complete",
          ocrPages: 1,
          matchedStage: "document-scan",
          matchedStageReason: "Uploaded image was analyzed in Document Scan mode."
        };

        setScannedImages((prev) =>
          prev.map((item) =>
            item.id === active.id
              ? {
                  ...item,
                  status: "done",
                  croppedBase64: data.croppedBase64,
                  croppedImageUrl: data.croppedImageUrl,
                  regions: data.regions,
                  fullText: data.fullText,
                  suggestions: data.suggestions
                }
              : item
          )
        );

        const runToPersist = await new Promise((resolve) => {
          setAuditRun((prev) => {
            const nextFindings = [...prev.findings, ...newFindings];
            const nextDocuments = [...prev.documents, nextDocumentFromServer];
            const nextStages = buildStagesFromPagesAndFindings(prev.pages, nextDocuments, nextFindings);
            const nextRun = {
              ...prev,
              status: prev.status === "idle" ? "report-ready" : prev.status,
              progress: prev.status === "idle" ? 100 : prev.progress,
              documents: nextDocuments,
              findings: nextFindings,
              stages: nextStages,
              scanner: {
                ...(prev.scanner || {}),
                timing: data.timing || prev.scanner?.timing || { targetMs: 180000 }
              }
            };
            resolve(nextRun);
            return nextRun;
          });
        });

        documentScanRef.current = {
          documents: [...documentScanRef.current.documents, runToPersist.documents.at(-1)],
          findings: [...documentScanRef.current.findings, ...newFindings],
        };
        const savedRun = await persistDocumentAuditRun(runToPersist);
        setNotice(`Successfully scanned ${active.name}; unified report ${savedRun.artifacts?.pdfReportUrl ? "and PDF are" : "is"} ready.`);
      } catch (error) {
        console.error("Scanning queue error:", error);
        setScannedImages((prev) =>
          prev.map((item) => (item.id === active.id ? { ...item, status: "failed", error: error.message } : item))
        );
        setNotice(`Failed to scan ${active.name}: ${error.message}`);
      } finally {
        setScanQueue((prev) => prev.slice(1));
        setIsScanningImage(false);
      }
    }

    processNextScan();
  }, [scanQueue, isScanningImage]);

  async function refineRegionInUI(image, region) {
    if (refiningRegionId) return;
    setRefiningRegionId(region.label);
    setNotice(`Refining region ${region.label}...`);

    try {
      const response = await fetch("/api/scan-image/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: image.croppedBase64 || image.originalBase64, region }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to refine region.");
      }

      const refined = await response.json();

      setScannedImages((prev) =>
        prev.map((item) => {
          if (item.id !== image.id) return item;
          return {
            ...item,
            regions: item.regions.map((r) =>
              r.label === region.label
                ? {
                    ...r,
                    text: refined.text,
                    accessibility_notes: refined.accessibility_notes
                  }
                : r
            )
          };
        })
      );

      setAuditRun((prev) => {
        const findingId = `DOC-${image.id.split("-")[2].slice(0, 4)}-${region.label}`;
        const nextFindings = prev.findings.map((finding) => {
          if (finding.id !== findingId) return finding;
          return {
            ...finding,
            title: `${refined.type} layout concern (Refined)`,
            impact: refined.accessibility_notes,
            fix: `Refined Fix: ${refined.fix}. Extracted text: "${refined.text}"`,
            ticket: `Title: Fix refined layout issue in ${refined.type}\nDescription: ${refined.accessibility_notes}\nWCAG: WCAG 2.1 1.1.1\nComponent: Document Scan`
          };
        });
        return {
          ...prev,
          findings: nextFindings
        };
      });

      setNotice(`Region ${region.label} refined successfully.`);
    } catch (error) {
      console.error("Refine region error:", error);
      setNotice(`Failed to refine: ${error.message}`);
    } finally {
      setRefiningRegionId(null);
    }
  }

  useEffect(() => {
    let active = true;
    async function loadBackendState() {
      try {
        const health = await fetch("/api/health");
        if (!health.ok) throw new Error("Backend health check failed.");
        const audits = await fetch("/api/audits");
        if (!audits.ok) throw new Error("Audit history could not be loaded.");
        const rows = await audits.json();
        if (!active) return;
        setBackendStatus("online");
        setHistory(rows);
      } catch {
        if (!active) return;
        setBackendStatus("offline");
        if (!demoQueryEnabled) {
          setBackendMode("offline");
          setNotice("Backend is offline. Start the API server or load the demo audit explicitly.");
        }
      }
    }
    loadBackendState();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setReviewConfirmed(false);
  }, [auditRun.id]);

  useEffect(() => {
    if (!stages.length && selectedStage !== "all") {
      setSelectedStage("all");
    }
    if (stages.length && selectedStage !== "all" && !stages.some((stage) => stage.id === selectedStage)) {
      setSelectedStage(stages[0].id);
    }
    if (findings.length && !findings.some((issue) => issue.id === selectedIssueId)) {
      setSelectedIssueId(findings[0].id);
    }
    if (!findings.length && selectedIssueId) {
      setSelectedIssueId("");
    }
  }, [findings, selectedIssueId, selectedStage, stages]);

  async function refreshHistory() {
    try {
      const response = await fetch("/api/audits");
      if (!response.ok) throw new Error("History unavailable.");
      setHistory(await response.json());
      setBackendStatus("online");
    } catch {
      setBackendStatus("offline");
    }
  }

  function subscribeToAudit(auditId) {
    eventSourceRef.current?.close();
    const source = new EventSource(`/api/audits/${auditId}/events`);
    eventSourceRef.current = source;

    source.addEventListener("audit", (event) => {
      const nextRun = mergeDocumentScanOutput(JSON.parse(event.data));
      setAuditRun(nextRun);
      setBackendMode("live");
      if (nextRun.status === "report-ready") {
        source.close();
        if (documentScanRef.current.findings.length) {
          persistDocumentAuditRun(nextRun)
            .then(() => setNotice("Unified website and document report is ready for review and export."))
            .catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
        } else {
          setNotice("Audit report is ready for review and export.");
        }
      }
      if (nextRun.status === "failed") {
        setBackendMode("failed");
        setNotice(nextRun.error || "Audit failed. Load the demo audit only if you want sample data.");
        source.close();
      }
      if (nextRun.status === "cancelled") {
        setNotice(nextRun.error || "Audit cancelled.");
        source.close();
      }
    });

    source.addEventListener("error", () => {
      if (auditRun.status !== "report-ready") {
        setNotice("Live audit updates disconnected. Use Refresh through the browser after a moment.");
      }
      source.close();
    });
  }

  async function startAudit() {
    setNotice("Starting public-site audit. Forms will not be submitted.");
    setBackendMode("live");
    setAuditRun({
      ...createEmptyAuditRun({ url, depth: scanDepth }),
      id: "pending",
      url,
      depth: scanDepth,
      status: "validating",
      progress: 5,
    });

    try {
      const response = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, depth: scanDepth }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not start the audit.");
      setAuditRun(payload);
      subscribeToAudit(payload.id);
      await refreshHistory();
    } catch (error) {
      const failedRun = {
        ...createEmptyAuditRun({ url, depth: scanDepth, status: "failed", progress: 0 }),
        id: "failed-start",
        error: error instanceof Error ? error.message : String(error),
      };
      setBackendMode(String(failedRun.error || "").toLowerCase().includes("fetch") ? "offline" : "failed");
      setBackendStatus(String(failedRun.error || "").toLowerCase().includes("fetch") ? "offline" : backendStatus);
      setAuditRun(failedRun);
      setNotice(`${failedRun.error} No demo fallback was loaded.`);
    }
  }

  function resetAudit() {
    eventSourceRef.current?.close();
    setBackendMode(backendStatus === "offline" ? "offline" : "empty");
    setAuditRun(createEmptyAuditRun({ url, depth: scanDepth, status: "idle", progress: 0 }));
    setNotice("Ready for a new public URL.");
  }

  function loadDemoAudit() {
    eventSourceRef.current?.close();
    const demo = createDemoAuditRun({ url: demoAuditRun.url, depth: scanDepth, status: "report-ready", progress: 100 });
    setBackendMode("demo");
    setAuditRun(demo);
    setUrl(demo.url);
    setSelectedStage("register");
    setSelectedIssueId("AXE-001");
    setNotice("Demo audit loaded explicitly.");
  }

  async function cancelCurrentAudit() {
    if (!auditRun.id || auditRun.id === "pending") return;
    try {
      const response = await fetch(`/api/audits/${auditRun.id}/cancel`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not cancel audit.");
      setAuditRun(payload.run);
      setNotice(payload.cancelled ? "Audit cancellation requested." : "Audit was not running.");
      await refreshHistory();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function enhanceCurrentAudit() {
    if (!auditRun.id || auditRun.id === "pending" || backendMode === "demo") {
      setNotice("AI enhancement is available for saved live audits.");
      return;
    }
    setNotice("Requesting backend AI writing enhancement.");
    setAuditRun({ ...auditRun, ai: { ...(auditRun.ai || {}), status: "pending" } });
    try {
      const response = await fetch(`/api/audits/${auditRun.id}/enhance`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI enhancement failed.");
      setAuditRun(payload);
      setBackendMode("live");
      setNotice(payload.ai?.status === "enhanced" ? "AI-enhanced wording is ready." : "Deterministic report kept; AI is unavailable.");
      await refreshHistory();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadHistoryAudit(auditId) {
    eventSourceRef.current?.close();
    try {
      const response = await fetch(`/api/audits/${auditId}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Audit not found.");
      setAuditRun(payload);
      setUrl(payload.url);
      setScanDepth(payload.depth);
      setBackendMode(payload.status === "failed" ? "failed" : "live");
      setNotice(`Loaded audit ${payload.id}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function moveIssue(delta) {
    if (!canNavigateIssues) {
      setNotice("Select a finding from the issue queue first.");
      return;
    }
    const nextIndex = Math.min(Math.max(selectedIssueIndex + delta, 0), visibleIssues.length - 1);
    setSelectedIssueId(visibleIssues[nextIndex].id);
  }

  function handleListen() {
    const text = selectedIssue
      ? `${selectedIssue.title}. ${selectedIssue.impact} Recommended fix. ${selectedIssue.fix}`
      : `Civic Flow Auditor found ${findings.length} findings across ${stages.length} journey stages.`;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      setNotice("Listen mode is reading the selected finding.");
      return;
    }
    setNotice("Listen mode needs browser speech synthesis support.");
  }

  async function copyTicket() {
    if (!selectedIssue) {
      setNotice("No developer ticket is selected yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedIssue.ticket);
      setNotice("Developer ticket copied to clipboard.");
    } catch {
      setNotice("Copy was blocked by the browser. The ticket text remains visible.");
    }
  }

  function exportReport(type) {
    const artifactUrl = type === "PDF" ? auditRun.artifacts?.pdfReportUrl : type === "Tickets" ? auditRun.artifacts?.ticketReportUrl : auditRun.artifacts?.htmlReportUrl;
    if (auditRun.status === "report-ready" && !reviewConfirmed) {
      setNotice("Confirm the final review checklist before exporting this assistance report.");
      return;
    }
    if (artifactUrl) {
      window.open(artifactUrl, "_blank", "noopener,noreferrer");
      setNotice(`${type} report opened in a new tab.`);
      return;
    }
    if (type === "PDF" && auditRun.artifacts?.htmlReportUrl) {
      setNotice("PDF export is not available from this run. HTML report is ready.");
      return;
    }
    setNotice(`${type} export is available after a live audit reaches Report ready.`);
  }

  async function purgeArtifacts() {
    if (!auditRun.id || auditRun.id === "empty-audit" || auditRun.id === "pending") {
      setNotice("No saved audit artifacts are available to purge.");
      return;
    }
    try {
      const response = await fetch(`/api/audits/${auditRun.id}/purge-artifacts`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Artifact purge failed.");
      setAuditRun(payload.auditRun);
      setNotice(`Purged ${payload.removed} local artifact${payload.removed === 1 ? "" : "s"} from this audit.`);
      await refreshHistory();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  const modeLabel = isDemoAudit ? "Demo audit" : backendMode === "offline" ? "Backend offline" : backendMode === "failed" ? "Scan failed" : backendMode === "empty" ? "Empty audit" : "Live audit";
  const titleText = isDemoAudit ? "City of Example - Business License Registration Audit" : auditRun.id && auditRun.id !== "empty-audit" ? `Audit ${auditRun.id}` : "New civic flow audit";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <AppLogo />
          <div>
            <p>Civic Flow Auditor</p>
            <span>AI accessibility audit assistant</span>
          </div>
        </div>
        <div className="audit-title">
          <div>
            <strong>{titleText}</strong>
            <span className="mode-badges">
              <span className={`mode-badge ${isDemoAudit ? "demo" : backendMode === "offline" || backendMode === "failed" ? "warning" : "live"}`}>{modeLabel}</span>
              <span className={`mode-badge ${aiEnhanced ? "ai" : "deterministic"}`}>{aiEnhanced ? "AI-enhanced" : deterministicMode ? "Deterministic" : "AI pending"}</span>
            </span>
          </div>
          <button className="text-button" type="button" onClick={resetAudit}>Edit</button>
        </div>
        <div className="top-actions">
          <button className="secondary-button" type="button" onClick={loadDemoAudit}>
            <FileText size={18} />
            Load demo
          </button>
          <button className="secondary-button" type="button" onClick={resetAudit}>
            <FileText size={18} />
            New audit
          </button>
          <button className="secondary-button" type="button" onClick={handleListen}>
            <Volume2 size={18} />
            Listen mode
          </button>
          <button className="secondary-button" type="button" onClick={() => exportReport("HTML")}>
            <Download size={18} />
            Export
          </button>
        </div>
      </header>

      <section className="intake-grid" aria-label="Audit setup">
        <div className="setup-panel">
          <div className="tab-switcher" role="tablist">
            <button
              className={`tab-button ${activeTab === "website" ? "active" : ""}`}
              onClick={() => setActiveTab("website")}
              role="tab"
              aria-selected={activeTab === "website"}
              disabled={isRunning || isScanningImage}
            >
              <Globe2 size={18} />
              Website Audit
            </button>
            <button
              className={`tab-button ${activeTab === "document" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("document");
                setSelectedStage("document-scan");
              }}
              role="tab"
              aria-selected={activeTab === "document"}
              disabled={isRunning || isScanningImage}
            >
              <FileSearch size={18} />
              Document Scan
              <span className="nvidia-badge-inline">NVIDIA Nemotron</span>
            </button>
          </div>

          {activeTab === "website" ? (
            <>
              <div className="numbered-heading">
                <span>1</span>
                <h2>Enter public website URL</h2>
              </div>
              <label className="url-field">
                <Globe2 size={19} />
                <input value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Website URL" disabled={isRunning} />
              </label>

              <div className="numbered-heading">
                <span>2</span>
                <h2>Choose scan depth</h2>
              </div>
              <div className="depth-options" role="group" aria-label="Scan depth">
                {scanDepths.map((depth) => (
                  <button
                    className={scanDepth === depth.id ? "selected" : ""}
                    key={depth.id}
                    type="button"
                    onClick={() => setScanDepth(depth.id)}
                    disabled={isRunning}
                  >
                    <strong>{depth.name}</strong>
                    <small>{depth.detail}</small>
                  </button>
                ))}
              </div>
              <div className="safety-line">
                <ShieldCheck size={18} />
                <span>Draft assistance report, not legal certification. No forms are submitted.</span>
              </div>
              <div className="scan-actions">
                <button className="primary-button" type="button" onClick={startAudit} disabled={isRunning}>
                  <Play size={18} fill="currentColor" />
                  {isRunning ? "Scanning audit" : auditRun.status === "report-ready" ? "Run another audit" : "Start audit"}
                </button>
                <button className="secondary-button" type="button" onClick={cancelCurrentAudit} disabled={!isRunning || auditRun.id === "pending"}>
                  <TriangleAlert size={18} />
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="document-scan-panel">
              <div className="numbered-heading">
                <span>1</span>
                <h2>Upload scanned forms or notices</h2>
              </div>
              
              <div
                className="drop-zone"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add("dragover");
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove("dragover");
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove("dragover");
                  handleImageDrop(e.dataTransfer.files);
                }}
                onClick={() => document.getElementById("file-upload").click()}
              >
                <FileSearch size={36} className="drop-icon" />
                <p>Drag & drop scanned images here, or <span>browse files</span></p>
                <small>Supports PNG, JPEG, or scanned PDF screenshot files</small>
                <input
                  type="file"
                  id="file-upload"
                  multiple
                  accept="image/*"
                  onChange={(e) => handleImageDrop(e.target.files)}
                  style={{ display: "none" }}
                />
              </div>

              <div className="safety-line">
                <ShieldCheck size={18} />
                <span>Uploaded scan evidence is stored locally for report export until you purge the audit artifacts.</span>
              </div>

              {scanQueue.length > 0 && (
                <div className="queue-status">
                  <span className="live-dot" />
                  <span>Processing queue: {scanQueue.length} document{scanQueue.length > 1 ? "s" : ""} remaining...</span>
                </div>
              )}

              {scannedImages.length > 0 && (
                <div className="scan-workspace">
                  <div className="scan-thumbnails">
                    {scannedImages.map((img) => (
                      <button
                        key={img.id}
                        type="button"
                        className={`thumb-card ${selectedScanImageId === img.id ? "active" : ""} ${img.status}`}
                        onClick={() => setSelectedScanImageId(img.id)}
                      >
                        <img src={img.originalBase64} alt={img.name} />
                        <span className="thumb-status">
                          {img.status === "queued" && "Queued"}
                          {img.status === "processing" && "Scanning..."}
                          {img.status === "done" && "Analyzed"}
                          {img.status === "failed" && "Failed"}
                        </span>
                      </button>
                    ))}
                  </div>

                  {(() => {
                    const activeImage = scannedImages.find((img) => img.id === selectedScanImageId);
                    if (!activeImage) return null;

                    return (
                      <div className="active-scan-view">
                        <div className="scan-image-container">
                          <h4>Cropped Document View (AI Crop bounds)</h4>
                          <div className="crop-frame-container">
                            <img
                              src={activeImage.croppedBase64 || activeImage.originalBase64}
                              alt="Scanned document crop"
                              className="crop-preview-img"
                            />
                            {activeImage.regions.map((region, idx) => (
                              <div
                                key={idx}
                                className={`scan-overlay-box ${region.type.toLowerCase().replace(" ", "-")}`}
                                style={{
                                  left: `${region.x}%`,
                                  top: `${region.y}%`,
                                  width: `${region.width}%`,
                                  height: `${region.height}%`
                                }}
                                title={`${region.type}: ${region.accessibility_notes}`}
                              >
                                <span>{region.label || (idx + 1)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="power-tag">
                            <span className="power-dot" />
                            <span>Powered by NVIDIA Nemotron-3 Nano Omni</span>
                          </div>
                        </div>

                        <div className="scan-details-panel">
                          <h3>Detected Layout Elements</h3>
                          {activeImage.status === "processing" ? (
                            <div className="loading-state">
                              <span className="live-dot" />
                              <span>AI is reading form layout and checking WCAG rules...</span>
                            </div>
                          ) : activeImage.regions.length > 0 ? (
                            <div className="region-list">
                              {activeImage.regions.map((region, idx) => (
                                <div key={idx} className="region-item-card">
                                  <div className="region-header">
                                    <span className="region-number">{region.label || (idx + 1)}</span>
                                    <span className="region-type-badge">{region.type}</span>
                                    <button
                                      className="refine-btn"
                                      type="button"
                                      disabled={refiningRegionId === region.label}
                                      onClick={() => refineRegionInUI(activeImage, region)}
                                    >
                                      {refiningRegionId === region.label ? "Refining..." : "Refine"}
                                    </button>
                                  </div>
                                  <div className="region-body">
                                    <p><strong>Extracted Text:</strong> "{region.text || "No readable text"}"</p>
                                    <p className="region-notes"><strong>WCAG Concern:</strong> {region.accessibility_notes}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="empty-state compact">No regions detected. Try re-uploading a cleaner photo.</div>
                          )}

                          {activeImage.suggestions.length > 0 && (
                            <div className="suggestions-box">
                              <h4>Accessibility Suggestions</h4>
                              <ul>
                                {activeImage.suggestions.map((s, idx) => (
                                  <li key={idx}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
        <AuditHistoryPanel history={history} loadHistoryAudit={loadHistoryAudit} refreshHistory={refreshHistory} compact />
      </section>

      <section className="metrics-band" aria-label="Scan progress">
        <div>
          <Globe2 size={24} />
          <strong>{pagesScanned} of {Math.max(auditRun.pages.length, pagesScanned)}</strong>
          <span>Pages scanned</span>
        </div>
        <div>
          <FileText size={24} />
          <strong>{auditRun.documents.length}</strong>
          <span>Documents found</span>
        </div>
        <div>
          <GitBranch size={24} />
          <strong>{stages.length}</strong>
          <span>Sessions mapped</span>
        </div>
        <div>
          <ListChecks size={24} />
          <strong>{findings.length}</strong>
          <span>Findings</span>
        </div>
        <div className="progress-cell">
          <span className={isRunning ? "live-dot" : "pause-dot"} aria-hidden="true" />
          <strong>{statusLabel(auditRun.status)}</strong>
          <div className="progress-track">
            <span style={{ width: `${Math.max(auditRun.progress || 0, 0)}%` }} />
          </div>
        </div>
      </section>

      <section className="journey-section" aria-labelledby="journey-heading">
        <div className="panel-title-row compact">
          <div className="numbered-heading">
            <span>3</span>
            <h2 id="journey-heading">Journey map, user task flow</h2>
          </div>
          <div className="legend">
            <span><i className="legend-critical" /> Critical</span>
            <span><i className="legend-serious" /> Serious</span>
            <span><i className="legend-minor" /> Minor</span>
          </div>
        </div>
        <div className="stage-flow">
          {stages.length ? stages.map((stage, index) => (
            <button
              className={`stage-card ${selectedStage === stage.id ? "active" : ""}`}
              key={stage.id}
              type="button"
              onClick={() => {
                setSelectedStage(stage.id);
                const nextIssue = findings.find((issue) => issue.stage === stage.id);
                if (nextIssue) setSelectedIssueId(nextIssue.id);
              }}
            >
              <span className="stage-number">{index + 1}</span>
              <strong>{stage.name}</strong>
              <small>{stage.pages} {stage.pages === 1 ? "page" : "pages"}</small>
              <span className="stage-severity">
                <SeverityMark type="critical" value={stage.critical} />
                <SeverityMark type="serious" value={stage.serious} />
                <SeverityMark type="minor" value={stage.minor} />
              </span>
              {index < stages.length - 1 ? <ArrowRight className="stage-arrow" size={17} /> : null}
            </button>
          )) : <div className="empty-state">No journey stages yet. Start a live audit or load the demo audit.</div>}
        </div>
      </section>

      <section className="workbench-grid">
        <div className="issue-panel">
          <div className="panel-title-row compact">
            <div className="numbered-heading">
              <span>4</span>
              <h2>Issue queue, grouped by journey stage</h2>
            </div>
            <select aria-label="Filter issues by stage" value={selectedStage} onChange={(event) => setSelectedStage(event.target.value)}>
              {stages.map((stage) => (
                <option value={stage.id} key={stage.id}>{stage.name}</option>
              ))}
              <option value="all">All stages</option>
            </select>
          </div>
          <div className="issue-table" role="table" aria-label="Issue queue">
            <div className="table-row table-head" role="row">
              <span>Stage</span>
              <span>Issue</span>
              <span>Impact</span>
              <span>Guideline</span>
              <span>Fix status</span>
            </div>
            {visibleIssues.length ? (
              visibleIssues.map((issue) => (
                <button
                  className={`table-row issue-row ${selectedIssueId === issue.id ? "selected" : ""}`}
                  key={issue.id}
                  type="button"
                  onClick={() => setSelectedIssueId(issue.id)}
                  role="row"
                >
                  <span>{issue.stageLabel}</span>
                  <strong>{issue.title}</strong>
                  <span><SeverityMark type={issue.severity === "High" ? "serious" : issue.severity === "Critical" ? "critical" : "minor"} value="1" /></span>
                  <span>{issue.guideline}</span>
                  <span className={issue.status === "In progress" ? "status-pill active" : "status-pill"}>{issue.status}</span>
                </button>
              ))
            ) : (
              <div className="empty-state">No findings yet. Start a live audit or wait for the scanner to finish.</div>
            )}
          </div>
          <div className="agent-list" aria-label="Full backend agent flow">
            <h3>Full backend agent flow</h3>
            {agentSteps.map((step, index) => (
              <div className={`agent-step ${step.status}`} key={step.name}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.name}</strong>
                  <small>{step.detail}</small>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="evidence-panel" aria-labelledby="evidence-heading">
          <div className="panel-title-row compact">
            <div className="numbered-heading">
              <span>5</span>
              <h2 id="evidence-heading">Evidence and fix details</h2>
            </div>
            <div className="issue-nav">
              <button className="nav-button" type="button" onClick={() => moveIssue(-1)} disabled={!canNavigateIssues || selectedIssueIndex === 0}>
                <ArrowLeft size={16} />
                Previous
              </button>
              <button className="nav-button" type="button" onClick={() => moveIssue(1)} disabled={!canNavigateIssues || selectedIssueIndex === visibleIssues.length - 1}>
                Next
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div className="evidence-grid">
            {selectedIssue?.screenshotUrl ? (
              <EvidenceImage issue={selectedIssue} />
            ) : isDemoAudit ? (
              <MockEvidencePreview />
            ) : (
              <div className="empty-evidence-frame">
                <Camera size={28} />
                <strong>No screenshot evidence yet</strong>
                <span>Live runs attach screenshots when issues are found.</span>
              </div>
            )}

            <div className="finding-detail">
              {selectedIssue ? (
                <>
                  <span className={`finding-badge ${selectedIssue.severity.toLowerCase()}`}>{selectedIssue.severity}</span>
                  <h3>{selectedIssue.title}</h3>
                  <dl>
                    <div>
                      <dt>Flow</dt>
                      <dd>{selectedIssue.stageLabel}</dd>
                    </div>
                    <div>
                      <dt>Guideline</dt>
                      <dd>{selectedIssue.guideline}</dd>
                    </div>
                  </dl>
                  {selectedGuidelineRefs.length ? (
                    <section>
                      <h4>Rule sources</h4>
                      <p>
                        {selectedGuidelineRefs.map((ref, index) => (
                          <span key={ref.url}>
                            <a href={ref.url} target="_blank" rel="noreferrer">{ref.label}</a>
                            {index < selectedGuidelineRefs.length - 1 ? " | " : ""}
                          </span>
                        ))}
                      </p>
                    </section>
                  ) : null}
                  {selectedIssue.matchedStageReason ? (
                    <section>
                      <h4>Stage mapping</h4>
                      <p>{selectedIssue.matchedStageReason}</p>
                    </section>
                  ) : null}
                  <section>
                    <h4>Resident impact</h4>
                    <p>{selectedIssue.impact}</p>
                  </section>
                  <section>
                    <h4>Recommended fix, plain language</h4>
                    <p>{selectedIssue.fix}</p>
                  </section>
                  {selectedHumanReviewNote ? (
                    <section>
                      <h4>Human review note</h4>
                      <p>{selectedHumanReviewNote}</p>
                    </section>
                  ) : null}
                  <section className="ticket-box">
                    <h4>Developer ticket draft</h4>
                    <pre>{selectedIssue.ticket}</pre>
                  </section>
                  <div className="detail-actions">
                    <button className="secondary-button" type="button" onClick={copyTicket}>
                      <Copy size={17} />
                      Copy ticket
                    </button>
                    <button className="primary-button" type="button" onClick={() => setNotice("Finding marked for human review.")}>
                      <ClipboardCheck size={17} />
                      Mark for human review
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty-detail">
                  <span className="finding-badge low">Review</span>
                  <h3>No finding selected</h3>
                  <p>Start a live audit to populate evidence, WCAG references, and developer ticket drafts.</p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </section>

      <section className="report-actions" aria-label="Report and safety actions">
        <div className="notice-banner">
          <TriangleAlert size={21} />
          <p>
            Automated testing cannot detect all accessibility issues. This is assistance, not legal certification.
            The agent will not submit forms automatically.
          </p>
        </div>
        <label className="final-review">
          <input
            type="checkbox"
            checked={reviewConfirmed}
            disabled={auditRun.status !== "report-ready"}
            onChange={(event) => setReviewConfirmed(event.target.checked)}
          />
          <span>
            <strong>Final review before export</strong>
            <small>Human review is still required; suggested values are drafts; the agent has not submitted any public forms.</small>
          </span>
        </label>
        <div className="report-buttons">
          <button className="secondary-button" type="button" onClick={handleListen}>
            <Headphones size={18} />
            Read top issue
          </button>
          <button className="secondary-button" type="button" onClick={enhanceCurrentAudit} disabled={isRunning || backendMode === "demo" || !findings.length}>
            <Workflow size={18} />
            Enhance with AI
          </button>
          <button className="secondary-button" type="button" onClick={() => exportReport("HTML")}>
            <BookOpenCheck size={18} />
            Export HTML
          </button>
          <button className="secondary-button" type="button" onClick={() => exportReport("PDF")}>
            <Download size={18} />
            Export PDF
          </button>
          <button className="secondary-button" type="button" onClick={() => exportReport("Tickets")}>
            <FileText size={18} />
            Export tickets
          </button>
          <button className="secondary-button" type="button" onClick={purgeArtifacts} disabled={!auditRun.id || auditRun.id === "empty-audit" || auditRun.id === "pending"}>
            <Trash2 size={18} />
            Purge artifacts
          </button>
        </div>
      </section>

      <BackendFlowPanel setNotice={setNotice} />

      {notice ? (
        <div className="toast" role="status">
          <Workflow size={17} />
          <span>{notice}</span>
        </div>
      ) : null}
    </main>
  );
}

export { App };
