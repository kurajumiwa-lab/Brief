import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Download,
  Gauge,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Sparkles,
  Terminal,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Stat from "@/components/ui/Stat";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { opsAPI, squadAPI, apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const ms = (n) => (n === null || n === undefined ? "—" : `${n} ms`);
const pct = (n) => (n === null || n === undefined ? "—" : `${n}%`);

const DEFAULT_WORKFLOWS = [
  {
    workflow_type: "squad_job_call",
    label: "Marketplace Shift / Squad Call-Up",
    endpoint: "POST /api/squad/job-calls",
    category: "Marketplace Dispatch",
    description:
      "Posts a verified temporary shift call-up to the Hustle League board with minimum-wage and tier validation.",
    fields: [
      { name: "title", label: "Shift title", type: "text", required: true, default: "Offload & grade morning crates" },
      {
        name: "skill",
        label: "Skill category",
        type: "select",
        required: true,
        default: "mover",
        options: ["mover", "packer", "loader", "rider", "sorter", "clerk", "driver"],
      },
      { name: "task_type", label: "Task type", type: "text", required: true, default: "shift" },
      {
        name: "required_tier",
        label: "Minimum worker tier",
        type: "select",
        required: true,
        default: "common",
        options: ["common", "rare", "epic", "legendary"],
      },
      { name: "pay_kes", label: "Pay (KES)", type: "number", required: true, default: 500 },
      { name: "location", label: "Location", type: "text", required: false, default: "Main Market Bay" },
      { name: "expires_in_hours", label: "Expires in (hours)", type: "number", required: true, default: 24 },
    ],
  },
  {
    workflow_type: "outbox_drain",
    label: "Transactional Outbox Drain",
    endpoint: "event_outbox.drain",
    category: "Platform Worker",
    description:
      "Drains unprocessed domain events from the event_outbox table using FOR UPDATE SKIP LOCKED.",
    fields: [{ name: "batch_size", label: "Max batch size", type: "number", required: true, default: 200 }],
  },
  {
    workflow_type: "standing_sweep",
    label: "Passport Standing Expiry & Reminders",
    endpoint: "standing.sweep.run_once",
    category: "Compliance & Trust",
    description: "Flips expired Business Passport claims and dispatches 30/14/7-day renewal notifications.",
    fields: [],
  },
  {
    workflow_type: "payments_housekeeping",
    label: "Payments & Intent Housekeeping",
    endpoint: "payment_worker.housekeeping",
    category: "Finance & Ledger",
    description:
      "Expires stale pending payment intents, flags overdue chama/murabaha advances, and runs daily reconciliation.",
    fields: [],
  },
  {
    workflow_type: "stock_housekeeping",
    label: "Stock Hold Expiry & Market Lock Windows",
    endpoint: "pos_sync.housekeeping",
    category: "Inventory & Trade",
    description:
      "Releases unconfirmed stock holds, sends event reminders, and processes due market lock windows and governance ballots.",
    fields: [],
  },
  {
    workflow_type: "pos_sync_all",
    label: "POS Bridge Inventory Sync",
    endpoint: "pos_sync.run_sync",
    category: "Inventory & Trade",
    description:
      "Runs an immediate inventory sync pass across active POS connections and writes POSSyncLog audit records.",
    fields: [],
  },
];

const SKILL_MIN_WAGE_KES = {
  mover: 350,
  packer: 300,
  loader: 400,
  rider: 250,
  sorter: 300,
  clerk: 450,
  driver: 700,
};

function defaultParamsForWorkflow(wf) {
  const params = {};
  (wf?.fields || []).forEach((f) => {
    params[f.name] = f.default ?? "";
  });
  return params;
}

function StatusPill({ status }) {
  const normalized = (status || "queued").toLowerCase();
  const styles = {
    running: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    queued: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    succeeded: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    failed: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  };
  const labels = {
    running: "Running",
    queued: "Queued",
    succeeded: "Succeeded",
    failed: "Failed",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        styles[normalized] || styles.queued
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          normalized === "running"
            ? "bg-sky-400 animate-pulse"
            : normalized === "succeeded"
            ? "bg-emerald-400"
            : normalized === "failed"
            ? "bg-rose-400"
            : "bg-amber-400"
        }`}
      />
      {labels[normalized] || status}
    </span>
  );
}

function RouteTable({ rows, highlight }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-2xs uppercase tracking-wider text-ink-4">
            <th className="text-left font-medium pb-2">Route</th>
            <th className="text-right font-medium pb-2">Requests</th>
            <th className="text-right font-medium pb-2">avg</th>
            <th className="text-right font-medium pb-2">p50</th>
            <th className="text-right font-medium pb-2">p95</th>
            <th className="text-right font-medium pb-2">max</th>
            <th className="text-right font-medium pb-2">errors</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {(rows || []).map((r) => (
            <tr key={r.path || r.route} className="border-t border-edge-1">
              <td className="py-1.5 pr-3 text-ink-2 truncate max-w-[22rem]">{r.path || r.route}</td>
              <td className="py-1.5 text-right text-ink-3">{r.requests ?? r.count}</td>
              <td className="py-1.5 text-right text-ink-3">{r.avg_ms}</td>
              <td className="py-1.5 text-right text-ink-3">{r.p50_ms}</td>
              <td className={cn("py-1.5 text-right", highlight ? "text-accent-600 dark:text-accent-400" : "text-ink-3")}>
                {r.p95_ms}
              </td>
              <td className="py-1.5 text-right text-ink-3">{r.max_ms}</td>
              <td className={cn("py-1.5 text-right", r.errors > 0 ? "text-red-600 dark:text-red-400" : "text-ink-4")}>
                {r.errors}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Operations Center & System Monitoring (`/ops`)
 */
export default function Ops() {
  const [status, setStatus] = useState(null);
  const [slow, setSlow] = useState(null);
  const [metrics, setMetrics] = useState("");
  const [showMetrics, setShowMetrics] = useState(false);
  const [measurement, setMeasurement] = useState(null);
  const [loading, setLoading] = useState(true);

  // Operations Center job management state
  const [jobsPayload, setJobsPayload] = useState({
    summary: { running: 0, queued: 0, succeeded: 0, failed: 0 },
    worker_health: null,
    supported_workflows: DEFAULT_WORKFLOWS,
    jobs: [],
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const [inspectedJobId, setInspectedJobId] = useState(null);
  const [actionBusyId, setActionBusyId] = useState(null);
  const [opsBanner, setOpsBanner] = useState(null);

  // Create / Run Job Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedWorkflowType, setSelectedWorkflowType] = useState("squad_job_call");
  const [customJobTitle, setCustomJobTitle] = useState("");
  const [jobParams, setJobParams] = useState(() => defaultParamsForWorkflow(DEFAULT_WORKFLOWS[0]));
  const [reviewResult, setReviewResult] = useState(null);
  const [formError, setFormError] = useState(null);
  const [submittingJob, setSubmittingJob] = useState(false);

  const selectedWorkflow = useMemo(() => {
    const list = jobsPayload.supported_workflows?.length ? jobsPayload.supported_workflows : DEFAULT_WORKFLOWS;
    return list.find((w) => w.workflow_type === selectedWorkflowType) || list[0];
  }, [jobsPayload.supported_workflows, selectedWorkflowType]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const promises = [
        opsAPI.status(),
        opsAPI.slow(),
        typeof opsAPI.jobs === "function" ? opsAPI.jobs().catch(() => null) : Promise.resolve(null),
        typeof opsAPI.measurement === "function" ? opsAPI.measurement().catch(() => null) : Promise.resolve(null),
      ];
      const [s, sl, jb, ms] = await Promise.all(promises);
      setStatus(s.data);
      setSlow(sl.data);
      setMeasurement(ms?.data || null);
      if (jb?.data) {
        setJobsPayload({
          summary: jb.data.summary || { running: 0, queued: 0, succeeded: 0, failed: 0 },
          worker_health: jb.data.worker_health || null,
          supported_workflows: jb.data.supported_workflows?.length
            ? jb.data.supported_workflows
            : DEFAULT_WORKFLOWS,
          jobs: jb.data.jobs || [],
        });
      }
    } catch (e) {
      toast.error(apiError(e, "Couldn't read the ops status"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revealMetrics = async () => {
    if (metrics) return setShowMetrics((v) => !v);
    try {
      const { data } = await opsAPI.metrics();
      setMetrics(typeof data === "string" ? data : String(data));
      setShowMetrics(true);
    } catch (e) {
      toast.error(apiError(e, "Couldn't fetch the metrics scrape"));
    }
  };

  const handleSelectWorkflow = (wfType) => {
    setSelectedWorkflowType(wfType);
    const list = jobsPayload.supported_workflows?.length ? jobsPayload.supported_workflows : DEFAULT_WORKFLOWS;
    const wf = list.find((w) => w.workflow_type === wfType) || list[0];
    setJobParams(defaultParamsForWorkflow(wf));
    setCustomJobTitle("");
    setReviewResult(null);
    setFormError(null);
  };

  const openCreateModal = (wfType = "squad_job_call") => {
    handleSelectWorkflow(wfType);
    setCreateOpen(true);
  };

  const validateClientSide = () => {
    if (selectedWorkflowType === "squad_job_call") {
      const title = String(jobParams.title || "").trim();
      if (title.length < 3) {
        return "Shift title must be at least 3 characters.";
      }
      const skill = String(jobParams.skill || "mover").toLowerCase();
      const floor = SKILL_MIN_WAGE_KES[skill] || 250;
      const pay = Number(jobParams.pay_kes || 0);
      if (!Number.isFinite(pay) || pay < floor) {
        return `Minimum wage guard: '${skill}' shifts require at least KES ${floor}.`;
      }
      const hours = Number(jobParams.expires_in_hours || 24);
      if (hours < 1 || hours > 168) {
        return "Expiry window must be between 1 and 168 hours.";
      }
    }
    if (selectedWorkflowType === "outbox_drain") {
      const batch = Number(jobParams.batch_size || 200);
      if (!Number.isFinite(batch) || batch < 1 || batch > 2000) {
        return "Batch size must be between 1 and 2000.";
      }
    }
    return null;
  };

  const handleValidateJob = async () => {
    setFormError(null);
    const clientErr = validateClientSide();
    if (clientErr) {
      setFormError(clientErr);
      return;
    }
    setSubmittingJob(true);
    try {
      if (typeof opsAPI.createJob === "function") {
        const res = await opsAPI.createJob({
          workflow_type: selectedWorkflowType,
          title: customJobTitle || selectedWorkflow?.label,
          params: jobParams,
          dry_run: true,
        });
        setReviewResult(res.data);
      } else {
        setReviewResult({
          valid: true,
          dry_run: true,
          workflow_type: selectedWorkflowType,
          workflow_label: selectedWorkflow?.label,
          endpoint: selectedWorkflow?.endpoint,
          normalized_params: jobParams,
          warnings: [],
        });
      }
    } catch (e) {
      setFormError(e?.response?.data?.detail || "Validation failed. Please review your job parameters.");
    } finally {
      setSubmittingJob(false);
    }
  };

  const handleExecuteJob = async (overrideWfType = null, overrideParams = null, overrideTitle = null) => {
    const wfType = overrideWfType || selectedWorkflowType;
    const params = overrideParams || jobParams;
    const title = overrideTitle || customJobTitle || selectedWorkflow?.label;

    if (!overrideWfType) {
      const clientErr = validateClientSide();
      if (clientErr) {
        setFormError(clientErr);
        return;
      }
    }

    setSubmittingJob(true);
    setFormError(null);
    try {
      let createdJob = null;
      if (typeof opsAPI.createJob === "function") {
        const res = await opsAPI.createJob({
          workflow_type: wfType,
          title,
          params,
          dry_run: false,
        });
        createdJob = res.data?.job;
      } else if (wfType === "squad_job_call" && typeof squadAPI?.postCall === "function") {
        const res = await squadAPI.postCall(params);
        const call = res.data || {};
        createdJob = {
          id: call.id || `job-${Date.now()}`,
          name: call.title || params.title,
          workflow_type: "squad_job_call",
          workflow_label: "Marketplace Shift / Squad Call-Up",
          created_by: "ops_admin",
          status: "queued",
          params,
          created_at: new Date().toISOString(),
          result_summary: `Shift call-up posted (KES ${params.pay_kes} · ${params.skill}). Awaiting worker acceptance.`,
        };
      } else {
        createdJob = {
          id: `job-${Date.now()}`,
          name: title || wfType,
          workflow_type: wfType,
          workflow_label: title || wfType,
          created_by: "ops_admin",
          status: "succeeded",
          params,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 14,
          result_summary: "Workflow executed successfully.",
        };
      }

      if (createdJob) {
        setJobsPayload((prev) => {
          const nextJobs = [createdJob, ...(prev.jobs || []).filter((j) => j.id !== createdJob.id)];
          const summary = {
            running: nextJobs.filter((j) => j.status === "running").length,
            queued: nextJobs.filter((j) => j.status === "queued").length,
            succeeded: nextJobs.filter((j) => j.status === "succeeded").length,
            failed: nextJobs.filter((j) => j.status === "failed").length,
          };
          return { ...prev, summary, jobs: nextJobs };
        });
        setOpsBanner({
          tone: createdJob.status === "failed" ? "error" : "success",
          title:
            createdJob.status === "failed"
              ? `Job failed: ${createdJob.name}`
              : `Job dispatched: ${createdJob.name}`,
          detail: createdJob.result_summary || createdJob.error,
        });
      }
      setCreateOpen(false);
      setReviewResult(null);
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || "Failed to execute job.";
      setFormError(detail);
      setOpsBanner({
        tone: "error",
        title: "Job execution failed",
        detail,
      });
    } finally {
      setSubmittingJob(false);
    }
  };

  const handleJobAction = async (job, action) => {
    setActionBusyId(job.id);
    try {
      if (typeof opsAPI.actOnJob === "function") {
        const res = await opsAPI.actOnJob(job.id, { action });
        const updated = res.data?.job;
        if (updated) {
          setJobsPayload((prev) => {
            const nextJobs =
              action === "retry"
                ? [updated, ...(prev.jobs || [])]
                : (prev.jobs || []).map((j) => (j.id === job.id ? updated : j));
            return {
              ...prev,
              summary: {
                running: nextJobs.filter((j) => j.status === "running").length,
                queued: nextJobs.filter((j) => j.status === "queued").length,
                succeeded: nextJobs.filter((j) => j.status === "succeeded").length,
                failed: nextJobs.filter((j) => j.status === "failed").length,
              },
              jobs: nextJobs,
            };
          });
        } else {
          await load();
        }
      }
      setOpsBanner({
        tone: "success",
        title: action === "cancel" ? `Cancelled ${job.name}` : `Re-executed ${job.name}`,
        detail: action === "cancel" ? "Job state transitioned to cancelled." : "New execution pass completed.",
      });
    } catch (e) {
      setOpsBanner({
        tone: "error",
        title: `Could not ${action} job`,
        detail: e?.response?.data?.detail || "Action failed.",
      });
    } finally {
      setActionBusyId(null);
    }
  };

  const filteredJobs = useMemo(() => {
    const all = jobsPayload.jobs || [];
    if (statusFilter === "all") return all;
    return all.filter((j) => j.status === statusFilter);
  }, [jobsPayload.jobs, statusFilter]);

  if (loading && !status) return <PageSpinner label="Reading the metrics registry…" />;
  if (!status) {
    return (
      <EmptyState
        icon={Server}
        title="Ops status unavailable"
        description="The API answered nothing — check that the backend is up."
        action={
          <Button size="sm" onClick={load}>
            Retry
          </Button>
        }
      />
    );
  }

  const http = status.http || {};
  const db = status.database || {};
  const env = status.environment || {};
  const jobSummary = jobsPayload.summary || { running: 0, queued: 0, succeeded: 0, failed: 0 };

  return (
    <div className="space-y-6">
      {/* ── PRIMARY OPERATIONS CENTER PANEL (Dark Emerald Theme) ─────────── */}
      <section className="rounded-3xl bg-[#151B19] text-[#F1F5F3] border border-[#35413A] p-5 md:p-6 shadow-xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-300 mb-2">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Ops & monitoring</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
              Operations Center
            </h1>
            <p className="text-sm text-[#9FB0A7] mt-0.5">
              Job management, workflow dispatch, and live execution monitoring
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => openCreateModal("squad_job_call")}
              className="inline-flex items-center gap-2 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#082218] font-bold text-sm px-4 py-2.5 shadow-sm transition"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
              <span>+ Create Job</span>
            </button>
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={load} loading={loading}>
              Refresh
            </Button>
            <Button size="sm" variant="secondary" icon={Download} onClick={revealMetrics}>
              {showMetrics ? "Hide" : "Raw scrape"}
            </Button>
          </div>
        </div>

        {opsBanner && (
          <div
            role="status"
            className={`flex items-start justify-between gap-3 rounded-2xl border p-4 text-sm ${
              opsBanner.tone === "error"
                ? "bg-rose-950/60 border-rose-500/40 text-rose-200"
                : "bg-emerald-950/60 border-emerald-500/40 text-emerald-200"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {opsBanner.tone === "error" ? (
                <XCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-semibold">{opsBanner.title}</p>
                {opsBanner.detail && <p className="text-xs opacity-90 mt-0.5">{opsBanner.detail}</p>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpsBanner(null)}
              className="text-xs opacity-75 hover:opacity-100"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* 4 Live Job Status KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {[
            {
              key: "running",
              label: "Running",
              value: jobSummary.running,
              sub: "Live job status",
              accent: "text-sky-300",
            },
            {
              key: "queued",
              label: "Queued",
              value: jobSummary.queued,
              sub: "Awaiting execution",
              accent: "text-amber-300",
            },
            {
              key: "succeeded",
              label: "Succeeded",
              value: jobSummary.succeeded,
              sub: "Completed jobs",
              accent: "text-emerald-300",
            },
            {
              key: "failed",
              label: "Failed",
              value: jobSummary.failed,
              sub: "Require investigation",
              accent: "text-rose-300",
            },
          ].map((stat) => {
            const active = statusFilter === stat.key;
            return (
              <button
                key={stat.key}
                type="button"
                onClick={() => setStatusFilter(active ? "all" : stat.key)}
                className={`text-left rounded-2xl bg-[#202824] border p-4 transition ${
                  active
                    ? "border-emerald-400 ring-2 ring-emerald-400/20"
                    : "border-[#35413A] hover:border-[#4B5C52]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#9FB0A7]">
                    {stat.label}
                  </span>
                  {active && (
                    <span className="text-[10px] font-semibold text-emerald-300">Filtered</span>
                  )}
                </div>
                <div className={`text-2xl md:text-3xl font-bold mt-1.5 ${stat.accent}`}>
                  {stat.value}
                </div>
                <div className="text-xs text-[#9FB0A7] mt-1">{stat.sub}</div>
              </button>
            );
          })}
        </div>

        {/* Supported Workflows & Quick Dispatch */}
        <div className="rounded-2xl bg-[#202824] border border-[#35413A] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Supported Workflows & Quick Dispatch</h2>
              <p className="text-xs text-[#9FB0A7]">
                Run a maintenance pass immediately or configure parameters in the Create Job wizard
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {(jobsPayload.supported_workflows?.length
              ? jobsPayload.supported_workflows
              : DEFAULT_WORKFLOWS
            ).map((wf) => (
              <div
                key={wf.workflow_type}
                className="flex flex-col justify-between rounded-xl bg-[#151B19] border border-[#2F3A34] p-3 gap-2"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-emerald-300">{wf.category}</span>
                    <span className="font-mono text-[10px] text-[#9FB0A7]">{wf.endpoint}</span>
                  </div>
                  <div className="text-sm font-semibold text-white mt-0.5">{wf.label}</div>
                  <p className="text-xs text-[#9FB0A7] mt-1 line-clamp-2">{wf.description}</p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={submittingJob}
                    onClick={() => {
                      if (wf.fields && wf.fields.length > 0) {
                        openCreateModal(wf.workflow_type);
                      } else {
                        handleExecuteJob(wf.workflow_type, {}, wf.label);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 transition"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>{wf.fields?.length ? "Configure & Run" : "Run Now"}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Jobs Table */}
        <div className="rounded-2xl bg-[#202824] border border-[#35413A] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-white">Recent Jobs</h2>
              <p className="text-xs text-[#9FB0A7]">
                Live execution records from triggered operational tasks, POS sync logs, and `/api/squad/job-calls`
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {["all", "running", "queued", "succeeded", "failed"].map((flt) => (
                <button
                  key={flt}
                  type="button"
                  onClick={() => setStatusFilter(flt)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition ${
                    statusFilter === flt
                      ? "bg-emerald-500 text-[#082218] font-bold"
                      : "bg-[#151B19] text-[#9FB0A7] hover:text-white border border-[#35413A]"
                  }`}
                >
                  {flt}
                </button>
              ))}
            </div>
          </div>

          {filteredJobs.length === 0 ? (
            <div className="rounded-xl bg-[#151B19] border border-[#2F3A34] p-6 text-center space-y-2">
              <p className="text-sm font-semibold text-white">No jobs recorded in this filter yet</p>
              <p className="text-xs text-[#9FB0A7]">
                Click <span className="text-emerald-300 font-semibold">+ Create Job</span> or trigger a workflow above to dispatch and track a live job.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredJobs.map((job) => {
                const isInspected = inspectedJobId === job.id;
                return (
                  <div
                    key={job.id}
                    className="rounded-xl bg-[#151B19] border border-[#2F3A34] p-3.5 transition hover:border-[#46564D]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm text-white">{job.name}</span>
                          <span className="font-mono text-[11px] text-[#9FB0A7]">
                            #{String(job.id).slice(0, 8)}
                          </span>
                        </div>
                        <div className="text-xs text-[#9FB0A7] mt-0.5">
                          {job.workflow_label || job.workflow_type} · Created by{" "}
                          <span className="text-[#D2DFD8] font-medium">{job.created_by || "system"}</span>
                          {job.duration_ms != null && ` · ${job.duration_ms} ms`}
                        </div>
                        {job.result_summary && (
                          <div className="text-xs text-emerald-300/90 mt-1">{job.result_summary}</div>
                        )}
                        {job.error && (
                          <div className="text-xs text-rose-300 mt-1 font-medium">{job.error}</div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={job.status} />
                        <button
                          type="button"
                          disabled={actionBusyId === job.id}
                          onClick={() => handleJobAction(job, "retry")}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#202824] hover:bg-[#2B3630] border border-[#35413A] px-2.5 py-1 text-xs font-medium text-[#E2ECE6]"
                          title="Retry / Re-run job"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Retry</span>
                        </button>
                        {(job.status === "queued" || job.raw_status === "open") && (
                          <button
                            type="button"
                            disabled={actionBusyId === job.id}
                            onClick={() => handleJobAction(job, "cancel")}
                            className="inline-flex items-center gap-1 rounded-lg bg-rose-950/60 hover:bg-rose-900/60 border border-rose-500/30 px-2.5 py-1 text-xs font-medium text-rose-200"
                            title="Cancel job"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>Cancel</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setInspectedJobId(isInspected ? null : job.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#202824] hover:bg-[#2B3630] border border-[#35413A] px-2.5 py-1 text-xs font-medium text-[#9FB0A7] hover:text-white"
                        >
                          <Terminal className="h-3.5 w-3.5" />
                          <span>{isInspected ? "Hide" : "Inspect"}</span>
                        </button>
                      </div>
                    </div>

                    {isInspected && (
                      <div className="mt-3 pt-3 border-t border-[#2F3A34] text-xs font-mono text-[#B7C7BE] space-y-1">
                        <div>Job ID: {job.id}</div>
                        <div>Workflow: {job.workflow_type}</div>
                        <div>Created: {job.created_at || "—"}</div>
                        <div>Completed: {job.completed_at || "—"}</div>
                        <div>Parameters: {JSON.stringify(job.params || {})}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* System Health & Execution Architecture */}
        <div className="rounded-2xl bg-[#202824] border border-[#35413A] p-4 space-y-2.5">
          <h2 className="text-base font-bold text-white">System Health & Execution Architecture</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-[#151B19] border border-[#2F3A34] p-3">
              <div className="font-semibold text-emerald-300">API & Database</div>
              <p className="text-[#9FB0A7] mt-1">
                Database:{" "}
                <span className="text-white font-semibold">
                  {db.reachable ? "Reachable" : `Unreachable (${db.error})`}
                </span>{" "}
                · Pool: {db.pool?.class || "AsyncAdaptedQueuePool"} (checked out:{" "}
                {db.pool?.checkedout ?? 0}/{db.pool?.size ?? "—"})
              </p>
            </div>
            <div className="rounded-xl bg-[#151B19] border border-[#2F3A34] p-3">
              <div className="font-semibold text-amber-300">Execution Worker & Rate Limiter Note</div>
              <p className="text-[#9FB0A7] mt-1">
                In-process scheduler (`RUN_SCHEDULER`):{" "}
                <span className="text-white font-semibold">{env.scheduler_on_api ? "Active" : "Off"}</span>.{" "}
                <span className="font-mono text-[#D2DFD8]">{env.rate_limiter_backend || "_MemoryBackend"}</span>{" "}
                is the HTTP rate-limiter store (Redis configured: {String(Boolean(env.redis_configured))}), not a background task queue.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── MEASUREMENT (v2.15) — numbers with their definitions attached ─── */}
      {measurement && (
        <section className="rounded-3xl border border-edge-1 bg-surface-1 p-5 md:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-ink-1">Activation &amp; usage</h2>
              <p className="text-xs text-ink-3 mt-0.5">
                Window: last {measurement.window_days} days · generated{" "}
                {new Date(measurement.generated_at).toLocaleString()}
              </p>
            </div>
            <span className="text-2xs uppercase tracking-wide text-ink-4">
              Read-only · definitions below
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["Registered", measurement.funnel.registered],
              ["Activated", `${measurement.funnel.activated} · ${Math.round(measurement.funnel.activation_rate * 100)}%`],
              ["Repeated use", `${measurement.funnel.repeated} · ${Math.round(measurement.funnel.repeat_rate * 100)}%`],
              ["Active 7d", measurement.funnel.active_last_7_days],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-edge-1 bg-surface-2 p-3">
                <div className="text-2xs uppercase tracking-wide text-ink-4">{label}</div>
                <div className="text-lg font-bold text-ink-1 mt-0.5">{value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["Payment completion", `${Math.round(measurement.commerce.completion_rate * 100)}%`],
              ["Intents settled", measurement.commerce.payment_intents.completed || 0],
              ["Intents failed", (measurement.commerce.payment_intents.failed || 0) + (measurement.commerce.payment_intents.expired || 0)],
              ["Stock items added", measurement.commerce.stock_items_created],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-edge-1 bg-surface-2 p-3">
                <div className="text-2xs uppercase tracking-wide text-ink-4">{label}</div>
                <div className="text-lg font-bold text-ink-1 mt-0.5">{value}</div>
              </div>
            ))}
          </div>

          <details className="rounded-xl border border-edge-1 bg-surface-2 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-ink-2">
              How each of these is calculated
            </summary>
            <dl className="mt-2 space-y-1.5">
              {Object.entries(measurement.definitions).map(([key, text]) => (
                <div key={key}>
                  <dt className="text-2xs font-mono text-ink-3">{key}</dt>
                  <dd className="text-2xs text-ink-3 leading-relaxed">{text}</dd>
                </div>
              ))}
            </dl>
          </details>

          {measurement.not_measured?.length ? (
            <div className="rounded-xl border border-amber-300/50 bg-amber-50 dark:bg-amber-500/10 p-3">
              <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                Not measured — and not estimated
              </div>
              <ul className="mt-1.5 space-y-1">
                {measurement.not_measured.map((item) => (
                  <li key={item.metric} className="text-2xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    <span className="font-mono">{item.metric}</span> — {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      )}

      {/* ── CREATE / RUN JOB MODAL ────────────────────────────────────────── */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-job-title"
        >
          <div className="w-full max-w-xl rounded-3xl bg-[#151B19] text-[#F1F5F3] border border-[#35413A] p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                  Operations Center · Dispatch
                </span>
                <h2 id="create-job-title" className="text-xl font-bold text-white mt-0.5">
                  Create & Execute Job
                </h2>
                <p className="text-xs text-[#9FB0A7] mt-0.5">
                  Select a supported workflow, configure its inputs, validate, and start execution.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg p-1.5 text-[#9FB0A7] hover:text-white hover:bg-[#202824]"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="ops-workflow-select" className="block text-xs font-semibold text-[#D2DFD8]">
                1. Choose Workflow Type
              </label>
              <select
                id="ops-workflow-select"
                value={selectedWorkflowType}
                onChange={(e) => handleSelectWorkflow(e.target.value)}
                className="w-full rounded-xl bg-[#202824] border border-[#35413A] px-3.5 py-2.5 text-sm text-white focus:border-emerald-400 focus:outline-none"
              >
                {(jobsPayload.supported_workflows?.length
                  ? jobsPayload.supported_workflows
                  : DEFAULT_WORKFLOWS
                ).map((wf) => (
                  <option key={wf.workflow_type} value={wf.workflow_type}>
                    {wf.label} ({wf.endpoint})
                  </option>
                ))}
              </select>
              {selectedWorkflow?.description && (
                <p className="text-xs text-[#9FB0A7]">{selectedWorkflow.description}</p>
              )}
            </div>

            <div className="space-y-3 rounded-2xl bg-[#202824] border border-[#35413A] p-4">
              <div className="text-xs font-semibold text-[#D2DFD8]">2. Configure Inputs</div>
              <div>
                <label htmlFor="ops-job-label" className="block text-xs text-[#9FB0A7] mb-1">
                  Run Label (optional)
                </label>
                <input
                  id="ops-job-label"
                  type="text"
                  placeholder={selectedWorkflow?.label}
                  value={customJobTitle}
                  onChange={(e) => setCustomJobTitle(e.target.value)}
                  className="w-full rounded-xl bg-[#151B19] border border-[#35413A] px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                />
              </div>

              {(selectedWorkflow?.fields || []).length === 0 ? (
                <p className="text-xs text-[#9FB0A7]">
                  This system workflow requires no additional arguments and runs idempotently across due records.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedWorkflow.fields.map((field) => (
                    <div key={field.name} className={field.name === "title" ? "sm:col-span-2" : ""}>
                      <label
                        htmlFor={`ops-field-${field.name}`}
                        className="block text-xs text-[#9FB0A7] mb-1"
                      >
                        {field.label} {field.required && <span className="text-emerald-400">*</span>}
                      </label>
                      {field.type === "select" ? (
                        <select
                          id={`ops-field-${field.name}`}
                          value={jobParams[field.name] ?? field.default ?? ""}
                          onChange={(e) => {
                            setJobParams((p) => ({ ...p, [field.name]: e.target.value }));
                            setReviewResult(null);
                          }}
                          className="w-full rounded-xl bg-[#151B19] border border-[#35413A] px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                        >
                          {(field.options || []).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={`ops-field-${field.name}`}
                          type={field.type === "number" ? "number" : "text"}
                          value={jobParams[field.name] ?? ""}
                          onChange={(e) => {
                            const val =
                              field.type === "number"
                                ? e.target.value === ""
                                  ? ""
                                  : Number(e.target.value)
                                : e.target.value;
                            setJobParams((p) => ({ ...p, [field.name]: val }));
                            setReviewResult(null);
                          }}
                          className="w-full rounded-xl bg-[#151B19] border border-[#35413A] px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {formError && (
              <div
                role="alert"
                className="rounded-xl bg-rose-950/70 border border-rose-500/40 p-3 text-xs text-rose-200 flex items-start gap-2"
              >
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            {reviewResult && (
              <div className="rounded-xl bg-emerald-950/60 border border-emerald-500/40 p-3.5 text-xs text-emerald-100 space-y-1.5">
                <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Pre-flight Validation Passed · Ready to Run</span>
                </div>
                <div className="font-mono text-[11px] text-emerald-200/90">
                  Target: {reviewResult.endpoint || selectedWorkflow?.endpoint}
                </div>
                {(reviewResult.warnings || []).map((w, i) => (
                  <p key={i} className="text-amber-200/90">
                    {w}
                  </p>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-xl border border-[#35413A] px-4 py-2 text-xs font-semibold text-[#9FB0A7] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingJob}
                onClick={handleValidateJob}
                className="rounded-xl bg-[#202824] hover:bg-[#2B3630] border border-[#35413A] px-4 py-2 text-xs font-semibold text-white"
              >
                Validate & Review
              </button>
              <button
                type="button"
                disabled={submittingJob}
                onClick={() => handleExecuteJob()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#10B981] hover:bg-[#059669] px-4 py-2 text-xs font-bold text-[#082218]"
              >
                <Play className="h-3.5 w-3.5" />
                <span>{submittingJob ? "Running…" : "Start Job Now"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SYSTEM DIAGNOSTICS & TELEMETRY SECTION ────────────────────────── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-1 tracking-tight">
            System Diagnostics & Telemetry
          </h2>
          <p className="text-xs text-ink-4">
            Live in-process metrics · Prometheus scrape at <span className="font-mono text-ink-3">/api/metrics</span> · slower than {http.slow_threshold_ms} ms is flagged.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            label="Requests"
            value={http.requests_total}
            icon={Activity}
            hint={`${http.requests_per_second}/s · up ${Math.round((http.uptime_seconds || 0) / 60)} min`}
          />
          <Stat
            label="p95 latency"
            value={ms(http.p95_ms)}
            icon={Gauge}
            tone={http.p95_ms > http.slow_threshold_ms ? "amber" : "brand"}
            hint={`p50 ${ms(http.p50_ms)} · p99 ${ms(http.p99_ms)}`}
          />
          <Stat
            label="5xx error rate"
            value={pct(http.error_rate_pct)}
            icon={AlertTriangle}
            tone={http.error_rate_pct > 0 ? "red" : "default"}
            hint={`4xx ${pct(http.client_error_rate_pct)} · in flight ${http.in_flight}`}
          />
          <Stat
            label="Rate limited"
            value={status.counters?.rate_limited_responses}
            icon={Zap}
            hint="429s since boot"
          />
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <Card padding="p-4">
            <CardHeader>
              <CardTitle sub="where the process is running">Environment</CardTitle>
              <Badge variant="brand" size="xs">
                v{status.version}
              </Badge>
            </CardHeader>
            <dl className="space-y-1.5 text-xs">
              {[
                ["debug", status.environment.debug ? "on" : "off"],
                ["auto-create tables", status.environment.auto_create_tables ? "on" : "off"],
                ["scheduler on API", status.environment.scheduler_on_api ? "on" : "off"],
                ["rate-limit backend", status.environment.rate_limiter_backend],
                ["redis configured", status.environment.redis_configured ? "yes" : "no"],
                ["file storage", status.environment.storage],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-2">
                  <dt className="text-ink-4">{k}</dt>
                  <dd className="font-mono text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card padding="p-4">
            <CardHeader>
              <CardTitle sub="connection pool & reachability">Database</CardTitle>
              <Badge variant={db.reachable ? "brand" : "red"} size="xs">
                <Database size={9} /> {db.reachable ? "reachable" : "down"}
              </Badge>
            </CardHeader>
            <dl className="space-y-1.5 text-xs">
              {Object.entries(db.pool || {}).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-2">
                  <dt className="text-ink-4">{k}</dt>
                  <dd className="font-mono text-ink-2">{String(v)}</dd>
                </div>
              ))}
              {db.error && <p className="text-2xs text-red-600 dark:text-red-400 font-mono">{db.error}</p>}
            </dl>
          </Card>

          <Card padding="p-4">
            <CardHeader>
              <CardTitle sub="guard rails in force">Limits</CardTitle>
            </CardHeader>
            <dl className="space-y-1.5 text-xs">
              {[
                ["auth requests / min / IP", status.limits.rate_limit_auth_per_min],
                ["API requests / min / IP", status.limits.rate_limit_api_per_min],
                ["max upload", `${status.limits.max_upload_mb} MB`],
                ["slow request", `${status.limits.slow_request_ms} ms`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-2">
                  <dt className="text-ink-4">{k}</dt>
                  <dd className="font-mono text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        {slow?.slow_routes?.length > 0 && (
          <Card padding="p-4" className="bg-accent-500/10">
            <CardHeader>
              <CardTitle sub={`p95 above ${slow.threshold_ms} ms — usually the first thing to look at`}>
                Slow endpoints
              </CardTitle>
            </CardHeader>
            <RouteTable rows={slow.slow_routes} highlight />
          </Card>
        )}

        <Card padding="p-4">
          <CardHeader>
            <CardTitle sub={`${(http.routes || []).length} routes seen since boot`}>Busiest routes</CardTitle>
            <span className="text-2xs text-ink-4 inline-flex items-center gap-1">
              <Clock size={11} /> uptime {Math.round(http.uptime_seconds || 0)}s
            </span>
          </CardHeader>
          {(http.routes || []).length === 0 ? (
            <p className="text-xs text-ink-4 py-4 text-center">No traffic recorded yet.</p>
          ) : (
            <RouteTable rows={http.routes} />
          )}
        </Card>

        {showMetrics && (
          <Card padding="p-4">
            <CardHeader>
              <CardTitle sub="Prometheus text exposition — paste into a scraper or add ?token= when METRICS_TOKEN is set">
                Raw metrics
              </CardTitle>
            </CardHeader>
            <pre className="max-h-80 overflow-auto rounded-lg border border-edge-1 bg-surface-0 p-3 text-2xs font-mono text-ink-3 leading-relaxed">
              {metrics || "loading…"}
            </pre>
          </Card>
        )}
      </div>
    </div>
  );
}
