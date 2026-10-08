import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Swords, ListChecks, Trophy, Briefcase, MapPin, Star, ArrowUpRight, Zap, Medal,
} from "lucide-react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { squadAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// TASKS PORTAL — the one home-screen door into the task loops.
//
// The loop is Call-up → Contract → Match → Reward → Upgrade → League. This
// page is where you enter it from Home: your active match, the open call-ups
// near you (accept in place), your recent wins, and the doors into the full
// Squad league and the Brief workspace. Every row is a real row; a loop with
// nothing in it says so.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_TONE = {
  accepted: "text-amber-300", in_progress: "text-blue-300", proof_pending: "text-amber-300",
  completed: "text-brand-300", cancelled: "text-red-300",
};

const SKILL_LABEL = {
  cleaner: "Cleaner", fundi: "Fundi", rider: "Rider", tutor: "Tutor", cook: "Cook",
  digital: "Digital", gardener: "Gardener", mover: "Mover", sitter: "Sitter",
  shopper: "Shopper", queue: "Queue", errand: "Errand",
};

export default function TasksPortal() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [calls, setCalls] = useState(null);
  const [wins, setWins] = useState(null);
  const [accepting, setAccepting] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    squadAPI.me().then((r) => setMe(r.data)).catch((e) => setError(apiError(e, "The task board could not be loaded")));
    squadAPI.calls().then((r) => setCalls(r.data.calls)).catch(() => {});
    squadAPI.recent().then((r) => setWins(r.data.wins)).catch(() => {});
  }, []);

  useEffect(load, [load]);

  const accept = async (call) => {
    setAccepting(call.id);
    try {
      await squadAPI.accept(call.id);
      toast.success(`Contract signed — ${call.title}`);
      load();
    } catch (e) {
      toast.error(apiError(e, "That contract could not be accepted"));
    } finally {
      setAccepting(null);
    }
  };

  if (error) return <EmptyState icon={Swords} title="The task board is down" description={error} />;
  if (!me) return <PageSpinner label="Dealing your tasks…" />;

  const active = me.active_contract;
  const openCalls = (calls || []).filter((c) => c.status === "open" && !c.mine).slice(0, 6);
  const recent = (wins || []).slice(0, 3);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink-1 tracking-tight">Tasks</h2>
        <p className="text-xs text-ink-4 mt-0.5">One door into the work loops — call-up → contract → match → reward.</p>
      </div>

      {/* ── Active match ── */}
      {active ? (
        <div className="glass-strong rounded-3xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Medal size={14} className="text-brand-300" />
            <p className="text-2xs uppercase tracking-[0.2em] text-ink-4 font-bold">Match in hand</p>
            <span className={cn("ml-auto text-2xs font-bold uppercase tracking-wide", STATUS_TONE[active.status] || "text-ink-4")}>
              {active.status.replaceAll("_", " ")}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-ink-1 truncate">{active.title}</p>
              <p className="text-2xs text-ink-4 mt-0.5 truncate">
                {active.i_am_player ? `for ${active.client_name}` : `worker: ${active.player_name}`}
                {active.location ? ` · ${active.location}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="digital text-lg text-ink-1">KES {num(active.pay_kes)}</p>
              <p className="text-2xs text-ink-4">agreed</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => navigate("/tasks/squad")}>
              Continue in Squad <ArrowUpRight size={12} />
            </Button>
          </div>
        </div>
      ) : (
        <div className="glass rounded-2xl p-4">
          <p className="text-sm font-medium text-ink-2 flex items-center gap-2"><ListChecks size={14} className="text-ink-4" /> No match in hand</p>
          <p className="text-2xs text-ink-4 mt-1">Accept a call-up below and it becomes your contract: start it, finish it with proof, get paid.</p>
        </div>
      )}

      {/* ── Open call-ups near you ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Zap size={13} className="text-amber-300" />
          <p className="text-2xs uppercase tracking-[0.2em] text-ink-4 font-bold">Open call-ups near you</p>
          <button type="button" onClick={() => navigate("/tasks/squad")} className="ml-auto text-2xs font-bold text-brand-300 hover:text-brand-200 cursor-pointer">
            all call-ups
          </button>
        </div>
        {calls === null ? (
          <PageSpinner />
        ) : openCalls.length === 0 ? (
          <div className="glass rounded-2xl p-4">
            <p className="text-sm font-medium text-ink-2">No open call-ups right now</p>
            <p className="text-2xs text-ink-4 mt-1">Clients post paid tasks here. You can post one yourself from the Squad.</p>
          </div>
        ) : (
          openCalls.map((c) => (
            <div key={c.id} className="glass glass-hover rounded-2xl p-3.5 flex gap-3 items-center animate-fade-in">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-1 truncate">{c.title}</p>
                <p className="text-2xs text-ink-4 mt-0.5 truncate">
                  {SKILL_LABEL[c.skill] || c.skill}
                  {c.required_tier !== "common" ? ` · ${c.required_tier} card` : ""}
                  {c.squad_id ? " · squad mission" : ""}
                  {typeof c.distance_km === "number" ? <span className="inline-flex items-center gap-0.5 ml-1"><MapPin size={9} /> {c.distance_km} km</span> : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="digital text-sm text-ink-1">KES {num(c.pay_kes)}</p>
                <p className="text-2xs text-ink-4">{c.client}</p>
              </div>
              <Button size="sm" variant="secondary" loading={accepting === c.id} onClick={() => accept(c)} className="shrink-0">
                Accept
              </Button>
            </div>
          ))
        )}
      </div>

      {/* ── Recent wins ── */}
      {recent.length > 0 && (
        <div className="space-y-2">
          <p className="text-2xs uppercase tracking-[0.2em] text-ink-4 font-bold flex items-center gap-2">
            <Trophy size={13} className="text-brand-300" /> Recent wins
          </p>
          {recent.map((w) => (
            <div key={w.id} className="glass rounded-2xl p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-1 truncate">{w.title}</p>
                <p className="text-2xs text-ink-4 mt-0.5">
                  {w.completed_at ? relativeTime(w.completed_at) : ""}
                  {w.client_rating ? <span className="inline-flex items-center gap-0.5 ml-1 text-amber-300"><Star size={9} className="fill-amber-300" /> {w.client_rating}.0</span> : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="digital text-sm text-ink-1">KES {num(w.pay_kes)}</p>
                <p className="text-2xs text-ink-4">+{num(w.xp_earned)} XP · +{num(w.gold_earned)} Gold</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── The loop doors ── */}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => navigate("/tasks/squad")}
          className="glass glass-hover rounded-3xl p-4 text-left cursor-pointer">
          <Swords size={16} className="text-brand-300" />
          <p className="text-sm font-semibold text-ink-1 mt-2">Squad</p>
          <p className="text-2xs text-ink-4 mt-0.5">League, divisions, squads & the full match controls</p>
        </button>
        <button type="button" onClick={() => navigate("/tasks/brief")}
          className="glass glass-hover rounded-3xl p-4 text-left cursor-pointer">
          <Briefcase size={16} className="text-amber-300" />
          <p className="text-sm font-semibold text-ink-1 mt-2">Brief</p>
          <p className="text-2xs text-ink-4 mt-0.5">Your workspace — numbers, feed & suggestions</p>
        </button>
      </div>
    </div>
  );
}
