import { useEffect, useState } from "react";
import { Link2, Copy, Check, Users, Box, MapPinned, ListChecks } from "lucide-react";
import MarketRadar from "./MarketRadar";
import { onboardingAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// MY PAGE — the MySpace move, kept honest.
//
// Your profile is a public page others open by handle. The completeness bar
// is computed from fields that exist. The top-connections list is real rows
// with real dates. The market radar is real things within 3 km. Nothing on
// this page is a badge the app decided you deserved.
// ─────────────────────────────────────────────────────────────────────────────

export default function MyPage() {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = () => {
    onboardingAPI.get().then((r) => setData(r.data)).catch((e) => toast.error(apiError(e, "Your page could not be loaded")));
  };
  useEffect(load, []);

  if (!data) return <p className="text-sm text-ink-4 py-8 text-center">Loading your page…</p>;
  const page = data.my_page;

  const copyLink = async () => {
    const url = `${window.location.origin}/@${page.handle}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.success(`Your page: ${url}`);
    }
  };

  return (
    <div className="space-y-3">
      {/* The card others open by handle */}
      <div className="glass-strong rounded-3xl p-5">
        <div className="flex items-center gap-3">
          <span className="w-14 h-14 rounded-2xl bg-brand-500/15 text-brand-600 dark:text-brand-400 flex items-center justify-center text-2xl font-bold shrink-0">
            {(page.name || "?").charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-ink-1 truncate">{page.name}</p>
            <p className="text-2xs text-ink-4 font-mono flex items-center gap-2">
              @{page.handle}
              <button type="button" onClick={copyLink} className="text-ink-4 hover:text-brand-600 dark:hover:text-brand-400 flex items-center gap-1 cursor-pointer" title="Copy your page link">
                {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "copied" : "copy link"}
              </button>
            </p>
          </div>
          <div className="w-24 shrink-0">
            <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-brand-500 to-brand-300" style={{ width: `${Math.round(data.completion * 100)}%` }} />
            </div>
            <p className="text-2xs text-ink-4 mt-1 text-right">{Math.round(data.completion * 100)}% complete</p>
          </div>
        </div>

        {(page.categories.length > 0 || page.location) && (
          <div className="mt-3 flex flex-wrap gap-1.5 items-center">
            {page.categories.map((c) => (
              <span key={c} className="rounded-full bg-surface-2 px-2.5 py-1 text-2xs font-medium text-ink-2 capitalize">{c}</span>
            ))}
            {page.location && <span className="text-2xs text-ink-4">{page.location}</span>}
          </div>
        )}

        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            { icon: Box, label: "stock lines", value: page.stock_lines },
            { icon: MapPinned, label: "places claimed", value: page.places_claimed },
            { icon: Users, label: "connections", value: page.connection_count },
            { icon: Link2, label: "squad", value: page.squad ? 1 : 0 },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-2xl bg-surface-2 py-2.5">
              <Icon size={14} className="mx-auto text-ink-4" />
              <p className="digital text-lg text-ink-1 mt-1">{value === 1 && label === "squad" ? "in" : num(value)}</p>
              <p className="text-2xs text-ink-4">{label}</p>
            </div>
          ))}
        </div>
        {page.squad && <p className="text-2xs text-ink-4 mt-1.5 text-center">in squad · {page.squad}</p>}
      </div>

      {/* First-week steps — the honest checklist */}
      <div className="glass rounded-2xl p-4">
        <p className="text-2xs uppercase tracking-[0.2em] text-ink-4 font-bold flex items-center gap-1.5 mb-2"><ListChecks size={12} /> First week</p>
        <div className="space-y-2">
          {data.steps.map((s) => (
            <div key={s.key} className="flex items-center gap-2.5">
              <span className={cn("w-5 h-5 rounded-full grid place-items-center shrink-0", s.done ? "bg-brand-500/25 text-brand-600 dark:text-brand-400" : "bg-surface-2 text-ink-4")}>
                <Check size={11} />
              </span>
              <p className={cn("text-xs flex-1", s.done ? "text-ink-2" : "text-ink-4")}>
                {s.label}
                {typeof s.have === "number" && !s.done && <span className="font-mono text-ink-4"> · {s.have}/{s.target}</span>}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Top connections — real rows, real dates */}
      <div className="glass rounded-2xl p-4">
        <p className="text-2xs uppercase tracking-[0.2em] text-ink-4 font-bold mb-2">Your top connections</p>
        {page.top_connections.length === 0 ? (
          <p className="text-xs text-ink-4">Nobody yet — connect from the radar below or the Suppliers page.</p>
        ) : (
          <div className="space-y-1.5">
            {page.top_connections.map((c, i) => (
              <div key={c.handle} className="flex items-center gap-2.5">
                <span className="digital text-2xs text-ink-4 w-4">{i + 1}</span>
                <span className="text-xs text-ink-2 flex-1 truncate">{c.name} <span className="text-ink-4 font-mono">@{c.handle}</span></span>
                <span className="text-2xs text-ink-4">since {c.since ? relativeTime(c.since) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Your market — the persistent radar */}
      <div className="glass rounded-2xl p-4">
        <p className="text-2xs uppercase tracking-[0.2em] text-ink-4 font-bold mb-1">Your market · within 3 km</p>
        <MarketRadar nearby={data.nearby} onRefresh={load} compact />
      </div>
    </div>
  );
}
