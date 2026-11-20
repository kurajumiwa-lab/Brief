import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight, BadgeCheck, CalendarDays, Check, Clock3, HeartHandshake,
  MapPin, MessageCircle, Plus, Radio, Send, Sparkles, Users, X,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { apiError, streetAPI } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

/**
 * THE STREET — /street
 *
 * The calendar gives the week a rhythm. The tables give the street a pulse.
 * The guide gives one person one next step. They share a screen because they
 * answer the same question: "what can I do in the next hour that I could not
 * do by scrolling?"
 *
 * The rules are visible in the UI, not buried in a policy:
 *   · a table expires by itself;
 *   · the public card never carries a phone number;
 *   · joining produces a wa.me / t.me handoff with a verification code;
 *   · Brief sends no message and holds no money.
 */

const INTENTS = [
  { value: "co_buy", label: "Co-buy", hint: "Split a case, a bag or a delivery." },
  { value: "source", label: "Source", hint: "Find stock or a supplier now." },
  { value: "delivery", label: "Delivery", hint: "A rider, a run or a shared route." },
  { value: "gig", label: "Quick job", hint: "One task, one afternoon." },
  { value: "meetup", label: "Meet-up", hint: "A table, a demo or a match." },
];

const INTENT_TONE = {
  co_buy: "bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300",
  source: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  delivery: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  gig: "bg-orchid-50 text-orchid-700 dark:bg-orchid-500/15 dark:text-orchid-300",
  meetup: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

const EMPTY_FORM = {
  title: "",
  intent: "co_buy",
  zone: "",
  details: "",
  seats: "3",
  duration_minutes: "120",
  tags: "",
  handoff_channel: "whatsapp",
  handoff_target: "",
};

function minutesLabel(minutes) {
  const value = Number(minutes || 0);
  if (value < 60) return `${value} min left`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return `${hours}h${rest ? ` ${rest}m` : ""} left`;
}

function intentMeta(value) {
  return INTENTS.find((item) => item.value === value) || INTENTS[0];
}

export default function StreetPage() {
  const vendor = useAuthStore((s) => s.vendor);
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [intent, setIntent] = useState("");
  const [showForm, setShowForm] = useState(params.get("open") === "1");
  const [form, setForm] = useState(EMPTY_FORM);
  const [handoffs, setHandoffs] = useState({});
  const [copied, setCopied] = useState("");

  const zoneDefault = useMemo(
    () => String(vendor?.physical_location || "").split(",").slice(0, 2).join(",").trim(),
    [vendor?.physical_location],
  );

  const load = useCallback(async () => {
    try {
      const { data: payload } = await streetAPI.now();
      setData(payload);
      setError("");
    } catch (err) {
      setError(apiError(err, "The street could not be read just now."));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setShowForm(params.get("open") === "1");
  }, [params]);

  useEffect(() => {
    if (zoneDefault && !form.zone) setForm((current) => ({ ...current, zone: zoneDefault }));
  }, [zoneDefault, form.zone]);

  async function join(lobby) {
    setBusy(`join:${lobby.id}`);
    try {
      const { data: result } = await streetAPI.join(lobby.id);
      setHandoffs((current) => ({ ...current, [lobby.id]: result.handoff }));
      toast.success(result.already ? "You are already at this table." : "Seat taken. Open the handoff.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "That table could not be joined."));
    } finally {
      setBusy("");
    }
  }

  async function leave(lobby) {
    setBusy(`leave:${lobby.id}`);
    try {
      await streetAPI.leave(lobby.id);
      setHandoffs((current) => {
        const next = { ...current };
        delete next[lobby.id];
        return next;
      });
      toast.success("You left the table.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "That table could not be left."));
    } finally {
      setBusy("");
    }
  }

  async function close(lobby) {
    setBusy(`close:${lobby.id}`);
    try {
      await streetAPI.close(lobby.id);
      toast.success("Table closed.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "That table could not be closed."));
    } finally {
      setBusy("");
    }
  }

  async function copyHandoff(lobbyId, handoff) {
    try {
      await navigator.clipboard.writeText(handoff.code);
      setCopied(lobbyId);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      toast.error("Copy is not available in this browser. Select the code instead.");
    }
  }

  async function submit(event) {
    event.preventDefault();
    setBusy("create");
    try {
      await streetAPI.create({
        title: form.title.trim(),
        intent: form.intent,
        zone: form.zone.trim(),
        details: form.details.trim(),
        tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
        seats: Number(form.seats),
        duration_minutes: Number(form.duration_minutes),
        handoff_channel: form.handoff_channel,
        handoff_target: form.handoff_target.trim(),
      });
      toast.success("Table is open. It closes by itself.");
      setForm({ ...EMPTY_FORM, zone: zoneDefault });
      setShowForm(false);
      setParams({}, { replace: true });
      await load();
    } catch (err) {
      toast.error(apiError(err, "That table could not be opened."));
    } finally {
      setBusy("");
    }
  }

  if (!data) {
    return error ? (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="soft-card rounded-3xl bg-surface-0 p-6">
          <p className="text-sm font-semibold text-ink-1">{error}</p>
          <Button className="mt-4" size="sm" onClick={load}>Try again</Button>
        </div>
      </main>
    ) : <PageSpinner label="Reading the street…" />;
  }

  const season = data.calendar.season;
  const today = data.calendar.today;
  const upcoming = data.calendar.upcoming || [];
  const pulseActive = data.calendar.pulse?.active;
  const lobbies = data.lobbies?.lobbies || [];
  const visible = intent ? lobbies.filter((lobby) => lobby.intent === intent) : lobbies;
  const guide = data.guide;

  function toggleForm() {
    const next = !showForm;
    setShowForm(next);
    setParams(next ? { open: "1" } : {}, { replace: true });
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-8" data-testid="street-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">The street · live</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1 sm:text-3xl">
            What is moving now?
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-3">
            A weekly rhythm, a few open tables and one next step. Everything here
            is an introduction with an expiry — never a booking or a payment.
          </p>
        </div>
        <Button icon={Plus} onClick={toggleForm}>
          Open a table
        </Button>
      </header>

      {showForm && (
        <LobbyForm
          form={form}
          setForm={setForm}
          zoneDefault={zoneDefault}
          busy={busy === "create"}
          onSubmit={submit}
          onCancel={toggleForm}
        />
      )}

      <section
        data-testid="street-season"
        className="shelf-card relative mt-5 overflow-hidden rounded-3xl p-5 text-white sm:p-6"
        style={{ background: `linear-gradient(135deg, ${season.accent}, #171021 78%)` }}
      >
        <div className="pointer-events-none absolute -right-12 -top-16 h-52 w-52 rounded-full bg-white/15 blur-3xl" aria-hidden="true" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] backdrop-blur">
              {season.chapter} · {season.week} of 13
            </span>
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold backdrop-blur">
              {season.days_left} days left
            </span>
            {pulseActive && (
              <span className="rounded-full bg-[#E65100] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.1em]">
                {pulseActive.label} rail
              </span>
            )}
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">{season.label}</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-white/80">{season.focus}</p>
          <p className="mt-3 max-w-2xl text-xs leading-relaxed text-white/65">{season.prompt}</p>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-white/80" style={{ width: `${Math.min(100, season.progress_pct)}%` }} />
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <section className="soft-card rounded-3xl bg-surface-0 p-4" data-testid="street-today">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <Radio size={15} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-4">Today&apos;s script</p>
              <p className="text-xs font-extrabold text-ink-1">{today ? today.zone_label : "No script today"}</p>
            </div>
            {today && (
              <Badge className="ml-auto" variant={today.state === "live" ? "brand" : today.state === "done" ? "gray" : "amber"}>
                {today.official ? "Official broadcast" : today.state === "live" ? "Live now" : today.state}
              </Badge>
            )}
          </div>
          {today ? (
            <>
              <h3 className="mt-3 text-sm font-extrabold leading-snug text-ink-1">{today.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-3">{today.detail}</p>
              <Link to={today.href} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline dark:text-brand-300">
                {today.cta} <ArrowRight size={12} aria-hidden="true" />
              </Link>
            </>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-ink-3">
              Tuesday is a follow-up day. Open a table or look at Sunday&apos;s close before the week gets loud.
            </p>
          )}
        </section>

        <section className="soft-card rounded-3xl bg-surface-0 p-4" data-testid="street-guide">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-4">
            {guide.persona?.name || "Mtaa"} · {guide.persona?.role || "your street guide"} · level {guide.level}
          </p>
          <div className="mt-2 flex items-end justify-between gap-2">
            <h3 className="text-sm font-extrabold text-ink-1">{guide.completed} of {guide.total} chapters</h3>
            <span className="text-[11px] font-bold tabular-nums text-ink-4">{guide.season_points} pts</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${guide.progress_pct}%` }} />
          </div>
          {guide.persona?.line && (
            <p className="mt-2 text-[11px] italic leading-relaxed text-ink-3">{guide.persona.line}</p>
          )}
          {guide.next_chapter ? (
            <div className="mt-3">
              <p className="text-xs font-extrabold text-ink-1">{guide.next_chapter.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{guide.next_chapter.body}</p>
              <Link to={guide.next_chapter.href} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline dark:text-brand-300">
                {guide.next_chapter.cta} <ArrowRight size={12} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-xs font-bold text-brand-700 dark:text-brand-300">Every chapter is open. Help someone else open theirs.</p>
          )}
        </section>
      </div>

      <section aria-labelledby="tables-heading" className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="eyebrow">Matchmaking lobby</p>
            <h2 id="tables-heading" className="mt-1 text-lg font-extrabold tracking-tight text-ink-1">
              Open tables <span className="text-ink-4">({visible.length})</span>
            </h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-4">Expires by itself</span>
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar" role="group" aria-label="Filter tables by intent">
          <button
            type="button"
            onClick={() => setIntent("")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors",
              !intent ? "bg-ink-1 text-surface-0" : "bg-surface-2 text-ink-3 hover:bg-surface-3",
            )}
          >
            All
          </button>
          {INTENTS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={intent === item.value}
              onClick={() => setIntent(intent === item.value ? "" : item.value)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors",
                intent === item.value ? "bg-ink-1 text-surface-0" : "bg-surface-2 text-ink-3 hover:bg-surface-3",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="soft-card mt-3 rounded-3xl bg-surface-0 px-5 py-8 text-center">
            <Users size={22} className="mx-auto text-ink-4" aria-hidden="true" />
            <p className="mt-2 text-sm font-extrabold text-ink-1">No open table matches that yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-3">
              Open one for the next two hours. A table with a clear need and a real zone
              is easier to join than a general offer.
            </p>
            <Button className="mt-3" size="sm" icon={Plus} onClick={toggleForm}>Open a table</Button>
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {visible.map((lobby) => (
              <LobbyCard
                key={lobby.id}
                lobby={lobby}
                handoff={handoffs[lobby.id]}
                busy={busy}
                copied={copied === lobby.id}
                onJoin={() => join(lobby)}
                onLeave={() => leave(lobby)}
                onClose={() => close(lobby)}
                onCopy={() => handoffs[lobby.id] && copyHandoff(lobby.id, handoffs[lobby.id])}
              />
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-ink-4">{data.lobbies?.note}</p>
      </section>

      <section aria-labelledby="week-heading" className="mt-7">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <p className="eyebrow">The weekday rhythm</p>
            <h2 id="week-heading" className="mt-1 text-lg font-extrabold tracking-tight text-ink-1">The next seven days</h2>
          </div>
          <CalendarDays size={16} className="text-ink-4" aria-hidden="true" />
        </div>
        <ol className="mt-3 space-y-1.5">
          {upcoming.map((script) => (
            <li key={`${script.key}:${script.at}`} className="soft-card flex items-center gap-3 rounded-2xl bg-surface-0 px-3 py-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-3">
                <Clock3 size={14} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-extrabold text-ink-1">{script.title}</p>
                <p className="text-[10px] text-ink-4">{script.zone_label} · {script.label}</p>
              </div>
              <Link to={script.href} className="shrink-0 text-[11px] font-bold text-brand-700 hover:underline dark:text-brand-300">
                {script.cta}
              </Link>
            </li>
          ))}
        </ol>
        {data.calendar.timetable.length > 0 && (
          <div className="mt-3">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-4">Your recurring slots</h3>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {data.calendar.timetable.map((routine) => (
                <li key={routine.id}>
                  <Link to="/routines" className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                    {routine.title} · {routine.next_label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {guide.next_actions?.length > 0 && (
        <section aria-labelledby="next-actions-heading" className="mt-7">
          <p className="eyebrow">One next step</p>
          <h2 id="next-actions-heading" className="mt-1 text-lg font-extrabold tracking-tight text-ink-1">What the street is asking you</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {guide.next_actions.map((action) => (
              <Link
                key={`${action.kind}:${action.title}`}
                to={action.href}
                className="soft-card group rounded-2xl bg-surface-0 p-3.5 transition-colors hover:bg-surface-1"
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-4">{action.eyebrow}</p>
                <p className="mt-1 text-xs font-extrabold leading-snug text-ink-1">{action.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{action.detail}</p>
                <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-brand-700 dark:text-brand-300">
                  {action.cta} <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="mt-7 flex items-start gap-2 rounded-2xl bg-surface-2 px-3 py-2.5 text-[10px] leading-relaxed text-ink-3">
        <HeartHandshake size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Brief introduces and records nothing about the agreement itself. Contact is
          shared only after you join; the code confirms you are at the same table.
          No money passes through Brief, and no message is sent on your behalf.
        </span>
      </p>
    </main>
  );
}

function LobbyCard({ lobby, handoff, busy, copied, onJoin, onLeave, onClose, onCopy }) {
  const meta = intentMeta(lobby.intent);
  const isBusy = busy === `join:${lobby.id}` || busy === `leave:${lobby.id}` || busy === `close:${lobby.id}`;
  const full = lobby.remaining === 0;
  return (
    <li
      className="shelf-card flex flex-col bg-surface-0 p-4"
      data-testid={`street-lobby-${lobby.id}`}
      data-intent={lobby.intent}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn("rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.1em]", INTENT_TONE[lobby.intent])}>
          {meta.label}
        </span>
        <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold", full ? "text-ink-4" : "text-accent-700 dark:text-accent-300")}>
          <Clock3 size={10} aria-hidden="true" />
          {lobby.status === "open" ? minutesLabel(lobby.minutes_left) : lobby.status}
        </span>
      </div>

      <h3 className="mt-2 text-sm font-extrabold leading-snug text-ink-1">{lobby.title}</h3>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-4">
        <MapPin size={10} aria-hidden="true" />
        <span className="truncate">{lobby.zone}</span>
      </p>
      {lobby.details && <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-ink-3">{lobby.details}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="gray">{lobby.joined_count}/{lobby.seats} at the table</Badge>
        {lobby.host?.verified && (
          <Badge variant="brand"><BadgeCheck size={10} aria-hidden="true" /> Verified shop</Badge>
        )}
        {lobby.match_reasons?.slice(0, 2).map((reason) => (
          <Badge key={reason} variant="outline">{reason}</Badge>
        ))}
      </div>

      <p className="mt-2 text-[10px] font-semibold text-ink-4">
        Hosted by {lobby.host?.business || lobby.host?.handle}
        {lobby.is_mine ? " · your table" : ""}
      </p>

      {handoff ? (
        <div className="mt-3 rounded-2xl bg-brand-50 p-3 dark:bg-brand-500/10" data-testid="street-handoff">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-700 dark:text-brand-300">
            Verification code
          </p>
          <p className="mt-0.5 text-lg font-black tracking-[0.18em] text-brand-800 dark:text-brand-200">{handoff.code}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-brand-800/75 dark:text-brand-200/75">{handoff.note}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <a
              href={handoff.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-[11px] font-bold text-white hover:bg-brand-700"
            >
              {handoff.channel === "whatsapp" ? <MessageCircle size={12} aria-hidden="true" /> : <Send size={12} aria-hidden="true" />}
              {handoff.label}
            </a>
            <button type="button" onClick={onCopy} className="inline-flex h-8 items-center gap-1 rounded-lg bg-white px-2.5 text-[11px] font-bold text-brand-800 hover:bg-brand-50 dark:bg-surface-2 dark:text-brand-200">
              {copied ? <Check size={12} aria-hidden="true" /> : null}
              {copied ? "Copied" : "Copy code"}
            </button>
          </div>
        </div>
      ) : lobby.is_mine ? (
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded-lg bg-surface-2 px-2 py-1 text-[10px] font-bold text-ink-3">
            Code {lobby.verification_code || "in your handoff"}
          </span>
          <Button size="xs" variant="ghost" loading={isBusy} onClick={onClose}>Close</Button>
        </div>
      ) : lobby.joined ? (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="secondary" loading={isBusy} onClick={onJoin}>Get handoff</Button>
          <Button size="sm" variant="ghost" loading={isBusy} onClick={onLeave}>Leave</Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" loading={isBusy} disabled={!lobby.can_join} onClick={onJoin}>
            {full ? "Table full" : "Take a seat"}
          </Button>
          <span className="text-[10px] text-ink-4">No payment</span>
        </div>
      )}
    </li>
  );
}

function LobbyForm({ form, setForm, zoneDefault, busy, onSubmit, onCancel }) {
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form onSubmit={onSubmit} className="soft-card mt-4 rounded-3xl bg-surface-0 p-4 sm:p-5" data-testid="street-lobby-form">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="eyebrow">Two-hour window</p>
          <h2 className="mt-1 text-base font-extrabold text-ink-1">Open a table</h2>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close form" className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-ink-3 hover:bg-surface-3">
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[11px] font-bold text-ink-2">What is the table for?</span>
          <input value={form.title} onChange={set("title")} maxLength={140} required placeholder="Two bags of maize flour before noon" className="h-10 w-full rounded-xl bg-surface-2 px-3 text-sm text-ink-1 outline-none ring-brand-500/30 placeholder:text-ink-4 focus:ring-2" />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold text-ink-2">Kind</span>
          <select value={form.intent} onChange={set("intent")} className="h-10 w-full rounded-xl bg-surface-2 px-3 text-sm font-semibold text-ink-1 outline-none focus:ring-2 focus:ring-brand-500/30">
            {INTENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold text-ink-2">Zone or street</span>
          <input value={form.zone} onChange={set("zone")} maxLength={80} required placeholder={zoneDefault || "Kondele, Kisumu"} className="h-10 w-full rounded-xl bg-surface-2 px-3 text-sm text-ink-1 outline-none ring-brand-500/30 placeholder:text-ink-4 focus:ring-2" />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[11px] font-bold text-ink-2">The useful detail</span>
          <textarea value={form.details} onChange={set("details")} maxLength={1200} rows={2} placeholder="What you are splitting, carrying or looking for. Say what “done” looks like." className="w-full rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-1 outline-none ring-brand-500/30 placeholder:text-ink-4 focus:ring-2" />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold text-ink-2">Seats, including you</span>
          <select value={form.seats} onChange={set("seats")} className="h-10 w-full rounded-xl bg-surface-2 px-3 text-sm font-semibold text-ink-1 outline-none focus:ring-2 focus:ring-brand-500/30">
            {[2, 3, 4, 5, 8, 12].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold text-ink-2">Stays open for</span>
          <select value={form.duration_minutes} onChange={set("duration_minutes")} className="h-10 w-full rounded-xl bg-surface-2 px-3 text-sm font-semibold text-ink-1 outline-none focus:ring-2 focus:ring-brand-500/30">
            {[30, 60, 120, 240, 480].map((value) => <option key={value} value={value}>{value < 60 ? `${value} minutes` : `${value / 60} hour${value === 60 ? "" : "s"}`}</option>)}
          </select>
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[11px] font-bold text-ink-2">Tags <span className="font-normal text-ink-4">(comma separated, optional)</span></span>
          <input value={form.tags} onChange={set("tags")} placeholder="food, bulk, transport" className="h-10 w-full rounded-xl bg-surface-2 px-3 text-sm text-ink-1 outline-none ring-brand-500/30 placeholder:text-ink-4 focus:ring-2" />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold text-ink-2">Handoff</span>
          <select value={form.handoff_channel} onChange={set("handoff_channel")} className="h-10 w-full rounded-xl bg-surface-2 px-3 text-sm font-semibold text-ink-1 outline-none focus:ring-2 focus:ring-brand-500/30">
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold text-ink-2">{form.handoff_channel === "whatsapp" ? "WhatsApp number" : "Telegram username"}</span>
          <input value={form.handoff_target} onChange={set("handoff_target")} required placeholder={form.handoff_channel === "whatsapp" ? "0712 345 678" : "@street_rider"} className="h-10 w-full rounded-xl bg-surface-2 px-3 text-sm text-ink-1 outline-none ring-brand-500/30 placeholder:text-ink-4 focus:ring-2" />
        </label>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-ink-4">
        Your contact is not shown in the public list. It is released only to a person
        who joins, with the verification code in the handoff. Brief sends no message.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button type="submit" loading={busy} icon={Sparkles}>Open the table</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
