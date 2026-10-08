import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Trophy, Zap, Coins, Flame, Plus, X, Star, MapPin, Image, Users, Swords, Medal, Map,
} from "lucide-react";
import Tabs from "@/components/ui/Tabs";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import MyPage from "@/components/squad/MyPage";
import { toast } from "@/components/ui/Toast";
import { squadAPI, fileAPI, geoAPI, apiError } from "@/lib/api";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// SQUAD — Hustle League.
//
// The rule this page obeys: every number on the card is a row. XP, division,
// streak and card tiers are computed by the server from completed contracts;
// Gold is a ledger sum. Nothing here can be granted, faked or inflated — a
// card rises only when the work under it does.
// ─────────────────────────────────────────────────────────────────────────────

const SKILLS = {
  cleaner: "Cleaner", fundi: "Fundi", rider: "Rider", tutor: "Tutor", cook: "Cook",
  digital: "Digital", gardener: "Gardener", mover: "Mover", sitter: "Sitter",
  shopper: "Shopper", queue: "Queue-jumper", errand: "Errand",
};
const TIER_STYLE = {
  common: "text-ink-3 border-edge-1",
  rare: "text-blue-600 dark:text-blue-400 border-blue-400/40",
  epic: "text-purple-600 dark:text-purple-400 border-violet-400/50",
  legendary: "text-brand-600 dark:text-brand-400 border-brand-400/60",
};
const DIVISION_STYLE = {
  Rookie: "text-ink-3", Bronze: "text-[#CD7F32]", Silver: "text-[#C0C0C0]",
  Gold: "text-brand-600 dark:text-brand-400", Elite: "text-purple-600 dark:text-purple-400",
};
const TABS = [
  { value: "mypage", label: "My page", icon: Map },
  { value: "callups", label: "Call-ups", icon: Swords },
  { value: "matches", label: "My matches", icon: Medal },
  { value: "weekly", label: "Weekly", icon: Zap },
  { value: "league", label: "League", icon: Trophy },
  { value: "squads", label: "Squads", icon: Users },
];

const Stars = ({ n, onChange }) => (
  <div className="flex gap-0.5">
    {[1, 2, 3, 4, 5].map((i) => (
      <button key={i} type="button" disabled={!onChange} onClick={() => onChange?.(i)} className={cn(onChange ? "cursor-pointer" : "cursor-default")}>
        <Star size={16} className={i <= (n || 0) ? "fill-brand-400 text-brand-600 dark:text-brand-400" : "text-ink-4"} />
      </button>
    ))}
  </div>
);

// ── Player plate ─────────────────────────────────────────────────────────────
function PlayerPlate({ me }) {
  const e = me.energy;
  return (
    <div className="glass-strong rounded-3xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-semibold text-ink-1 tracking-tight truncate">{me.name}</h2>
            <Badge variant="outline" size="sm" className={DIVISION_STYLE[me.division] || "text-ink-3"}>{me.division}</Badge>
          </div>
          <p className="text-xs text-ink-4 mt-1">@{me.handle} · {me.level}
            <span className="ml-3 font-mono">{num(me.xp)} XP</span>
          </p>
          {me.level_progress?.next != null && (
            <div className="mt-2 max-w-xs h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300" style={{ width: `${me.level_progress.pct}%` }} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 text-center shrink-0">
          <div>
            <div className="digital text-2xl text-brand-600 dark:text-brand-400">{num(me.gold)}</div>
            <p className="text-2xs text-ink-4 mt-1">Gold</p>
          </div>
          <div>
            <div className="digital text-2xl text-accent-600 dark:text-accent-400">{num(me.streak)}</div>
            <p className="text-2xs text-ink-4 mt-1">day streak</p>
          </div>
          <div>
            <div className="flex gap-1 justify-center">
              {Array.from({ length: e.limit }).map((_, i) => (
                <span key={i} className={cn("w-2.5 h-4 rounded-sm", i < e.used ? "bg-brand-400" : "bg-surface-2")} />
              ))}
            </div>
            <p className="text-2xs text-ink-4 mt-1">energy · {e.used}/{e.limit} today</p>
          </div>
        </div>
      </div>
      {me.cards.length > 0 && (
        <div className="mt-4 flex gap-1.5 flex-wrap">
          {me.cards.map((c) => (
            <span key={c.skill} title={`${c.completions} completed · avg ${c.avg_rating}★`}
              className={cn("rounded-full border px-2.5 py-1 text-2xs font-semibold", TIER_STYLE[c.tier])}>
              {c.label} <span className="uppercase opacity-80">{c.tier}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Call-ups tab ─────────────────────────────────────────────────────────────
function CallUps({ me, onPost, onChanged }) {
  const [calls, setCalls] = useState(null);
  const [skill, setSkill] = useState("");
  const [accepting, setAccepting] = useState(null);

  const load = useCallback(() => {
    squadAPI.calls({ skill: skill || undefined }).then((r) => setCalls(r.data.calls)).catch((e) => {
      setCalls([]);
      toast.error(apiError(e, "Call-ups could not be loaded"));
    });
  }, [skill]);
  useEffect(() => { load(); }, [load]);

  const accept = async (call) => {
    setAccepting(call.id);
    try {
      await squadAPI.accept(call.id);
      toast.success("Contract signed — the match is on");
      onChanged();
      load();
    } catch (e) {
      toast.error(apiError(e, "That contract could not be accepted"));
    } finally {
      setAccepting(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex gap-1.5 overflow-x-auto pb-1">
          <button onClick={() => setSkill("")} className={cn("shrink-0 rounded-full px-3 h-8 text-xs", !skill ? "bg-brand-500/20 text-brand-600 dark:text-brand-400" : "text-ink-4")}>All skills</button>
          {Object.entries(SKILLS).map(([k, l]) => (
            <button key={k} onClick={() => setSkill(k === skill ? "" : k)} className={cn("shrink-0 rounded-full px-3 h-8 text-xs", skill === k ? "bg-brand-500/20 text-brand-600 dark:text-brand-400" : "text-ink-4")}>{l}</button>
          ))}
        </div>
        <Button size="sm" icon={Plus} onClick={onPost} className="shrink-0">Post a call-up</Button>
      </div>

      {calls === null ? <PageSpinner label="Looking for call-ups…" /> : calls.length === 0 ? (
        <EmptyState icon={Swords} title="No open call-ups right now" description="Clients post paid tasks here — cleaning, riding, tutoring, errands. Post one yourself to test the loop." />
      ) : (
        <div className="space-y-2">
          {calls.map((c) => (
            <div key={c.id} className="glass glass-hover rounded-2xl p-3.5 flex gap-3 items-center animate-fade-in">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-ink-1 truncate">{c.title}</p>
                  <Badge variant="outline" size="xs">{SKILLS[c.skill] || c.skill}</Badge>
                  {c.required_tier !== "common" && <Badge variant="outline" size="xs" className="text-purple-600 dark:text-purple-400">{c.required_tier} card</Badge>}
                  {c.squad_id && <Badge variant="outline" size="xs" className="text-blue-600 dark:text-blue-400">squad mission</Badge>}
                </div>
                <p className="text-2xs text-ink-4 mt-1">
                  {c.client}{c.location ? ` · ${c.location}` : ""} · expires {relativeTime(c.expires_at)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="digital text-sm text-ink-1">KES {num(c.pay_kes)}</p>
                <Button size="sm" variant="secondary" loading={accepting === c.id} onClick={() => accept(c)} className="mt-1.5">
                  Accept
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Matches tab (the active contract + history, both sides) ─────────────────
function Matches({ me, onChanged }) {
  const [history, setHistory] = useState([]);
  const [otp, setOtp] = useState("");
  const [photo, setPhoto] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [rating, setRating] = useState(5);
  const [confirmed, setConfirmed] = useState(null);
  const fileRef = useRef(null);

  const c = me.active_contract;
  if (!c) {
    return <EmptyState icon={Medal} title="No match in hand" description="Accept a call-up and it becomes your contract: start it, finish it, get the code from the client, get paid." />;
  }

  const takePhoto = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const { data } = await fileAPI.upload(f);
      setPhoto(data.url);
    } catch (err) {
      toast.error(apiError(err, "The photo could not be uploaded"));
    } finally {
      setUploading(false);
    }
  };

  const act = async (kind) => {
    setBusy(kind);
    try {
      if (kind === "start") {
        await squadAPI.start(c.id);
        toast.success("Match started");
      } else if (kind === "complete") {
        await squadAPI.complete(c.id, { otp: otp.trim(), photo_url: photo });
        toast.success("Proof sent — waiting for the client to confirm");
        setOtp("");
        setPhoto(null);
      } else if (kind === "confirm") {
        const res = await squadAPI.confirm(c.id, { rating });
        setConfirmed(res.data);
        onChanged();
      } else if (kind === "rate") {
        await squadAPI.rateClient(c.id, rating);
        toast.success("Client rated");
      } else if (kind === "cancel") {
        await squadAPI.cancel(c.id, "cancelled by player");
        toast.success("Contract cancelled — the call-up is open again");
      }
      onChanged();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="glass-strong rounded-3xl p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-base font-medium text-ink-1 truncate">{c.title}</p>
            <p className="text-2xs text-ink-4 mt-1">
              {c.i_am_player ? `for ${c.client_name}` : `worker: ${c.player_name}`}
              {c.location ? ` · ${c.location}` : ""} · agreed KES {num(c.pay_kes)}
            </p>
          </div>
          <Badge variant="outline" size="sm" className={c.status === "proof_pending" ? "text-accent-600 dark:text-accent-400" : "text-brand-600 dark:text-brand-400"}>
            {c.status.replaceAll("_", " ")}
          </Badge>
        </div>

        <div className="mt-4 space-y-3">
          {c.i_am_player && (
            <>
              {c.status === "accepted" && (
                <div className="flex gap-2">
                  <Button icon={Medal} loading={busy === "start"} onClick={() => act("start")}>Start the match</Button>
                  <Button variant="ghost" loading={busy === "cancel"} onClick={() => act("cancel")}>Cancel</Button>
                </div>
              )}
              {(c.status === "in_progress" || c.status === "accepted") && (
                <div className="rounded-2xl bg-surface-2 p-3 space-y-2">
                  <p className="text-xs font-medium text-ink-2">Finish: photo proof + the client's 6-digit code</p>
                  <div className="flex gap-2 items-center">
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="rounded-xl border border-dashed border-brand-500/40 px-3 h-10 text-xs text-ink-2 hover:bg-surface-2 flex items-center gap-2">
                      <Image size={14} /> {photo ? "Photo attached ✓" : uploading ? "Uploading…" : "Add photo (optional)"}
                    </button>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={takePhoto} />
                    <input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="client code · 6 digits"
                      className="flex-1 px-3 h-10 rounded-xl bg-surface-0 text-sm font-mono tracking-[0.3em] text-center placeholder:tracking-normal placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
                    />
                  </div>
                  <Button loading={busy === "complete"} disabled={otp.length !== 6} onClick={() => act("complete")}>
                    Send proof
                  </Button>
                </div>
              )}
              {c.status === "proof_pending" && (
                <p className="text-xs text-ink-4">Waiting for the client to confirm and rate. You'll be paid the agreed KES by mobile money — this contract is the record.</p>
              )}
              {c.status === "completed" && (
                <div className="rounded-2xl bg-surface-2 p-3 space-y-2">
                  <p className="text-xs font-medium text-ink-2">
                    Won: <span className="text-brand-600 dark:text-brand-400 font-mono">+{c.xp_earned} XP</span> · <span className="text-brand-600 dark:text-brand-400 font-mono">+{c.gold_earned} Gold</span>
                    {c.client_rating ? <> · client rated <Stars n={c.client_rating} /></> : ""}
                  </p>
                  {c.payout && (
                    <p className="text-2xs text-ink-3">
                      Pay: <span className="text-brand-600 dark:text-brand-400 font-semibold">KES {num(c.payout.amount_kes)}</span> · {c.payout.method}
                      {c.payout.recorded_at ? ` · recorded ${relativeTime(c.payout.recorded_at)}` : ""}
                    </p>
                  )}
                  {c.worker_client_rating == null ? (
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-ink-4">Rate your client:</p>
                      <Stars n={rating} onChange={setRating} />
                      <Button size="sm" variant="secondary" loading={busy === "rate"} onClick={() => act("rate")}>Send</Button>
                    </div>
                  ) : (
                    <p className="text-2xs text-ink-4">You rated the client <Stars n={c.worker_client_rating} /></p>
                  )}
                </div>
              )}
            </>
          )}

          {c.i_am_client && (
            <>
              <div className="rounded-2xl bg-surface-2 p-3">
                <p className="text-2xs text-ink-4">Your code — give this to the worker at completion</p>
                <p className="digital text-3xl text-brand-600 dark:text-brand-400 mt-1 tracking-[0.2em]">{c.otp || "—"}</p>
              </div>
              {c.status === "proof_pending" ? (
                <div className="space-y-2">
                  {c.proof_photo_url && (
                    <img src={c.proof_photo_url} alt="Proof" className="max-h-40 rounded-xl" />
                  )}
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-ink-4">Rate the work:</p>
                    <Stars n={rating} onChange={setRating} />
                    <Button loading={busy === "confirm"} onClick={() => act("confirm")}>Confirm & settle</Button>
                  </div>
                </div>
              ) : c.status === "completed" ? (
                <div className="space-y-3">
                  {confirmed?.first_business && (
                    <div className="rounded-2xl bg-brand-500/10 border border-brand-500/30 p-3">
                      <p className="text-xs font-semibold text-brand-600 dark:text-brand-400">First business on the network ✓</p>
                      <p className="text-2xs text-ink-3 mt-1">{confirmed.first_business_note}</p>
                    </div>
                  )}
                  {c.payout && (
                    <div className="rounded-2xl bg-surface-2 p-3.5 space-y-1.5">
                      <p className="text-2xs uppercase tracking-[0.2em] text-ink-4 font-bold">Payout on this match</p>
                      <div className="flex items-baseline justify-between">
                        <span className="digital text-2xl text-brand-600 dark:text-brand-400">KES {num(c.payout.amount_kes)}</span>
                        <span className="text-2xs text-ink-4">{c.payout.recorded_at ? relativeTime(c.payout.recorded_at) : "recorded"}</span>
                      </div>
                      <p className="text-2xs text-ink-3">via {c.payout.method}</p>
                      <p className="text-2xs text-ink-4">to {c.payout.to || "the worker"} · record {c.payout.ref || "kept on this contract"}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-ink-4">Contract signed. You can cancel while the match hasn't finished.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Weekly tab ───────────────────────────────────────────────────────────────
function Weekly({ me }) {
  return (
    <div className="space-y-2">
      {me.challenges.map((ch) => (
        <div key={ch.key} className="glass glass-hover rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink-1">{ch.label}</p>
            <Badge variant={ch.granted ? "brand" : ch.met ? "outline" : "outline"} size="xs">
              {ch.granted ? "rewarded" : ch.met ? "done" : `${ch.have}/${ch.need}`}
            </Badge>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300" style={{ width: `${Math.min(100, (ch.have / ch.need) * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-2xs text-ink-4">+{ch.payout} Gold · resets Monday</p>
        </div>
      ))}
    </div>
  );
}

// ── League tab ───────────────────────────────────────────────────────────────
function League() {
  const [data, setData] = useState(null);
  useEffect(() => {
    squadAPI.league().then((r) => setData(r.data)).catch((e) => toast.error(apiError(e, "The league table could not be loaded")));
  }, []);
  if (!data) return <PageSpinner label="Counting the season…" />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink-1">Monthly league · {data.month}</p>
        <p className="text-2xs text-ink-4">points = XP from completed matches</p>
      </div>
      {data.standings.length === 0 ? (
        <EmptyState icon={Trophy} title="The season is starting" description="Complete matches to earn points. Top of the table climbs divisions." />
      ) : (
        <div className="glass rounded-2xl divide-y divide-edge-1">
          {data.standings.slice(0, 30).map((s) => (
            <div key={s.rank} className={cn("flex items-center gap-3 px-4 py-2.5", s.me && "bg-brand-500/10")}>
              <span className="w-7 digital text-sm text-ink-4">{s.rank}</span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm truncate", s.me ? "text-brand-600 dark:text-brand-400 font-semibold" : "text-ink-2")}>{s.name} {s.me && "· you"}</p>
                <p className="text-2xs text-ink-4">{s.matches} matches{s.avg_rating ? ` · avg ${s.avg_rating}★` : ""}</p>
              </div>
              <span className={cn("text-2xs font-semibold", DIVISION_STYLE[s.division] || "text-ink-3")}>{s.division}</span>
              <span className="digital text-sm text-ink-1 w-14 text-right">{num(s.points)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Squads tab ───────────────────────────────────────────────────────────────
function Squads({ onChanged }) {
  const [squads, setSquads] = useState(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState({});

  const load = useCallback(() => {
    squadAPI.squads().then((r) => setSquads(r.data.squads)).catch(() => setSquads([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (name.trim().length < 2) return;
    setCreating(true);
    try {
      await squadAPI.createSquad(name.trim());
      toast.success("Squad formed — you're the captain");
      setName("");
      load();
    } catch (e) {
      toast.error(apiError(e, "The squad could not be formed"));
    } finally {
      setCreating(false);
    }
  };

  const invite = async (squadId) => {
    const h = (handle[squadId] || "").trim();
    if (!h) return;
    try {
      await squadAPI.invite(squadId, h);
      toast.success(`@${h.replace("@", "")} added to the squad`);
      setHandle((m) => ({ ...m, [squadId]: "" }));
      load();
    } catch (e) {
      toast.error(apiError(e, "That invite was refused"));
    }
  };

  if (!squads) return <PageSpinner />;
  return (
    <div className="space-y-3">
      {squads.length === 0 && (
        <EmptyState icon={Users} title="No squad yet" description="Form a squad of up to 10. Squad missions split a slice of the pay to every member's Gold." />
      )}
      {squads.map((s) => (
        <div key={s.id} className="glass glass-hover rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink-1">{s.name} <span className="text-2xs text-ink-4">· {s.member_count}/10 · {s.missions_completed} missions done</span></p>
            {s.members.find((m) => m.me)?.role === "captain" && <Badge variant="brand" size="xs">captain</Badge>}
          </div>
          <div className="space-y-1.5">
            {s.members.map((m) => (
              <div key={m.vendor_id} className="flex items-center gap-2 text-xs">
                <span className={cn("truncate flex-1", m.me ? "text-brand-600 dark:text-brand-400 font-medium" : "text-ink-2")}>{m.name} {m.me && "· you"}</span>
                <span className="text-2xs text-ink-4">{m.role} · {m.split_pct}%</span>
              </div>
            ))}
          </div>
          {s.members.find((m) => m.me)?.role === "captain" && s.member_count < 10 && (
            <div className="flex gap-2">
              <input
                value={handle[s.id] || ""}
                onChange={(e) => setHandle((m) => ({ ...m, [s.id]: e.target.value }))}
                placeholder="@handle to add"
                className="flex-1 px-3 h-9 rounded-xl bg-surface-0 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500/50"
              />
              <Button size="sm" variant="secondary" onClick={() => invite(s.id)}>Add</Button>
            </div>
          )}
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={async () => {
              try { await squadAPI.leave(s.id); toast.success("You left the squad"); load(); onChanged(); }
              catch (e) { toast.error(apiError(e)); }
            }}>Leave</Button>
          </div>
        </div>
      ))}
      <div className="glass rounded-2xl p-4 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Squad name (e.g. Gikomba Six)"
          className="flex-1 px-3 h-10 rounded-xl bg-surface-0 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500/50"
        />
        <Button loading={creating} onClick={create}>Form squad</Button>
      </div>
    </div>
  );
}

// ── Post call-up modal ───────────────────────────────────────────────────────
function PostCall({ open, onClose, squads, onChanged }) {
  const [form, setForm] = useState({ title: "", skill: "errand", required_tier: "common", pay: "", location: "" });
  const [geo, setGeo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  const minWage = { cleaner: 200, fundi: 500, rider: 200, tutor: 400, cook: 350, digital: 300, gardener: 300, mover: 400, sitter: 300, shopper: 150, queue: 150, errand: 150 }[form.skill] || 150;

  const locate = async () => {
    if (!form.location.trim()) return toast.error("Type a place first");
    setLocating(true);
    try {
      const { data } = await geoAPI.geocode(form.location.trim());
      setGeo({ lat: data.lat, lng: data.lng });
      toast.success(`Located: ${data.display_name.slice(0, 50)}`);
    } catch (e) {
      toast.error(apiError(e, "No match for that place"));
    } finally {
      setLocating(false);
    }
  };

  const post = async () => {
    setBusy(true);
    try {
      await squadAPI.postCall({
        title: form.title.trim(),
        task_type: form.skill,
        skill: form.skill,
        required_tier: form.required_tier,
        pay_kes: Number(form.pay),
        location: form.location.trim() || null,
        geo_lat: geo?.lat ?? null,
        geo_lng: geo?.lng ?? null,
        squad_id: null,
      });
      toast.success("Call-up posted — it's open to matching workers");
      onClose();
      onChanged();
    } catch (e) {
      toast.error(apiError(e, "The call-up could not be posted"));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <Modal open onClose={onClose} title="Post a call-up" description="A paid task. The minimum wage per skill is enforced — no underpayment.">
      <div className="space-y-3">
        <Input label="Task" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Laundry pickup at 10am" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Skill" value={form.skill} onChange={(e) => setForm((f) => ({ ...f, skill: e.target.value }))} options={Object.entries(SKILLS).map(([v, l]) => ({ value: v, label: l }))} />
          <Select label="Card needed" value={form.required_tier} onChange={(e) => setForm((f) => ({ ...f, required_tier: e.target.value }))} options={["common", "rare", "epic", "legendary"].map((t) => ({ value: t, label: t }))} />
        </div>
        <Input label={`Pay (KES · min ${minWage})`} type="number" min={minWage} value={form.pay} onChange={(e) => setForm((f) => ({ ...f, pay: e.target.value }))} prefix="KES" />
        <div>
          <div className="flex items-center gap-1.5">
            <Input label="Location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Gikomba" wrapperClassName="flex-1" />
            <Button size="sm" variant="secondary" loading={locating} onClick={locate} className="shrink-0 mb-0.5" title="Free geocode"><MapPin size={13} /> Locate</Button>
          </div>
          {geo && <p className="text-2xs text-brand-600 dark:text-brand-400 mt-1 px-1">located · {Number(geo.lat).toFixed(4)}, {Number(geo.lng).toFixed(4)}</p>}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!form.title.trim() || Number(form.pay) < minWage} onClick={post}>Post call-up</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function SquadPage() {
  const [tab, setTab] = useState("callups");
  const [me, setMe] = useState(null);
  const [squads, setSquads] = useState([]);
  const [postOpen, setPostOpen] = useState(false);

  const refresh = useCallback(() => {
    squadAPI.me().then((r) => setMe(r.data)).catch((e) => toast.error(apiError(e, "Your player card could not be loaded")));
    squadAPI.squads().then((r) => setSquads(r.data.squads)).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (!me) return <PageSpinner label="Dealing your cards…" />;

  return (
    <div className="space-y-4">
      <PlayerPlate me={me} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "mypage" && <MyPage />}
      {tab === "callups" && <CallUps me={me} onPost={() => setPostOpen(true)} onChanged={refresh} />}
      {tab === "matches" && <Matches me={me} onChanged={refresh} />}
      {tab === "weekly" && <Weekly me={me} />}
      {tab === "league" && <League />}
      {tab === "squads" && <Squads onChanged={refresh} />}
      <PostCall open={postOpen} onClose={() => setPostOpen(false)} squads={squads} onChanged={refresh} />
    </div>
  );
}
