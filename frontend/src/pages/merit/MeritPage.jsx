import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  BadgeCheck, Copy, Download, HeartHandshake, Info, Lock, Sprout, Trophy, UserPlus,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { meritAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

const TIER_ORDER = ["seed", "verified", "blue_chip"];

/**
 * MERIT — the full record behind the ticker, and the only export that leaves.
 *
 * Everything on this page is a count of something that happened. The one thing
 * it is built to prevent is the reader concluding they are looking at a credit
 * score, so the disclaimer is not fine print: it is a titled section, and the
 * report repeats it in the document itself.
 */
export default function MeritPage() {
  const { handle } = useParams();
  const me = useAuthStore((s) => s.vendor);
  const token = useAuthStore((s) => s.token);
  const own = Boolean(me?.vendor_handle && handle && me.vendor_handle === handle);

  const [card, setCard] = useState(null);
  const [ticker, setTicker] = useState(null);
  const [endorsements, setEndorsements] = useState(null);
  const [mentorships, setMentorships] = useState(null);
  const [concierge, setConcierge] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!handle) return;
    setError("");
    try {
      const { data } = await meritAPI.card(handle);
      setCard(data);
    } catch (err) {
      setError(apiError(err, "Could not load that record."));
      return;
    }
    meritAPI.ticker(handle, 90).then(({ data }) => setTicker(data)).catch(() => {});
    meritAPI.endorsements(handle).then(({ data }) => setEndorsements(data)).catch(() => {});
    if (own && token) {
      meritAPI.mentorships().then(({ data }) => setMentorships(data)).catch(() => {});
      meritAPI.concierge().then(({ data }) => setConcierge(data)).catch(() => {});
    }
  }, [handle, own, token]);

  useEffect(() => {
    load();
  }, [load]);

  const exportReport = async () => {
    setBusy("report");
    try {
      const { data } = await meritAPI.report();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `brief-pattern-report-${data.subject.handle}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Saved to your device. Wasta sent it nowhere.");
    } catch (err) {
      toast.error(apiError(err, "Couldn't build the report."));
    } finally {
      setBusy("");
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <p role="alert" className="text-sm text-red-600">{error}</p>
        <Link to="/" className="mt-3 inline-block text-xs font-bold text-brand-700">Home</Link>
      </div>
    );
  }
  if (!card) return <PageSpinner label="Reading the record…" />;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <header className="space-y-1.5">
        <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
          <BadgeCheck size={13} aria-hidden="true" /> Trust record
        </p>
        <h1 className="text-xl font-semibold text-ink-1">@{handle}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-3">
          Everything below is something this business did, counted. Nothing here is an
          opinion, a rating, or a prediction.
        </p>
      </header>

      <Card padding="p-4" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-micro font-bold uppercase tracking-wide text-ink-4">Trust Score</p>
            <p className="text-3xl font-extrabold tabular-nums text-ink-1">
              {Math.round(card.score)}
              <span className="text-sm font-semibold text-ink-4"> / {card.max_score}</span>
            </p>
            <p className="text-micro text-ink-3">
              {card.score_earned > card.score
                ? `${Math.round(card.score_earned)} earned · ${Math.round(card.decay * 100)}% showing after ${card.quiet_days} quiet days`
                : "Nothing decayed. The record is current."}
            </p>
          </div>
          <Badge variant={card.tier === "blue_chip" ? "brand" : card.tier === "verified" ? "blue" : "gray"}>
            {card.tier_label}
          </Badge>
        </div>

        {card.next_tier && (
          <p className="rounded-lg bg-surface-2 px-2.5 py-2 text-micro leading-relaxed text-ink-3">
            <span className="font-bold text-ink-2">{Math.round(card.points_to_next)} points</span>{" "}
            to the next tier.
            {card.tier === "verified" && (
              <span className="text-ink-4"> Blue Chip also needs evidence in two different areas.</span>
            )}
          </p>
        )}

        <div className="space-y-1.5">
          {card.components.map((c) => (
            <div key={c.key}>
              <div className="flex items-baseline justify-between gap-2 text-micro">
                <span className="font-semibold text-ink-2">{c.label}</span>
                <span className="shrink-0 tabular-nums text-ink-3">
                  {c.points.toFixed(0)} / {c.max_points}
                </span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-3">
                <div
                  className={cn("h-full rounded-full", c.points > 0 ? "bg-brand-500" : "bg-transparent")}
                  style={{ width: `${Math.min(100, (c.points / Math.max(c.max_points, 1)) * 100)}%` }}
                />
              </div>
              <p className="mt-0.5 text-micro leading-relaxed text-ink-4">{c.reason}</p>
            </div>
          ))}
        </div>
      </Card>

      {ticker?.points?.length > 1 && (
        <Card padding="p-3.5" className="space-y-2">
          <p className="text-sm font-semibold text-ink-1">The last readings</p>
          <Sparkline points={ticker.points} />
          <p className="text-micro text-ink-4">{ticker.note}</p>
        </Card>
      )}

      <Card padding="p-4" className="space-y-2">
        <p className="text-sm font-semibold text-ink-1">What this tier unlocks</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {card.tiers.map((t) => {
            const reached = TIER_ORDER.indexOf(t.key) <= TIER_ORDER.indexOf(card.tier);
            return (
              <div
                key={t.key}
                className={cn(
                  "rounded-lg border p-2.5",
                  reached ? "border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10" : "border-edge-1",
                )}
              >
                <p className="flex items-center gap-1 text-micro font-bold text-ink-2">
                  {!reached && <Lock size={10} aria-hidden="true" />}
                  {t.label}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {t.unlocks.map((u) => (
                    <li key={u} className="text-micro leading-relaxed text-ink-3">{u}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="text-micro leading-relaxed text-ink-4">
          Every perk here costs Wasta nothing to give: position, introductions, and a
          document. None of them is money, credit, or a discount we fund.
        </p>
      </Card>

      {endorsements?.endorsements?.length > 0 && (
        <Card padding="p-4" className="space-y-2">
          <p className="text-sm font-semibold text-ink-1">Who vouched, and for what</p>
          <ul className="divide-y divide-edge-1">
            {endorsements.endorsements.map((e) => (
              <li key={e.id} className="py-2">
                <p className="text-xs leading-relaxed text-ink-2">{e.reason}</p>
                <p className="mt-0.5 text-micro text-ink-4">
                  <Link to={`/p/${e.from.handle}`} className="font-bold text-brand-700 hover:underline dark:text-brand-300">
                    {e.from.name}
                  </Link>
                  {e.context ? ` · ${e.context}` : ""} · {e.created_at.slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-micro text-ink-4">{endorsements.note}</p>
        </Card>
      )}

      {own && (
        <>
          <Card padding="p-4" className="space-y-2">
            <p className="text-sm font-semibold text-ink-1">The Pattern Report</p>
            <p className="text-xs leading-relaxed text-ink-3">
              A document about your own history, in your own hands. Take it to a bank, a
              SACCO or anyone else you choose. Wasta speaks to no lender on your behalf and
              makes no decision about you — that is what keeps this a record and not a
              loan application.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={exportReport} disabled={busy === "report"}>
                <Download size={14} aria-hidden="true" />
                {busy === "report" ? "Building…" : "Download my report"}
              </Button>
              <span className="text-micro text-ink-4">JSON. Yours to send.</span>
            </div>
          </Card>

          <ConciergePanel data={concierge} />

          <MentorPanel
            role="mentor"
            data={mentorships}
            reload={load}
            canMentor={card.tier === "blue_chip"}
          />
          <MentorPanel role="mentee" data={mentorships} reload={load} canMentor />
          <EndorsePanel reload={load} />
        </>
      )}

      {!own && token && (
        <EndorsePanel handle={handle} reload={load} />
      )}

      <p className="flex items-start gap-1.5 rounded-card border border-edge-1 bg-surface-1 p-3 text-micro leading-relaxed text-ink-3">
        <Info size={12} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" />
        <span>
          <span className="font-bold text-ink-2">What this is not.</span> A Trust Score is
          not a credit score, not collateral, and not a promise that anyone will be repaid.
          Wasta holds no funds and lends none. A bank that reads the report makes its own
          decision, under its own licence, with its own money.
        </span>
      </p>
    </div>
  );
}

function Sparkline({ points }) {
  const values = points.map((p) => p.score);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const width = 600;
  const height = 60;
  const path = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * width;
      const y = height - ((v - min) / span) * (height - 8) - 4;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full" role="img" aria-label="Trust score over time">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-500" />
    </svg>
  );
}

function ConciergePanel({ data }) {
  if (!data) return null;
  return (
    <Card padding="p-4" className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-1">
        <Trophy size={14} aria-hidden="true" /> Concierge
      </p>
      {data.available ? (
        <>
          <p className="text-xs leading-relaxed text-ink-3">{data.how_it_works}</p>
          <p className="text-micro text-ink-4">{data.note}</p>
        </>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-ink-3">{data.why}</p>
          {data.to_open?.length > 0 && (
            <ul className="space-y-0.5">
              {data.to_open.map((step) => (
                <li key={step} className="text-micro leading-relaxed text-ink-4">· {step}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function MentorPanel({ role, data, reload, canMentor }) {
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = useMemo(
    () => (role === "mentor" ? data?.mentoring : data?.mentored_by) || [],
    [role, data],
  );
  if (!data) return null;

  const start = async () => {
    setBusy(true);
    try {
      await meritAPI.startMentorship(handle.trim().replace(/^@/, ""));
      toast.success("You are mentoring this business. Record a milestone when it happens.");
      setHandle("");
      reload();
    } catch (err) {
      toast.error(apiError(err, "Couldn't start that mentorship."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="p-4" className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-1">
        <HeartHandshake size={14} aria-hidden="true" />
        {role === "mentor" ? "Businesses you are bringing along" : "Who is helping you"}
      </p>
      {rows.length === 0 && (
        <p className="text-xs text-ink-3">
          {role === "mentor"
            ? canMentor
              ? "You are Blue Chip, so you can take a newcomer on. Two at a time, no more."
              : "Mentoring opens at Blue Chip."
            : "Nobody is mentoring this business yet."}
        </p>
      )}
      <ul className="divide-y divide-edge-1">
        {rows.map((m) => (
          <li key={m.id} className="space-y-1 py-2">
            <p className="text-xs font-semibold text-ink-1">
              {role === "mentor" ? m.mentee.name : m.mentor.name}
              <span className="ml-1.5 text-micro font-normal text-ink-4">{m.status}</span>
            </p>
            <div className="flex flex-wrap gap-1">
              {(data.milestones_available || []).map((milestone) => {
                const done = (m.milestones || []).includes(milestone);
                return (
                  <button
                    key={milestone}
                    type="button"
                    disabled={role !== "mentor" || done}
                    onClick={() =>
                      meritAPI
                        .milestone(m.id, milestone)
                        .then(reload)
                        .catch((e) => toast.error(apiError(e, "Couldn't record that.")))
                    }
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-micro font-bold",
                      done
                        ? "border-tech-200 bg-tech-50 text-tech-800 dark:bg-tech-500/10 dark:text-tech-200"
                        : "border-edge-2 text-ink-3",
                      role !== "mentor" && !done && "opacity-60",
                    )}
                  >
                    {done ? "✓ " : ""}
                    {milestone.replace(/_/g, " ")}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {role === "mentor" && canMentor && (
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Business handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" />
          <Button type="button" size="sm" onClick={start} disabled={busy || !handle.trim()}>
            <UserPlus size={13} aria-hidden="true" /> Take them on
          </Button>
        </div>
      )}
      {data.cap_note && <p className="text-micro leading-relaxed text-ink-4">{data.cap_note}</p>}
    </Card>
  );
}

function EndorsePanel({ handle: fixedHandle, reload }) {
  const [handle, setHandle] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const target = fixedHandle || handle.trim().replace(/^@/, "");

  const submit = async () => {
    setBusy(true);
    try {
      await meritAPI.endorse(target, reason.trim());
      toast.success("Recorded. Your name goes with it.");
      setReason("");
      setHandle("");
      reload();
    } catch (err) {
      toast.error(apiError(err, "Couldn't record that endorsement."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="p-4" className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-1">
        <Sprout size={14} aria-hidden="true" />
        Vouch for a business
      </p>
      <p className="text-micro leading-relaxed text-ink-4">
        Say what you actually saw. Your name goes on it, and it is worth what your own
        record is worth — so ten strangers cannot manufacture a reputation.
      </p>
      {!fixedHandle && (
        <Input label="Which business" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" />
      )}
      <Textarea
        label="What did they do?"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Delivered 40 bales on time through the December rush."
      />
      <Button type="button" size="sm" onClick={submit} disabled={busy || target.length < 2 || reason.trim().length < 10}>
        <Copy size={12} aria-hidden="true" /> {busy ? "Recording…" : "Record it"}
      </Button>
    </Card>
  );
}
