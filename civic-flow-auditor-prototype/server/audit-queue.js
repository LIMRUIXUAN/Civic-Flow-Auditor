import { config } from "./config.js";
import { runCivicFlowAudit } from "./audit-engine.js";
import { loadAuditRun, saveAuditRun, updateAuditRun } from "./store.js";

const queue = [];
const activeJobs = new Map();

function cancelledPatch(run, reason = "Audit cancelled by the user.") {
  return {
    ...run,
    status: "cancelled",
    progress: Math.max(run.progress || 0, 5),
    error: reason,
    agentSteps: (run.agentSteps || []).map((step) => (step.status === "running" || step.status === "queued" ? { ...step, status: "cancelled" } : step)),
  };
}

function pumpQueue() {
  while (activeJobs.size < config.maxConcurrentJobs && queue.length) {
    const job = queue.shift();
    activeJobs.set(job.id, job);
    void runJob(job);
  }
}

async function runJob(job) {
  try {
    await runCivicFlowAudit({
      id: job.id,
      url: job.url,
      depth: job.depth,
      signal: job.controller.signal,
      onUpdate: saveAuditRun,
    });
  } catch (error) {
    const current = await loadAuditRun(job.id).catch(() => null);
    if (current) {
      const wasCancelled = job.controller.signal.aborted;
      await saveAuditRun(
        wasCancelled
          ? cancelledPatch(current)
          : {
              ...current,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            },
      );
    }
  } finally {
    activeJobs.delete(job.id);
    pumpQueue();
  }
}

export function enqueueAudit({ id, url, depth }) {
  if (activeJobs.has(id) || queue.some((job) => job.id === id)) {
    throw new Error("Audit job is already queued.");
  }

  const job = {
    id,
    url,
    depth,
    controller: new AbortController(),
    queuedAt: new Date().toISOString(),
  };
  queue.push(job);
  pumpQueue();
  return job;
}

export async function cancelAudit(auditId) {
  const queuedIndex = queue.findIndex((job) => job.id === auditId);
  if (queuedIndex >= 0) {
    queue.splice(queuedIndex, 1);
    const updated = await updateAuditRun(auditId, (run) => cancelledPatch(run));
    return { cancelled: true, state: "queued", run: updated };
  }

  const active = activeJobs.get(auditId);
  if (active) {
    active.controller.abort();
    const updated = await updateAuditRun(auditId, (run) => cancelledPatch(run, "Audit cancellation requested. The active browser step will stop at the next safe checkpoint."));
    return { cancelled: true, state: "running", run: updated };
  }

  const current = await loadAuditRun(auditId);
  if (current.status === "report-ready" || current.status === "failed" || current.status === "cancelled") {
    return { cancelled: false, state: current.status, run: current };
  }

  const updated = await updateAuditRun(auditId, (run) => cancelledPatch(run));
  return { cancelled: true, state: "unknown", run: updated };
}

export function getQueueSnapshot() {
  return {
    maxConcurrent: config.maxConcurrentJobs,
    active: [...activeJobs.keys()],
    queued: queue.map((job) => ({ id: job.id, queuedAt: job.queuedAt })),
  };
}
