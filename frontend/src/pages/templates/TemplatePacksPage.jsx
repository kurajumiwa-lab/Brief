import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, LayoutTemplate, Lock, ShoppingBag } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { templatePacksAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

/**
 * TEMPLATE PACKS — a shelf offers a choice, not a blank form.
 *
 * A blank page editor asks a wholesaler in Kisii to invent a wholesaler's page.
 * This asks them to pick one, then edits what it created. Each pack is a real
 * business type: the starter offers it usually sells, the free blueprint that
 * goes with it, and the three prices worth photographing first.
 *
 * Two rules the screen states out loud, because they are the ones that make
 * starting a pack safe:
 *
 *   · everything it creates is a DRAFT — nothing appears on your public page;
 *   · no pack invents a price. Every starter offer says "Ask" until the owner
 *     sets their own number.
 */
export default function TemplatePacksPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const [packs, setPacks] = useState(null);
  const [error, setError] = useState(null);
  const [sector, setSector] = useState("all");
  const [starting, setStarting] = useState(null);

  useEffect(() => {
    templatePacksAPI
      .list()
      .then(({ data }) => setPacks(data.packs || []))
      .catch((err) => setError(apiError(err, "Could not load the templates")));
  }, []);

  const sectors = useMemo(() => {
    const seen = new Map();
    (packs || []).forEach((p) => seen.set(p.sector, (seen.get(p.sector) || 0) + 1));
    return [["all", "All", (packs || []).length], ...Array.from(seen.entries()).map(([k, n]) => [k, k, n])];
  }, [packs]);

  const visible = sector === "all" ? packs || [] : (packs || []).filter((p) => p.sector === sector);

  async function start(pack) {
    if (!token) {
      navigate("/auth", { state: { from: "/templates/packs" } });
      return;
    }
    setStarting(pack.key);
    try {
      const { data } = await templatePacksAPI.start(pack.key);
      const made = data.created || {};
      const total = (made.goods || 0) + (made.service || 0) + (made.tool || 0);
      toast.success(
        total
          ? `${total} draft offer${total === 1 ? "" : "s"} created. Set a price and switch each one on.`
          : "You already have these offers — nothing was duplicated.",
      );
      navigate("/desk");
    } catch (err) {
      toast.error(apiError(err, "Couldn't start that template. Try again."));
    } finally {
      setStarting(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-16">
      <header className="space-y-1.5">
        <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
          <LayoutTemplate size={13} aria-hidden="true" /> Templates
        </p>
        <h1 className="text-xl font-semibold text-ink-1">Start from a business like yours</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-3">
          Pick the closest type of business. We fill in the offers it usually sells, the free
          starter steps that go with it, and the first prices worth checking — then you edit
          them. <span className="font-semibold text-ink-2">Nothing is published until you do.</span>
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1" role="group" aria-label="Filter by sector">
          {sectors.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSector(key)}
              aria-pressed={sector === key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-2xs font-bold transition-colors",
                sector === key
                  ? "border-ink-1 bg-ink-1 text-surface-0"
                  : "border-edge-1 bg-surface-0 text-ink-3 hover:border-edge-2 hover:text-ink-1",
              )}
            >
              {label}
              <span className={cn("tabular-nums", sector === key ? "text-surface-0/70" : "text-ink-4")}>
                {count}
              </span>
            </button>
          ))}
        </div>
      </header>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!packs && !error && <PageSpinner />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((pack) => (
          <Card key={pack.key} padding="p-4" className="flex h-full flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="brand">Free</Badge>
              <Badge variant="gray">{pack.offer_count} offers</Badge>
              <Badge variant="gray">{pack.sector}</Badge>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-1">{pack.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{pack.summary}</p>
            </div>

            {pack.first_observations?.length > 0 && (
              <div className="rounded-lg bg-surface-2 px-2.5 py-2">
                <p className="text-micro font-bold uppercase tracking-wide text-ink-4">
                  Check these prices first
                </p>
                <p className="mt-0.5 text-micro leading-relaxed text-ink-2">
                  {pack.first_observations.join(" · ")}
                </p>
              </div>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={() => start(pack)}
                disabled={starting === pack.key}
              >
                {starting === pack.key ? "Starting…" : "Start this"}
                <ArrowRight size={13} aria-hidden="true" />
              </Button>
              <Link
                to={`/templates/packs/${pack.key}`}
                className="text-2xs font-bold text-ink-3 hover:text-ink-1"
              >
                See what's inside
              </Link>
            </div>
          </Card>
        ))}
      </div>

      <p className="flex items-start gap-1.5 rounded-card border border-edge-1 bg-surface-1 p-3 text-micro leading-relaxed text-ink-3">
        <Lock size={12} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" />
        Every offer a template creates is switched off and priced “Ask”. That is deliberate: a
        template that guessed your prices would teach you to guess, and a page that went live
        before you read it would be our words in your name.
      </p>

      <p className="flex items-start gap-1.5 text-micro text-ink-4">
        <ShoppingBag size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
        Looking for the step-by-step business starters instead?{" "}
        <Link to="/templates" className="font-bold text-brand-700 hover:underline dark:text-brand-300">
          Free blueprints
        </Link>
      </p>
    </div>
  );
}

/** One pack, in full, before anyone commits to it. */
export function TemplatePackDetailPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const [pack, setPack] = useState(null);
  const [error, setError] = useState(null);
  const key = window.location.pathname.split("/").pop();

  useEffect(() => {
    templatePacksAPI
      .one(key)
      .then(({ data }) => setPack(data))
      .catch((err) => setError(apiError(err, "Could not load that template")));
  }, [key]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <p role="alert" className="text-sm text-red-600">{error}</p>
        <Link to="/templates/packs" className="mt-3 inline-block text-xs font-bold text-brand-700">
          All templates
        </Link>
      </div>
    );
  }
  if (!pack) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <Link to="/templates/packs" className="text-2xs font-bold text-ink-3 hover:text-ink-1">
        ← All templates
      </Link>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-ink-1">{pack.label}</h1>
        <p className="text-sm leading-relaxed text-ink-3">{pack.summary}</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-1">The offers it starts with</h2>
        <ul className="divide-y divide-edge-1 rounded-card border border-edge-1">
          {pack.offers.map((offer) => (
            <li key={offer.title} className="flex items-center justify-between gap-3 p-2.5">
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-ink-1">{offer.title}</span>
                <span className="text-micro text-ink-4">
                  {offer.kind} · {offer.price_unit || "units"}
                </span>
              </span>
              <span className="shrink-0 text-micro font-bold text-ink-4">Ask</span>
            </li>
          ))}
        </ul>
        <p className="text-micro text-ink-4">
          Every line starts at “Ask”. You set your own price — the template never guesses one.
        </p>
      </section>

      <section className="rounded-card border border-brand-200 bg-brand-50 p-3 dark:border-brand-500/30 dark:bg-brand-500/10">
        <p className="text-xs font-bold text-brand-900 dark:text-brand-100">Suggested partner terms</p>
        <p className="mt-1 text-micro leading-relaxed text-brand-900/80 dark:text-brand-100/80">
          Give the buyer {pack.suggested_terms.buyer_cutback_pct}% back and Brief{" "}
          {pack.suggested_terms.platform_fee_pct}%. {pack.suggested_terms.reason}
        </p>
      </section>

      {pack.blueprint_title && (
        <p className="text-xs text-ink-3">
          Comes with the free blueprint <span className="font-semibold text-ink-1">{pack.blueprint_title}</span>,
          whose next step appears in your Today window.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => {
            if (!token) {
              navigate("/auth", { state: { from: "/templates/packs" } });
              return;
            }
            templatePacksAPI
              .start(pack.key)
              .then(() => {
                toast.success("Draft created. Set your prices in the desk.");
                navigate("/desk");
              })
              .catch((err) => toast.error(apiError(err, "Couldn't start that template.")));
          }}
        >
          Start this template <Check size={14} aria-hidden="true" />
        </Button>
        <span className="text-micro text-ink-4">Creates a draft. Publishes nothing.</span>
      </div>
    </div>
  );
}
