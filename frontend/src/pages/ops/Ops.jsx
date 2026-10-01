import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Clock, Database, Download, Gauge, RefreshCw, Server, Zap } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Stat from "@/components/ui/Stat";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { opsAPI, apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const ms = (n) => (n === null || n === undefined ? "—" : `${n} ms`);
const pct = (n) => (n === null || n === undefined ? "—" : `${n}%`);

/**
 * Ops console (v2.1 §6.2). Reads the in-process registry behind `/api/metrics`
 * and `/api/ops/*`: latency percentiles, error rates, pool health and config
 * facts — enough to answer "is it slow, is it down, and what changed?" without
 * a sidecar, plus the raw Prometheus text for a real scrape target.
 */
export default function Ops() {
  const [status, setStatus] = useState(null);
  const [slow, setSlow] = useState(null);
  const [metrics, setMetrics] = useState("");
  const [showMetrics, setShowMetrics] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [s, sl] = await Promise.all([opsAPI.status(), opsAPI.slow()]);
      setStatus(s.data);
      setSlow(sl.data);
    } catch (e) {
      toast.error(apiError(e, "Couldn't read the ops status"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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

  if (loading && !status) return <PageSpinner label="Reading the metrics registry…" />;
  if (!status) {
    return <EmptyState icon={Server} title="Ops status unavailable" description="The API answered nothing — check that the backend is up." action={<Button size="sm" onClick={load}>Retry</Button>} />;
  }

  const http = status.http;
  const db = status.database;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Ops & monitoring</h2>
          <p className="text-xs text-ink-4">
            Live in-process metrics · Prometheus scrape at <span className="font-mono text-ink-3">/api/metrics</span> · slower than {http.slow_threshold_ms} ms is flagged.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={RefreshCw} onClick={load} loading={loading}>
            Refresh
          </Button>
          <Button size="sm" variant="secondary" icon={Download} onClick={revealMetrics}>
            {showMetrics ? "Hide" : "Raw scrape"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Requests" value={http.requests_total} icon={Activity} hint={`${http.requests_per_second}/s · up ${Math.round(http.uptime_seconds / 60)} min`} />
        <Stat label="p95 latency" value={ms(http.p95_ms)} icon={Gauge} tone={http.p95_ms > http.slow_threshold_ms ? "amber" : "brand"}
              hint={`p50 ${ms(http.p50_ms)} · p99 ${ms(http.p99_ms)}`} />
        <Stat label="5xx error rate" value={pct(http.error_rate_pct)} icon={AlertTriangle} tone={http.error_rate_pct > 0 ? "red" : "default"}
              hint={`4xx ${pct(http.client_error_rate_pct)} · in flight ${http.in_flight}`} />
        <Stat label="Rate limited" value={status.counters.rate_limited_responses} icon={Zap} hint="429s since boot" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card padding="p-4">
          <CardHeader>
            <CardTitle sub="where the process is running">Environment</CardTitle>
            <Badge variant="brand" size="xs">v{status.version}</Badge>
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
            {db.error && <p className="text-2xs text-red-400 font-mono">{db.error}</p>}
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
        <Card padding="p-4" className="bg-amber-500/[0.05]">
          <CardHeader>
            <CardTitle sub={`p95 above ${slow.threshold_ms} ms — usually the first thing to look at`}>Slow endpoints</CardTitle>
          </CardHeader>
          <RouteTable rows={slow.slow_routes} highlight />
        </Card>
      )}

      <Card padding="p-4">
        <CardHeader>
          <CardTitle sub={`${http.routes.length} routes seen since boot`}>Busiest routes</CardTitle>
          <span className="text-2xs text-ink-4 inline-flex items-center gap-1">
            <Clock size={11} /> uptime {Math.round(http.uptime_seconds)}s
          </span>
        </CardHeader>
        {http.routes.length === 0 ? (
          <p className="text-xs text-ink-4 py-4 text-center">No traffic recorded yet.</p>
        ) : (
          <RouteTable rows={http.routes} />
        )}
      </Card>

      {showMetrics && (
        <Card padding="p-4">
          <CardHeader>
            <CardTitle sub="Prometheus text exposition — paste into a scraper or add ?token= when METRICS_TOKEN is set">Raw metrics</CardTitle>
          </CardHeader>
          <pre className="max-h-80 overflow-auto rounded-lg border border-edge-1 bg-surface-0 p-3 text-2xs font-mono text-ink-3 leading-relaxed">
            {metrics || "loading…"}
          </pre>
        </Card>
      )}
    </div>
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
          {rows.map((r) => (
            <tr key={r.path} className="border-t border-edge-1">
              <td className="py-1.5 pr-3 text-ink-2 truncate max-w-[22rem]">{r.path}</td>
              <td className="py-1.5 text-right text-ink-3">{r.requests}</td>
              <td className="py-1.5 text-right text-ink-3">{r.avg_ms}</td>
              <td className="py-1.5 text-right text-ink-3">{r.p50_ms}</td>
              <td className={cn("py-1.5 text-right", highlight ? "text-amber-300" : "text-ink-3")}>{r.p95_ms}</td>
              <td className="py-1.5 text-right text-ink-3">{r.max_ms}</td>
              <td className={cn("py-1.5 text-right", r.errors > 0 ? "text-red-400" : "text-ink-4")}>{r.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
