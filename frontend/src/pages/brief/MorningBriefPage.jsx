import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ChevronRight, Clock, FileWarning, PackageX, RefreshCw, Sunrise, WifiOff,
} from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import { briefAPI, apiError } from "@/lib/api";
import { useCachedResource } from "@/lib/offline";
import { useAuthStore } from "@/stores/authStore";

/**
 * MORNING BRIEF — what needs your attention today (v2.15).
 *
 * Every line here is derived from a record you own, and says so: the signal
 * carries the ids it was built from and the route that opens them. There is no
 * generated text, no model, and nothing on this screen can move money, stock or
 * a permission.
 *
 * States this screen must handle, in order of likelihood on a Kenyan network:
 * loading, offline-with-cache, empty (a real answer, not an error), populated,
 * failed-with-cache (stale), and failed-with-nothing (retryable).
 */

const KIND_META = {
  low_stock: { icon: PackageX, tone: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-500/10" },
  receivables: { icon: Sunrise, tone: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/10" },
  pending_movements: { icon: Clock, tone: "text-sky-600 dark:text-sky-400", bg: "bg-sky-50 dark:bg-sky-500/10" },
  expiring_claims: { icon: FileWarning, tone: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-500/10" },
  open_requests: { icon: Sunrise, tone: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/10" },
};

const SEVERITY_LABEL = { critical: "Needs you now", warning: "Worth doing", info: "When you have time" };

/** A retained copy is only "current" for a short while; after that, say so. */
const STALE_AFTER_MS = 15 * 60 * 1000;

const isStale = (iso) => {
  const then = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(then) || Date.now() - then > STALE_AFTER_MS;
};

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
  const accountId = useAuthStore((state) => state.vendor?.id);

  const fetcher = useCallback(async () => {
    const { data } = await briefAPI.morning();
    return data;
  }, []);

  const { data: brief, savedAt, fromCache, online, error, loading, reload } = useCachedResource({
    name: "brief",
    accountId,
    fetcher,
    errorFallback: (err) => apiError(err, "Could not load your brief"),
  });

  if (loading && !brief) return <PageSpinner label="Reading your records…" />;

  const offline = !online;
  const staleCopy = Boolean(brief && (fromCache || error));

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
        <Button
          variant="ghost"
          size="sm"
          onClick={reload}
          disabled={loading || offline}
          aria-label="Refresh brief"
          title={offline ? "Reconnect to refresh" : undefined}
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      {/* Offline is a state, not an error: the records are not wrong, the radio is. */}
      {offline && (
        <Card className="border-amber-300/70 dark:border-amber-500/40" >
          <div className="flex items-start gap-2.5">
            <WifiOff size={18} className="text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-1">You are offline</p>
              <p className="text-2xs text-ink-3 mt-0.5 leading-relaxed">
                {brief
                  ? `Showing the copy saved on this device${savedAt ? ` at ${new Date(savedAt).toLocaleString()}` : ""}. Counts may have moved since — they will be checked when you reconnect.`
                  : "Nothing saved on this device yet. Reconnect to read your brief for the first time."}
              </p>
              {!brief && (
                <Button size="sm" variant="secondary" className="mt-2" onClick={reload}>
                  Try again
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Failed with nothing cached: the only honest thing is a retry. */}
      {error && !brief && (
        <Card className="border-rose-200 dark:border-rose-500/30">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-1">The brief could not be loaded</p>
              <p className="text-2xs text-ink-3 mt-0.5">{error}</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={reload}>Try again</Button>
            </div>
          </div>
        </Card>
      )}

      {/* A retained brief after a failed refresh is a snapshot, not a live view. */}
      {error && brief && !offline && (
        <Card className="border-amber-200 dark:border-amber-500/30">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-1">
                Could not refresh — showing your last brief
              </p>
              <p className="text-2xs text-ink-3 mt-0.5">
                Generated {brief.generated_at ? new Date(brief.generated_at).toLocaleString() : "earlier"}
                {" · "}counts may have moved since. {error}
              </p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={reload} disabled={loading}>
                Retry
              </Button>
            </div>
          </div>
        </Card>
      )}

      {brief && !staleCopy && isStale(brief.generated_at) && (
        <p className="text-micro text-amber-700 dark:text-amber-400 px-1">
          This brief was generated {brief.generated_at ? new Date(brief.generated_at).toLocaleString() : "earlier"}.
          Refresh before acting on it.
        </p>
      )}

      {brief?.empty && (
        <Card>
          <EmptyState
            title="Nothing needs you today"
            description="No low stock, no movements waiting, no paperwork expiring. New activity will appear here as it happens."
          />
        </Card>
      )}

      {brief?.signals?.map((signal) => {
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
