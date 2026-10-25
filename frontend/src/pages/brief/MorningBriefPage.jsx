import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ChevronRight, Clock, FileWarning, PackageX, RefreshCw, Sunrise,
} from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import { briefAPI, apiError } from "@/lib/api";

/**
 * MORNING BRIEF — what needs your attention today (v2.15).
 *
 * Every line here is derived from a record you own, and says so: the signal
 * carries the ids it was built from and the route that opens them. There is no
 * generated text, no model, and nothing on this screen can move money, stock or
 * a permission.
 *
 * States the screen must handle, in order of likelihood on a Kenyan network:
 * loading, offline/failed (retryable), empty (a real answer, not an error),
 * and populated.
 */

const KIND_META = {
  low_stock: { icon: PackageX, tone: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-500/10" },
  pending_movements: { icon: Clock, tone: "text-sky-600 dark:text-sky-400", bg: "bg-sky-50 dark:bg-sky-500/10" },
  expiring_claims: { icon: FileWarning, tone: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-500/10" },
  open_requests: { icon: Sunrise, tone: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/10" },
};

const SEVERITY_LABEL = { critical: "Needs you now", warning: "Worth doing", info: "When you have time" };

function timeAgo(iso) {
  if (!iso) return "no timestamp on the record";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "no timestamp on the record";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export default function MorningBriefPage() {
  const navigate = useNavigate();
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await briefAPI.morning();
      setBrief(data);
    } catch (err) {
      setError(apiError(err, "Could not load your brief"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !brief) return <PageSpinner label="Reading your records…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xs uppercase tracking-wide text-ink-4">Your business · today</p>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-1">Good morning.</h1>
          <p className="text-sm text-ink-3 mt-0.5">
            {brief?.empty
              ? "Nothing needs your attention right now."
              : "Here is what needs your attention — each line links to its record."}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} aria-label="Refresh brief">
          <RefreshCw size={15} className={loading ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-rose-200 dark:border-rose-500/30">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-1">The brief could not be loaded</p>
              <p className="text-2xs text-ink-3 mt-0.5">{error}</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={load}>Try again</Button>
            </div>
          </div>
        </Card>
      )}

      {!error && brief?.empty && (
        <Card>
          <EmptyState
            title="Nothing needs you today"
            description="No low stock, no movements waiting, no paperwork expiring. New activity will appear here as it happens."
          />
        </Card>
      )}

      {!error && brief?.signals?.map((signal) => {
        const meta = KIND_META[signal.kind] || KIND_META.open_requests;
        const Icon = meta.icon;
        return (
          <Card
            key={signal.id}
            hover
            onClick={() => navigate(signal.route)}
            className="w-full text-left"
          >
            <div className="flex items-start gap-3">
              <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${meta.bg}`}>
                <Icon size={17} className={meta.tone} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-ink-1">{signal.title}</p>
                  <span className="text-micro uppercase tracking-wide text-ink-4">
                    {SEVERITY_LABEL[signal.severity] || signal.severity}
                  </span>
                </div>
                <p className="text-2xs text-ink-3 mt-0.5 leading-relaxed">{signal.detail}</p>
                {/* Evidence: the provenance is the feature, so it is visible. */}
                <p className="text-micro text-ink-4 mt-1.5">
                  {signal.count} record{signal.count === 1 ? "" : "s"}
                  {signal.record_ids?.length ? ` · ${signal.record_ids.length} cited` : ""}
                  {" · "}{timeAgo(signal.occurred_at)}
                </p>
              </div>
              <ChevronRight size={16} className="text-ink-4 shrink-0 mt-1" aria-hidden="true" />
            </div>
          </Card>
        );
      })}

      {brief && (
        <p className="text-micro text-ink-4 leading-relaxed px-1">
          {brief.note}
          {brief.generated_at ? ` Generated ${new Date(brief.generated_at).toLocaleString()}.` : ""}
        </p>
      )}
    </div>
  );
}
