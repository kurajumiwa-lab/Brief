import '../../ui/compact.css';
import React, { useEffect, useState } from "react";
import {
  User, ShieldCheck, Heart, Store, Package, Users, Coins, Landmark,
  CreditCard, Archive, BookOpen, Globe, Bell, Lock
} from "lucide-react";
import { MenuTile, SectionHeader } from "../../ui/MenuTile";
import * as api from "../../api/briefApi";
import type { AuthedUser, PersonMe, FollowsGroups, MyCommitments, MyPosition, MyReciprocity, Precedent } from "../../api/briefApi";
import type { Space } from "../../api/types";
import type { Subscription, SubscriptionJoin } from "../../api/types";
import { MotionList } from "../../ui/motion/MotionList";
import { MotionStatus } from "../../ui/motion/MotionStatus";
import { EarnSurface } from "./EarnSurface";
import { TableBankingSurface } from "./TableBankingSurface";
import { HowBriefWorks } from "./HowBriefWorks";
import { hrefForDest } from "../../app/surfaces";
import { GuardianNetwork } from "./GuardianNetwork";
import { Vault } from "../../components/vault/Vault";
import { StandingLine } from '../home/StandingLine';
import { PositionCard } from "../home/PositionCard";
import { CommitmentsCard } from "../home/CommitmentsCard";
import { ReciprocityCard } from "../home/ReciprocityCard";
import { SessionSignIn } from "../../components/SessionSignIn";
import { NotificationCenter } from "../../components/NotificationCenter";

// ---------------------------------------------------------------------------
// YOU — the member's own profile, follows and subscriptions (Phase 3).
//
// The surface the production shell was missing: a person can see WHO they are
// (handle, standing, provenance), WHOM they follow (entities, with unfollow),
// and WHICH creators they subscribe to (paid plans, joined honestly).
//
// Two honest rails for "follow a creator", never collapsed into one button:
//   * FOLLOW an ENTITY (venue/business/publisher/organizer/community) — free,
//     via /api/entities/:id/follow.
//   * SUBSCRIBE to a creator's paid PLAN — via /api/subscriptions/:id/subscribe,
//     which records the membership but is honest that no money moved while no
//     payment provider is connected ("recorded, not charged").
//
// Everything is read from real server rows; a signed-out caller gets the
// signed-out state, and an empty list is shown as empty, never fabricated.
// ---------------------------------------------------------------------------

// The same key the belt's area chip writes and PlannedWeather reads. The
// privacy screen names this store because it is the one place-specific thing
// this device is allowed to hold.
const PLACE_KEY = "brief.world.place";

function readPlace(): string {
  try { return localStorage.getItem(PLACE_KEY) ?? ""; } catch { return ""; }
}

const KIND_LABELS: Record<string, string> = {
  venue: "Places",
  business: "Businesses",
  publisher: "Publishers",
  organizer: "Organizers",
  community: "Communities"
};

// The grouping of the You surface, in one list so the order, the labels and the
// membership of each group are stated once. Kept as data (not as markup) so the
// suite can assert that no section was silently dropped in a reorganisation:
// Commerce aliases stay routable, but are not duplicated in this menu.
const YOU_GROUPS: Array<{ id: string; label: string; items: Array<{ id: Section; label: string }> }> = [
  { id: 'identity', label: 'Activity & connections', items: [{ id: 'standing', label: 'Standing' }, { id: 'following', label: 'Following' }, { id: 'network', label: 'Your network' }] },
  { id: 'money', label: 'Money', items: [{ id: 'earn', label: 'Earn' }, { id: 'tableBanking', label: 'Table Banking' }, { id: 'subscriptions', label: 'Subscriptions' }, { id: 'archive', label: 'Archive' }] },
  { id: 'settings', label: 'Settings & help', items: [{ id: 'language', label: 'Language' }, { id: 'notifications', label: 'Notifications' }, { id: 'privacy', label: 'Privacy & sign out' }, { id: 'how', label: 'How it works' }] },
];

export type YouSection =
  | "profile" | "standing" | "following" | "subscriptions"
  | "earn" | "orders" | "selling" | "archive" | "tableBanking" | "network" | "how"
  | "language" | "notifications" | "privacy";

type Section = YouSection;

export const YOU_SECTION_IDS: YouSection[] = ['profile', 'orders', 'selling', ...YOU_GROUPS.flatMap((g) => g.items.map((i) => i.id))];

export const SECTION_TITLES: Record<Section, string> = {
  profile: "Profile",
  standing: "Standing",
  following: "Following",
  selling: "Selling",
  orders: "Orders",
  network: "Your network",
  earn: "Earn",
  tableBanking: "Table Banking",
  subscriptions: "Subscriptions",
  archive: "Archive",
  how: "How Wairo works",
  language: "Language",
  notifications: "Notifications",
  privacy: "Privacy"
};

export function YouSurface({
  onOpenEntity,
  onRequireAuth,
  initialSection,
  openSection,
  onOpenSection
}: {
  onOpenEntity: (entityId: string) => void;
  onRequireAuth: () => void;
  /** Deep link from the ⓘ on Home: the audit screen is a tab, not a footnote. */
  initialSection?: Section | null;
  /** When the shell owns the URL (`#you/<section>`), this is the inline detail. */
  openSection?: Section | null;
  onOpenSection?: (section: Section | null) => void;
}) {
  const [localSection, setLocalSection] = useState<Section | null>(initialSection ?? null);
  const section = onOpenSection ? (openSection ?? null) : localSection;
  const setSection = (next: Section | null) => {
    if (onOpenSection) onOpenSection(next);
    else setLocalSection(next);
  };
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [me, setMe] = useState<AuthedUser | null>(null);
  const [person, setPerson] = useState<PersonMe | null>(null);
  const [provenance, setProvenance] = useState<string | null>(null);
  const [follows, setFollows] = useState<FollowsGroups | null>(null);
  const [plans, setPlans] = useState<Subscription[] | null>(null);
  const [myPlans, setMyPlans] = useState<Subscription[] | null>(null);
  const [notice, setNotice] = useState<string>("");
  // Read once for the privacy screen's "what this device keeps" line.
  const [place, setPlace] = useState<string>(readPlace);
  // The position reads. Fetched here, once, and handed to every surface that
  // renders them so the hero and the detail cards can never disagree.
  const [position, setPosition] = useState<MyPosition | null>(null);
  const [commitments, setCommitments] = useState<MyCommitments | null>(null);
  const [reciprocity, setReciprocity] = useState<MyReciprocity | null>(null);
  const [precedent, setPrecedent] = useState<Precedent | null>(null);
  const [mySpaces, setMySpaces] = useState<Space[]>([]);
  const [positionDenied, setPositionDenied] = useState<boolean>(false);
  const [positionAttempt, setPositionAttempt] = useState(0);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    const [who, per, acq] = await Promise.all([
      api.whoAmI(),
      api.getPersonMe(),
      api.getMyAcquisition()
    ]);
    setLoading(false);
    if (!who.ok && who.status === 401) {
      setSignedOut(true);
      return;
    }
    setSignedOut(false);
    setMe(who.ok ? who.data : null);
    setPerson(per.ok ? per.data : null);
    if (acq.ok && acq.data.acquisition) {
      const a = acq.data.acquisition;
      const parts = [a.partnerName ?? a.partnerKey, a.cohortName ?? a.cohortKey, a.channel ? `via ${a.channel}` : ""]
        .filter(Boolean);
      setProvenance(parts.length ? parts.join(" · ") : null);
    } else {
      setProvenance(null);
    }
  };

  const loadFollowing = async () => {
    const res = await api.getMyFollows();
    if (res.ok) setFollows(res.data);
  };
  const loadPlans = async () => {
    const [pub, mine] = await Promise.all([api.browseSubscriptions(), api.getMySubscriptions()]);
    if (pub.ok) setPlans(pub.data);
    if (mine.ok) setMyPlans(mine.data);
  };

  useEffect(() => {
    void load();
  }, []);

  // The dossier read: five derived endpoints, one pass, no refetch storm.
  useEffect(() => {
    let live = true;
    void Promise.all([
      api.getMyPosition(),
      api.getMyCommitments(),
      api.getMyReciprocity(),
      api.getPrecedent(),
      api.listMySpaces()
    ]).then(([pos, cmt, rec, pre, sp]) => {
      if (!live) return;
      setPositionDenied(!pos.ok && pos.status === 401);
      setPosition(pos.ok ? pos.data : null);
      setCommitments(cmt.ok ? cmt.data : null);
      setReciprocity(rec.ok ? rec.data : null);
      setPrecedent(pre.ok ? pre.data : null);
      setMySpaces(sp.ok && sp.data?.spaces ? sp.data.spaces : []);
    });
    return () => { live = false; };
  }, [positionAttempt]);

  useEffect(() => {
    if (section === "following") void loadFollowing();
    if (section === "subscriptions") void loadPlans();
  }, [section]);

  const unfollow = async (id: string, name: string) => {
    setBusy((p) => ({ ...p, [`u:${id}`]: true }));
    const res = await api.unfollowEntity(id);
    setBusy((p) => ({ ...p, [`u:${id}`]: false }));
    if (res.ok) {
      setNotice(`Unfollowed ${name}.`);
      void loadFollowing();
    } else {
      setNotice(res.error ?? "Could not unfollow.");
    }
  };

  const subscribe = async (plan: Subscription) => {
    setBusy((p) => ({ ...p, [`s:${plan.id}`]: true }));
    const res = await api.subscribeToPlan(plan.id);
    setBusy((p) => ({ ...p, [`s:${plan.id}`]: false }));
    if (res.ok) {
      const j: SubscriptionJoin = res.data;
      setNotice(j.charged ? `Subscribed to ${plan.title}.` : `Joined ${plan.title} — recorded, not charged (no payment provider).`);
      void loadPlans();
    } else if (res.status === 401) {
      onRequireAuth();
    } else {
      setNotice(res.error ?? "Could not subscribe.");
    }
  };

  const signOut = async () => {
    await api.logout();
    setMe(null);
    setPerson(null);
    setSignedOut(true);
  };


  if (loading) {
    return <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Reading your profile…</p>;
  }

  if (signedOut) {
    // A dead end, not a gate. This panel used to say "Sign in to see your
    // profile" with no way to do it — no field, no button, nothing to click —
    // so a signed-out member on #you could only read the sentence and leave.
    // The form is the one the Requests workspace already uses: handle +
    // password, and a real "create account" toggle, because a fresh deployment
    // has no account to sign in to yet.
    return (
      <div className="mt-6 space-y-3">
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Your identity, follows and subscriptions are yours alone — they are on
          this device only once you are signed in.
        </p>
        <SessionSignIn onSignedIn={load} title="Sign in to see your profile" />
      </div>
    );
  }

  const shelf = (id: Section, body: React.ReactNode) => (
    <div className="space-y-3" data-testid={`you-shelf-${id}`}>
      {notice && (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }} role="status">{notice}</p>
      )}
      {body}
    </div>
  );

  return (
    <section className="compact-surface" aria-label="You">
      {!section && <>
      {/* Profile first: who you are, then where to go. The groups below are
          quiet rows — typography and spacing, not tiles. Same groups, same
          sections, same test ids; only the shape changed. */}
      <button
        type="button"
        data-testid="you-profile-head"
        onClick={() => { setSection("profile"); setNotice(""); }}
        className="w-full flex items-center gap-3 py-2 text-left cursor-pointer"
      >
        <span
          className="w-12 h-12 rounded-full grid place-items-center text-[18px] font-black shrink-0"
          style={{ background: 'var(--navy)', color: '#FFFFFF' }}
          aria-hidden="true"
        >
          {(me?.displayName ?? "Y").trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-bold leading-tight truncate" style={{ color: 'var(--brief-ink)' }}>
            {me?.displayName ?? "You"}
          </span>
          {me?.handle ? (
            <span className="block text-[12px]" style={{ color: 'var(--muted-ink)' }}>@{me.handle}</span>
          ) : null}
        </span>
        <span className="text-[13px] font-bold shrink-0" style={{ color: 'var(--color-primary)' }}>
          View profile
        </span>
      </button>
      <div className="space-y-1 mt-2" data-testid="you-tile-grid">
        {YOU_GROUPS.map((group) => (
          <details key={group.id} className="compact-disclosure">
            <summary>{group.label}</summary>
            <div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={item.id}
                  onClick={() => { setSection(item.id); setNotice(""); }}
                  className="w-full flex items-center justify-between py-2.5 text-left cursor-pointer"
                  style={{ borderBottom: '1px solid var(--divider)' }}
                >
                  <span className="text-[15px] font-semibold" style={{ color: section === item.id ? 'var(--color-primary)' : 'var(--brief-ink)' }}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>

      <a className="compact-row" href="#spaces/orders">Orders & selling <span aria-hidden="true">→</span></a>
      </>}
      {section && <div className="space-y-4" data-testid="you-detail">
        <header className="compact-heading"><button type="button" onClick={() => { setSection(null); setNotice(''); }} aria-label="Back to You">← You</button><h1>{SECTION_TITLES[section]}</h1></header>
      {section === "profile" && shelf("profile", (
        <div className="space-y-3">
          <div>
            <p className="text-2xl font-black tracking-tight" style={{ color: "var(--color-text)" }}>
              {me?.displayName ?? me?.handle ?? "You"}
            </p>
            {me?.handle && <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>@{me.handle}</p>}
          </div>

          {person?.standing && (
            <div
              className="rounded-2xl p-5 grid grid-cols-4 gap-3"
              style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
            >
              {[
                ["hosted", person.standing.hosted],
                ["bought", person.standing.bought],
                ["arrived", person.standing.arrived],
                ["registered", person.standing.registered]
              ].map(([k, v]) => (
                <div key={k as string}>
                  <p className="text-2xl font-black" style={{ color: "var(--color-text)" }}>{v}</p>
                  <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>{k}</p>
                </div>
              ))}
            </div>
          )}

          {provenance && (
            <div className="rounded-2xl p-4" style={{ background: "var(--color-surface-elevated)" }}>
              <p className="text-xs font-black uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>You came through</p>
              <p className="text-sm mt-1" style={{ color: "var(--color-text)" }}>{provenance}</p>
            </div>
          )}

          <button
            type="button"
            onClick={signOut}
            className="rounded-full px-4 py-2 text-xs font-bold"
            style={{ background: "var(--color-surface-elevated)", color: "var(--color-danger)" }}
          >
            Sign out
          </button>
        </div>
      ))}

      {section === "following" && shelf("following", (
        <div>
          {follows === null ? (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Reading your follows…</p>
          ) : follows.total === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              You are not following anyone yet. Open an entity and follow it.
            </p>
          ) : (
            <MotionList className="space-y-3" stagger={30}>
              {Object.keys(follows.groups).map((kind) => {
                const rows = follows.groups[kind] ?? [];
                if (rows.length === 0) return null;
                return (
                  <div key={kind}>
                    <p className="text-xs font-black uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                      {KIND_LABELS[kind] ?? kind}
                    </p>
                    {rows.map((row) => (
                      <div
                        key={row.id}
                        className="mt-1.5 rounded-xl px-3 py-2 flex items-center justify-between"
                        style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
                      >
                        <button
                          type="button"
                          onClick={() => onOpenEntity(row.id)}
                          className="text-left min-w-0 flex-1"
                        >
                          <p className="text-sm font-bold truncate" style={{ color: "var(--color-text)" }}>{row.name}</p>
                          <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                            {row.objectCount} item{row.objectCount === 1 ? "" : "s"}
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => unfollow(row.id, row.name)}
                          disabled={busy[`u:${row.id}`]}
                          className="rounded-full px-3 py-1.5 text-xs font-bold shrink-0 ml-2"
                          style={{ background: "var(--color-surface-elevated)", color: "var(--color-text)" }}
                        >
                          Unfollow
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </MotionList>
          )}
        </div>
      ))}

      {section === "subscriptions" && shelf("subscriptions", (
        <div className="space-y-6">
          <div>
            <p className="text-xs font-black uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Plans to join</p>
            {plans === null ? (
              <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>Reading plans…</p>
            ) : plans.length === 0 ? (
              <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>No public plans yet.</p>
            ) : (
              <MotionList className="space-y-2 mt-2" stagger={30}>
                {plans.map((plan) => (
                  <div key={plan.id} className="rounded-xl p-3" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-bold" style={{ color: "var(--color-text)" }}>{plan.title}</p>
                        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                          KES {plan.price} / {plan.interval} · {plan.subscriberCount} member{plan.subscriberCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <MotionStatus status={plan.viewerIsSubscriber ? "active" : "pending"} label={plan.viewerIsSubscriber ? "Joined" : "Join"} tier="micro" />
                    </div>
                    {plan.description && <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>{plan.description}</p>}
                    {!plan.viewerIsSubscriber && (
                      <button
                        type="button"
                        onClick={() => subscribe(plan)}
                        disabled={busy[`s:${plan.id}`]}
                        className="mt-2 rounded-full px-3 py-1.5 text-xs font-bold"
                        style={{ background: "var(--color-primary)", color: "var(--accent-ink)" }}
                      >
                        {busy[`s:${plan.id}`] ? "Joining…" : "Subscribe"}
                      </button>
                    )}
                  </div>
                ))}
              </MotionList>
            )}
          </div>

          <div>
            <p className="text-xs font-black uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Your published plans</p>
            {myPlans === null ? (
              <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>Reading your plans…</p>
            ) : myPlans.length === 0 ? (
              <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>You have not published any plans.</p>
            ) : (
              myPlans.map((plan) => (
                <div key={plan.id} className="mt-2 rounded-xl p-3" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                  <p className="text-sm font-bold" style={{ color: "var(--color-text)" }}>{plan.title}</p>
                  <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    KES {plan.price} / {plan.interval} · {plan.subscriberCount} member{plan.subscriberCount === 1 ? "" : "s"} · {plan.status}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      ))}

      {/* ── STANDING — where a member defends their position. Every figure is
             derived from their own rows at read time; there is no rank, no
             tier, no score and nothing stored, so there is nothing to decay
             into a lie. ── */}
      {/* ARCHIVE — the filing cabinet at home. Records and receipts you keep
          for yourself, which is why it sits in You and not in a public gallery
          or a business workspace. */}
      {section === "archive" && shelf("archive", (
        <div className="space-y-3">
          <p className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
            Restricted records and drops you hold or have been granted. An archive is read slowly and kept — it is
            not something to browse between posters.
          </p>
          <Vault />
        </div>
      ))}

      {section === "standing" && shelf("standing", (
        <div className="space-y-3">
          {/* One line, before the three cards: where you actually stand, in the
              counts themselves. The shelf already holds all three reads, so this
              costs no request — and StandingLine renders nothing at all when a
              read failed, so a missing row never becomes an invented standing. */}
          <StandingLine
            position={position}
            commitments={commitments}
            reciprocity={reciprocity}
          />
          <PositionCard position={position} />
          <CommitmentsCard commitments={commitments} />
          <ReciprocityCard reciprocity={reciprocity} />
          <p className="text-[12px] leading-snug" style={{ color: "var(--color-text-muted)" }}>
            Nothing here is a score. Each line is a count over rows you could read yourself — a quote you
            sent, an order you owe, a favour that went unreturned — and a line is shown only while its row
            still exists.
          </p>
        </div>
      ))}

      {/* ── ORDERS / SELLING — the personal halves of commerce, moved off the
             browse screen. Same Marketplace rails, same server-authoritative
             money; only the address changed. ── */}
      {(section === 'orders' || section === 'selling') && <a className="compact-primary" href={`#spaces/${section}`}>Open {section} in Spaces →</a>}

      {section === "earn" && shelf("earn", (
        <EarnSurface onRequireAuth={onRequireAuth} />
      ))}

      {section === "network" && shelf("network", <GuardianNetwork />)}
      {section === "how" && shelf("how", <HowBriefWorks />)}

      {section === "tableBanking" && shelf("tableBanking", (
        <TableBankingSurface onRequireAuth={onRequireAuth} />
      ))}

      {/* ── SETTINGS — the three controls the drawer's Settings group names.
          Each one answers what it claims; none of them switches nothing. ── */}
      {section === "language" && shelf("language", (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl" style={{ background: "var(--color-surface)", boxShadow: "inset 0 0 0 1px var(--brief-line)" }}>
            <p className="text-sm font-bold" style={{ color: "var(--color-text)" }}>English</p>
            <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
              The app speaks one language. A selector that switched nothing would be a control advertising a
              choice the product does not make, so there is no selector — there is this line instead. A second
              language lands here when the translations are maintained, not before.
            </p>
          </div>
        </div>
      ))}

      {section === "notifications" && shelf("notifications", (
        <div className="space-y-3">
          <NotificationCenter
            authed={!signedOut}
            onClose={() => setSection(null)}
            /* A tap goes where the notification says. Dests this shell has no
               surface for open nothing, rather than landing on a screen that
               looks like the one that was promised. */
            onOpen={(n: any) => {
              const href = hrefForDest(n?.dest);
              if (href && typeof window !== "undefined") window.location.hash = href;
            }}
          />
        </div>
      ))}

      {section === "privacy" && shelf("privacy", (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
            What this device keeps, and how to take it back. Nothing here is a
            toggle that pretends: each row is a real store on this browser, and
            each control acts on it.
          </p>
          <div className="p-4 rounded-2xl space-y-2" style={{ background: "var(--color-surface)", boxShadow: "inset 0 0 0 1px var(--brief-line)" }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Your area</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                  Stored only to read the forecast. {place ? `Set to “${place}”.` : "Not set."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  try { localStorage.removeItem(PLACE_KEY); } catch { /* a locked-down browser keeps its secret */ }
                  setPlace("");
                  setNotice("The area is cleared from this device.");
                }}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer"
                style={{ background: "var(--color-surface-elevated)", color: "var(--color-text)" }}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="p-4 rounded-2xl space-y-2" style={{ background: "var(--color-surface)", boxShadow: "inset 0 0 0 1px var(--brief-line)" }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Offline queue</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                  {api.offlineQueueDepth() === 0
                    ? "Nothing is parked — every write reached the server."
                    : api.offlineQueueBlockedDepth() > 0
                      ? `${api.offlineQueueBlockedDepth()} pending write${api.offlineQueueBlockedDepth() === 1 ? " is" : "s are"} from another or unverified account. They will not send as this account; sign back in as the original owner to retry.`
                      : `${api.offlineQueueDepth()} write${api.offlineQueueDepth() === 1 ? "" : "s"} waiting for signal; they send only while you are signed in as their owner.`}
                </p>
              </div>
            </div>
          </div>
          <div className="p-4 rounded-2xl space-y-2" style={{ background: "var(--color-surface)", boxShadow: "inset 0 0 0 1px var(--brief-line)" }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Sign out</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                  Ends the session on this device. Rows you wrote stay on the server, where they belong.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { void signOut(); }}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer"
                style={{ background: "var(--color-danger, #B3261E)", color: "#fff" }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      ))}
      </div>}
    </section>
  );
}
