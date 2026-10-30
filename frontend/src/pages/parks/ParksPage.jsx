import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Dog, MapPin, Send, ShieldCheck, Tag, Users } from "lucide-react";
import { parksAPI } from "@/lib/api";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { PageSpinner } from "@/components/ui/Spinner";
import Input from "@/components/ui/Input";

/**
 * CAESAR PARK.
 *
 * Two screens in one file, because they are one idea: a list of bounded places,
 * and one place with its gate, its leash and its floor.
 *
 * What the list has to show *before* anyone joins: what bounds the park
 * (`bounded_by`), how you get in (`entry_rule`), and what the rules are. A gate
 * you only discover after knocking is not a gate, it is a trap.
 *
 * What the park screen has to make obvious: the leash decides the name your
 * neighbours see, it is chosen at the gate, and it is per-park — so a shopkeeper
 * can be a shopkeeper in their market and only a neighbour at home.
 */

const ENTRY_COPY = {
  open: "Anyone in can walk in",
  ask: "Knock — the warden lets you in",
};

function Boundary({ park }) {
  const Icon = park.kind === "niche" ? Tag : MapPin;
  return (
    <span className="inline-flex items-center gap-1 text-micro text-ink-3">
      <Icon size={11} aria-hidden="true" />
      {park.bounded_by}
      {park.radius_km ? ` · ${park.radius_km} km` : ""}
    </span>
  );
}

function ParkCard({ park, onJoin, busy }) {
  const inside = park.my_membership?.status === "member";
  const knocking = park.my_membership?.status === "requested";
  return (
    <li
      data-testid="park-card"
      className="rounded-2xl border border-edge-1 bg-surface-1 p-3.5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            to={`/parks/${park.slug}`}
            className="text-sm font-bold tracking-tight text-ink-1 hover:text-brand-700 dark:hover:text-brand-300"
          >
            {park.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Boundary park={park} />
            <span className="inline-flex items-center gap-1 text-micro text-ink-3">
              <Users size={11} aria-hidden="true" />
              {park.members}
            </span>
            <span className="inline-flex items-center gap-1 text-micro text-ink-3">
              <ShieldCheck size={11} aria-hidden="true" />
              {ENTRY_COPY[park.entry_rule] || park.entry_rule}
            </span>
          </div>
        </div>
        {inside ? (
          <span className="shrink-0 rounded-full bg-brand-500/10 px-2 py-1 text-micro font-bold text-brand-700 dark:text-brand-300">
            Inside
          </span>
        ) : knocking ? (
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-1 text-micro font-bold text-ink-3">
            Knocked
          </span>
        ) : (
          <Button size="sm" variant="secondary" loading={busy === park.slug} onClick={() => onJoin(park)}>
            {park.entry_rule === "ask" ? "Knock" : "Walk in"}
          </Button>
        )}
      </div>

      {park.description && (
        <p className="mt-2 line-clamp-2 text-2xs leading-relaxed text-ink-3">{park.description}</p>
      )}

      {Array.isArray(park.rules) && park.rules.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-edge-1 pt-2">
          {park.rules.slice(0, 2).map((rule) => (
            <li key={rule} className="text-micro text-ink-4">
              · {rule}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ParksPage() {
  const [state, setState] = useState({ loading: true, error: null, parks: [] });
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await parksAPI.list();
      setState({ loading: false, error: null, parks: r.data?.parks || [] });
    } catch (err) {
      setState({ loading: false, error: err, parks: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const join = useCallback(
    async (park) => {
      setBusy(park.slug);
      try {
        await parksAPI.join(park.slug, "off");
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  if (state.loading) return <PageSpinner label="Opening the parks" />;
  if (state.error) {
    return <ErrorState title="The parks didn't load" description="Check your connection and try again." onRetry={load} />;
  }

  return (
    <div className="space-y-4">
      <header>
        <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
          Caesar Park
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">Parks</h1>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-ink-3">
          A park is a bounded place: a neighbourhood, a market, a trade. The rules are printed at the gate,
          and you choose at the gate whether your shop name comes with you.
        </p>
      </header>

      {state.parks.length === 0 ? (
        <EmptyState
          icon={Dog}
          title="No parks here yet"
          description="A park needs a boundary — a ward, a market, or a trade. When somebody opens one near you it will show up here."
        />
      ) : (
        <ul className="space-y-2.5">
          {state.parks.map((park) => (
            <ParkCard key={park.slug} park={park} onJoin={join} busy={busy} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ParkDetailPage() {
  const { slug } = useParams();
  const [park, setPark] = useState(null);
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([parksAPI.get(slug), parksAPI.feed(slug).catch(() => null)]);
      setPark(p.data);
      setFeed(f?.data?.posts || []);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const membership = park?.my_membership;
  const inside = membership?.status === "member";
  const leash = membership?.leash ?? "off";

  const join = async () => {
    setBusy(true);
    try {
      await parksAPI.join(slug, leash);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const flipLeash = async () => {
    const next = leash === "on" ? "off" : "on";
    setBusy(true);
    try {
      await parksAPI.setLeash(slug, next);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const publish = async (e) => {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      await parksAPI.post(slug, body.trim());
      setBody("");
      await load();
    } finally {
      setSending(false);
    }
  };

  const title = useMemo(() => park?.name || "Park", [park]);

  if (error) {
    return <ErrorState title="This park didn't load" description="It may have closed, or the connection dropped." onRetry={load} />;
  }
  if (!park) return <PageSpinner label="Opening the park" />;

  return (
    <div className="space-y-4">
      <Link to="/parks" className="inline-flex items-center gap-1 text-micro font-semibold text-ink-3 hover:text-ink-1">
        <ArrowLeft size={12} aria-hidden="true" /> All parks
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-1">{title}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Boundary park={park} />
          <span className="inline-flex items-center gap-1 text-micro text-ink-3">
            <Users size={11} aria-hidden="true" /> {park.members}
          </span>
          <span className="inline-flex items-center gap-1 text-micro text-ink-3">
            <ShieldCheck size={11} aria-hidden="true" /> {ENTRY_COPY[park.entry_rule]}
          </span>
        </div>
        {park.description && <p className="max-w-prose text-xs leading-relaxed text-ink-2">{park.description}</p>}
      </header>

      {park.rules?.length > 0 && (
        <section aria-labelledby="park-rules" className="rounded-2xl border border-edge-1 bg-surface-1 p-3.5">
          <h2 id="park-rules" className="text-micro font-bold uppercase tracking-[0.14em] text-ink-4">
            Rules at the gate
          </h2>
          <ul className="mt-1.5 space-y-1">
            {park.rules.map((rule) => (
              <li key={rule} className="text-2xs leading-relaxed text-ink-2">
                · {rule}
              </li>
            ))}
          </ul>
        </section>
      )}

      {inside ? (
        <section
          aria-labelledby="park-leash"
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-edge-1 bg-surface-1 p-3.5"
        >
          <div className="min-w-0">
            <h2 id="park-leash" className="text-xs font-bold text-ink-1">
              {leash === "on" ? "Your shop name is on here" : "You're here as a neighbour"}
            </h2>
            <p className="mt-0.5 text-micro text-ink-4">
              {leash === "on"
                ? "Posts in this park carry your business name."
                : "Posts in this park carry only your handle. Your shop is not linked."}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={flipLeash} loading={busy}>
            {leash === "on" ? "Take the leash off" : "Put my shop name on"}
          </Button>
        </section>
      ) : (
        <section className="rounded-2xl border border-edge-1 bg-surface-1 p-3.5">
          <h2 className="text-xs font-bold text-ink-1">
            {park.entry_rule === "ask" ? "Knock to come in" : "Come in"}
          </h2>
          <p className="mt-0.5 text-micro text-ink-4">
            You'll enter off-leash: only your handle shows. You can put your shop name on once you're inside.
          </p>
          <Button size="sm" className="mt-2" onClick={join} loading={busy}>
            {park.entry_rule === "ask" ? "Knock" : "Walk in"}
          </Button>
        </section>
      )}

      {inside && (
        <form onSubmit={publish} className="flex items-end gap-2">
          <Input
            aria-label="Say something in this park"
            placeholder="Say something to the park"
            value={body}
            maxLength={2000}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button type="submit" size="sm" loading={sending} disabled={!body.trim()} aria-label="Post">
            <Send size={13} aria-hidden="true" />
          </Button>
        </form>
      )}

      {feed.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-edge-1 px-3.5 py-6 text-center text-2xs text-ink-4">
          Nothing said here yet. {inside ? "You could start." : "Join to add your voice."}
        </p>
      ) : (
        <ul className="space-y-2">
          {feed.map((post) => (
            <li key={post.id} data-testid="park-post" className="rounded-2xl border border-edge-1 bg-surface-1 p-3">
              <div className="flex items-baseline gap-1.5">
                <span className="text-micro font-bold text-ink-1">
                  {post.author.business || `@${post.author.handle}`}
                </span>
                {post.author.business && (
                  <span className="text-micro text-ink-4">@{post.author.handle}</span>
                )}
                {post.leash === "off" && (
                  <span className="ml-auto text-micro text-ink-4">off-leash</span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-2">{post.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ParksPage;
