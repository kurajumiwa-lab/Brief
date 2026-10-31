import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, BadgeCheck, ChevronRight, Inbox, RefreshCw, Search, Sparkles,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import NeedPicker, { NeedRow, deskIcon } from "@/components/desk/NeedPicker";
import ServiceCard from "@/components/desk/ServiceCard";
import ServiceDetail from "@/components/desk/ServiceDetail";
import RequestForm from "@/components/desk/RequestForm";
import { catalogAPI, apiError } from "@/lib/api";
import { tintForDesk } from "@/config/categoryTints";
import { useAuthStore } from "@/stores/authStore";
import { num } from "@/lib/formatters";
import { BRAND } from "@/config/brand";
import { cn } from "@/lib/utils";

/**
 * THE BUSINESS DESK — choose a need, see the service, review the offer, request.
 *
 * The storefront this replaces opened with twelve long descriptions, four
 * account tiers, a trial disclosure and a BYOD comparison, and asked the reader
 * to find the thing they wanted inside it. The information was all true; the
 * order was the problem. A buyer arrives with a *need*, not with our product
 * structure, so the screen now asks the only question they can answer:
 *
 *     What does your business need?
 *
 * The five answers are a buying taxonomy, not a commercial one. Behind each
 * sits the same catalogue — nothing was rewritten, no price was invented, no
 * offer was dropped. The accounts, the trial and the BYOD comparison still
 * exist, one press away, because a buyer who wants them is asking a different
 * question and should not have to scroll past them to find a website.
 *
 * Everything is URL state (`?desk=`, `?offer=`, `?view=`), so Back walks the
 * same path the buyer took and a link to one service is a link a human can send.
 */

// The picker is the front door, but it should not re-open on every return
// inside the same session — the page underneath already lists the five needs.
// Remembered per tab, so a refresh is still "the same visit".
const PICKER_SEEN_KEY = "brief.desk.pickerSeen";

function pickerWasSeen() {
  try {
    return sessionStorage.getItem(PICKER_SEEN_KEY) === "1";
  } catch {
    return false;      // private mode / no storage: the picker just opens again
  }
}

function rememberPicker() {
  try {
    sessionStorage.setItem(PICKER_SEEN_KEY, "1");
  } catch {
    /* no storage, no harm */
  }
}

const VIEWS = { home: "home", accounts: "accounts" };

function money(offer) {
  if (offer.price_min_kes == null) return null;
  return offer.price_unit === "monthly"
    ? `from KSh ${num(offer.price_min_kes)}/mo`
    : `from KSh ${num(offer.price_min_kes)}`;
}

export default function BusinessDeskPage() {
  const token = useAuthStore((s) => s.token);
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [mine, setMine] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [requestKind, setRequestKind] = useState("");

  const deskKey = params.get("desk") || "";
  const offerKey = params.get("offer") || "";
  const view = params.get("view") || VIEWS.home;

  const patch = useCallback(
    (next) => {
      const p = new URLSearchParams(params);
      for (const [key, value] of Object.entries(next)) {
        if (value) p.set(key, value);
        else p.delete(key);
      }
      setParams(p);
    },
    [params, setParams],
  );

  const loadMine = useCallback(() => {
    if (!token) return;
    catalogAPI.myEnquiries().then((r) => setMine(r.data || [])).catch(() => {});
  }, [token]);

  useEffect(() => {
    catalogAPI
      .catalogue()
      .then((r) => setData(r.data))
      .catch((e) => setError(apiError(e, "The business desk could not be loaded")));
    loadMine();
  }, [loadMine]);

  // Arriving with nothing chosen is the moment the picker is for.
  useEffect(() => {
    if (!data || pickerWasSeen()) return;
    if (deskKey || offerKey || view !== VIEWS.home) return;
    rememberPicker();
    setPickerOpen(true);
  }, [data, deskKey, offerKey, view]);

  if (error) {
    return (
      <DeskShell>
        <div className="rounded-xl border border-edge-1 bg-surface-1 p-6 text-center">
          <p className="text-sm font-semibold text-ink-1">{error}</p>
          <Button className="mt-3" variant="secondary" icon={RefreshCw} onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </DeskShell>
    );
  }
  if (!data) {
    return (
      <DeskShell>
        <PageSpinner label="Loading the business desk…" />
      </DeskShell>
    );
  }

  const desks = data.desks || [];
  const offers = data.offers || [];
  const offer = offerKey ? offers.find((o) => o.key === offerKey) : null;
  const desk = desks.find((d) => d.key === (deskKey || offer?.desk)) || null;
  const trial = data.trial;

  const chooseDesk = (key) => {
    setPickerOpen(false);
    setQuery("");
    patch({ desk: key, offer: "", view: "" });
  };
  const chooseOffer = (key) => patch({ offer: key, view: "" });
  // Back from a service lands on the desk it belongs to, even when the reader
  // arrived by deep link and never saw the picker.
  const backToDesk = () => patch({ offer: "", desk: offer?.desk || deskKey });

  const submit = async (values) => {
    if (!token) return;
    setBusy(true);
    try {
      await catalogAPI.createEnquiry({
        kind: values.kind,
        offer_key: offer?.key || undefined,
        desk_key: offer?.desk || desk?.key || "custom",
        tier_key: values.kind === "trial" ? "business" : undefined,
        organisation_name: values.organisation_name || undefined,
        contact_phone: values.contact_phone || undefined,
        notes: values.notes || undefined,
        acknowledged_first_charge: values.kind === "trial" ? values.acknowledged_first_charge : false,
      });
      toast.success(
        "Request recorded — a human follows up with scope and a written quotation. No payment was taken.",
      );
      setRequestKind("");
      loadMine();
    } catch (err) {
      toast.error(apiError(err, "Could not record the request"));
    } finally {
      setBusy(false);
    }
  };

  // ── search: both decisive buyers and businesses that need guidance ────────
  const q = query.trim().toLowerCase();
  const matches = q
    ? offers.filter((o) =>
        [o.name, o.turnaround, ...(o.deliverables || []), ...(o.customer_must_provide || [])]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : [];
  const matchedDesks = q
    ? desks.filter((d) => `${d.title} ${d.blurb}`.toLowerCase().includes(q))
    : [];

  return (
    <DeskShell signedIn={!!token}>
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="What does your business need?"
        description="Five starting points. Pick one and the desk shows only what belongs to it."
        size="md"
      >
        <div className="px-1 pb-2 sm:px-2">
          <NeedPicker desks={desks} activeKey={deskKey} onSelect={chooseDesk} />
          <p className="mt-2 px-1 text-micro text-ink-4">
            Not sure? Pick <strong className="font-semibold text-ink-3">Custom business solutions</strong> and
            describe it in one line — a human reads every one of those.
          </p>
        </div>
      </Modal>

      {/* ── the desk home: one question, five answers ─────────────────────── */}
      {view === VIEWS.home && !desk && (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-ink-1 sm:text-3xl">
              What does your business need?
            </h1>
            <p className="mt-1 text-sm text-ink-3">
              Find a service, software solution or operational support for your organisation.
            </p>
          </div>

          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Describe what your business needs — “website”, “member register”…"
              aria-label="Describe what your business needs"
              data-testid="desk-search"
              className="h-10 w-full rounded-xl border border-edge-2 bg-surface-0 pl-9 pr-3 text-sm text-ink-1 placeholder:text-ink-4 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
            />
          </div>

          {q ? (
            <SearchResults
              query={query}
              desks={matchedDesks}
              offers={matches}
              onDesk={chooseDesk}
              onOffer={(o) => patch({ desk: o.desk, offer: o.key, view: "" })}
              onCustom={() => {
                setRequestKind("requirements");
                patch({ desk: "custom", view: "", offer: "" });
              }}
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-edge-1 bg-surface-0">
              <NeedPicker desks={desks} activeKey={deskKey} onSelect={chooseDesk} />
            </div>
          )}

          {!q && mine.length > 0 && <MyRequests mine={mine} />}
        </div>
      )}

      {/* ── one desk: only the services that answer that need ─────────────── */}
      {view === VIEWS.home && desk && !offer && (
        <section data-testid="desk-services" data-desk={desk.key} className="space-y-3">
          <button
            type="button"
            onClick={() => patch({ desk: "", offer: "", view: "" })}
            className="inline-flex items-center gap-1 text-micro font-semibold text-ink-3 hover:text-ink-1"
          >
            <ArrowLeft size={12} aria-hidden="true" /> All needs
          </button>

          <DeskHeading desk={desk} />

          {desk.enquiry_only ? (
            <RequestForm
              kind="requirements"
              desk={desk}
              trial={trial}
              signedIn={!!token}
              busy={busy}
              onSubmit={submit}
            />
          ) : (
            <>
              <p className="text-2xs text-ink-4">
                Choose the service your business requires. Prices are test ranges — a written
                quotation confirms the real one.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {desk.offers.map((o) => (
                  <ServiceCard
                    key={o.key}
                    offer={o}
                    deskKey={desk.key}
                    onSelect={chooseOffer}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => patch({ desk: "custom", view: "" })}
                className="inline-flex items-center gap-1 text-micro font-semibold text-brand-700 hover:underline dark:text-brand-400"
              >
                None of these? Describe what you need
                <ArrowRight size={11} aria-hidden="true" />
              </button>
            </>
          )}
        </section>
      )}

      {/* ── one service: its own scope, then one next step ────────────────── */}
      {view === VIEWS.home && offer && (
        <div className="space-y-3">
          <ServiceDetail
            offer={offer}
            desk={desk}
            onBack={backToDesk}
            onRequest={(kind) => setRequestKind(kind)}
          />
          {requestKind && (
            <RequestForm
              kind={requestKind}
              offer={offer}
              desk={desk}
              trial={trial}
              signedIn={!!token}
              busy={busy}
              onSubmit={submit}
              onCancel={() => setRequestKind("")}
            />
          )}
        </div>
      )}

      {/* ── accounts, trial and BYOD: kept, and out of the buyer's way ────── */}
      {view === VIEWS.accounts && (
        <AccountsAndTrial
          data={data}
          trial={trial}
          signedIn={!!token}
          busy={busy}
          onSubmit={submit}
          onBack={() => patch({ view: "" })}
        />
      )}
    </DeskShell>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function DeskHeading({ desk }) {
  const Icon = deskIcon(desk.key);
  const tint = tintForDesk(desk.key);
  return (
    <div className="flex items-start gap-3">
      <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", tint.wash, tint.ink)} aria-hidden="true">
        <Icon size={20} strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <p className="text-micro font-bold uppercase tracking-[0.12em] text-ink-4">Business services</p>
        <h1 className="text-xl font-extrabold tracking-tight text-ink-1 sm:text-2xl">{desk.title}</h1>
        <p className="mt-0.5 text-2xs text-ink-3">{desk.blurb}</p>
      </div>
    </div>
  );
}

function SearchResults({ query, desks, offers, onDesk, onOffer, onCustom }) {
  const empty = desks.length === 0 && offers.length === 0;
  return (
    <div className="space-y-2" data-testid="desk-search-results">
      {desks.map((desk) => (
        <NeedRow key={desk.key} desk={desk} onSelect={() => onDesk(desk.key)} />
      ))}
      {offers.map((offer) => {
        const tint = tintForDesk(offer.desk);
        return (
          <button
            key={offer.key}
            type="button"
            onClick={() => onOffer(offer)}
            data-testid={`desk-match-${offer.key}`}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2"
          >
            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", tint.wash, tint.ink)} aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink-1">{offer.name}</span>
              <span className="block truncate text-2xs text-ink-3">{offer.cta?.label}</span>
            </span>
            <span className="shrink-0 text-micro tabular-nums text-ink-4">
              {money(offer) || "Quoted"}
            </span>
            <ChevronRight size={13} className="shrink-0 text-ink-4" aria-hidden="true" />
          </button>
        );
      })}
      {empty && (
        <div className="rounded-xl border border-dashed border-edge-1 px-3 py-4 text-center" data-testid="desk-no-match">
          <p className="text-2xs text-ink-3">
            Nothing on the desk matches “{query}” — which is a useful answer.
          </p>
          <button
            type="button"
            onClick={onCustom}
            className="mt-1.5 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
          >
            Send it to a human instead
          </button>
        </div>
      )}
    </div>
  );
}

function MyRequests({ mine }) {
  return (
    <section aria-label="Your requests" className="rounded-xl border border-edge-1 bg-surface-1 p-3">
      <h2 className="text-micro font-bold uppercase tracking-[0.12em] text-ink-4">Your requests</h2>
      <ul className="mt-1.5 divide-y divide-edge-1">
        {mine.slice(0, 5).map((enquiry) => (
          <li key={enquiry.id} className="flex items-center justify-between gap-2 py-1.5 text-2xs">
            <span className="min-w-0 truncate text-ink-2">
              {enquiry.offer_name || enquiry.desk_title || enquiry.kind}
            </span>
            <Badge variant={enquiry.status === "new" ? "amber" : "gray"} size="xs">
              {enquiry.status}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AccountsAndTrial({ data, trial, signedIn, busy, onSubmit, onBack }) {
  return (
    <section className="space-y-4" data-testid="desk-accounts">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-micro font-semibold text-ink-3 hover:text-ink-1"
      >
        <ArrowLeft size={12} aria-hidden="true" /> Business desk
      </button>

      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink-1">Accounts, tiers and trial</h1>
        <p className="mt-1 max-w-2xl text-2xs text-ink-3">{data.verification_note}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {data.account_tiers.map((tier) => (
          <div key={tier.key} className="rounded-xl border border-edge-1 bg-surface-0 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-ink-1">{tier.name}</p>
              <Badge variant={tier.key === "junior" ? "amber" : "gray"} size="xs">{tier.label}</Badge>
            </div>
            <p className="mt-1 text-base font-extrabold tabular-nums text-ink-1">
              {tier.key === "junior"
                ? "KSh 0"
                : tier.price_min_kes == null
                  ? "Custom"
                  : `KSh ${num(tier.price_min_kes)}–${num(tier.price_max_kes)}/mo`}
            </p>
            <p className="mt-1 text-2xs text-ink-3">{tier.purpose}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-edge-1 bg-surface-0 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-ink-1">Business trial — 30 days</h2>
          <Badge variant="amber" size="xs">
            {trial.status === "not_yet_live" ? "Not yet live — trial requests only" : trial.status}
          </Badge>
        </div>
        <p className="mt-1 text-2xs text-ink-3">{trial.status_note}</p>
        <p className="mt-2 text-2xs text-ink-2">
          Example disclosure: first charge of <strong>KSh {num(trial.example.first_charge_amount_kes)}</strong>{" "}
          on <strong>{trial.example.first_charge_date}</strong> after a {trial.example.trial_days}-day
          trial, with a reminder {trial.example.reminder_days_before_charge} days before.
        </p>
        <ul className="mt-2 space-y-1 pl-4 text-2xs text-ink-3 list-disc">
          {trial.card_rules.map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
        <div className="mt-2">
          <RequestForm
            kind="trial"
            trial={trial}
            signedIn={signedIn}
            busy={busy}
            onSubmit={(values) => onSubmit({ ...values, kind: "trial" })}
          />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-bold text-ink-1">Don't overlook the buyer who already has a phone</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {data.byod_vs_managed.map((mode) => (
            <div key={mode.key} className="rounded-xl border border-edge-1 bg-surface-0 p-3">
              <p className="text-sm font-bold text-ink-1">{mode.name}</p>
              <p className="mt-0.5 text-2xs text-ink-3">{mode.headline}</p>
              <p className="mt-2 text-micro font-semibold text-ink-2">Includes</p>
              <ul className="mt-0.5 space-y-0.5 pl-3 text-2xs text-ink-3 list-disc">
                {mode.includes.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p className="mt-2 text-micro font-semibold text-ink-2">Limits — stated, not promised away</p>
              <ul className="mt-0.5 space-y-0.5 pl-3 text-2xs text-ink-3 list-disc">
                {mode.limits.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DeskShell({ children, signedIn }) {
  return (
    <div className="min-h-screen bg-surface-1">
      <header className="border-b border-edge-1 bg-surface-0">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <Link to="/storefront" className="min-w-0 text-base font-extrabold tracking-tight text-ink-1">
            {BRAND.wordmark || "Brief"}_ <span className="font-medium text-ink-3">Business Desk</span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/storefront?view=accounts"
              className="hidden text-2xs font-semibold text-ink-3 hover:text-ink-1 sm:inline"
            >
              Accounts & trial
            </Link>
            <Link to="/storefront/inbox" aria-label="Enquiry inbox" className="text-ink-3 hover:text-ink-1">
              <Inbox size={16} aria-hidden="true" />
            </Link>
            {signedIn ? (
              <Link to="/"><Button size="sm" variant="secondary">Open the app</Button></Link>
            ) : (
              <Link to="/auth" state={{ from: "/storefront" }}><Button size="sm">Sign in</Button></Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        {children}
        <p className="flex items-start gap-1.5 pb-4 text-micro text-ink-4">
          <BadgeCheck size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          Prices are test ranges, not commitments — confirmed in writing per contract before payment.
          No card details are ever collected here.
        </p>
      </main>
    </div>
  );
}
