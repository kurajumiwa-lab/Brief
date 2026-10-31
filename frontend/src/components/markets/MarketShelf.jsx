import { useCallback, useEffect, useState } from "react";
import Media from "@/components/ui/Media";
import { Link } from "react-router-dom";
import { Package, Truck, Users, Wrench } from "lucide-react";
import { marketsAPI } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * THE MARKET'S SHELF — the join, made visible.
 *
 * Everything here belongs to a vendor. Nothing was uploaded to the market: a
 * trader publishes once on their own shelf and their product appears here
 * because they trade in this market. Three consequences, all of them visible in
 * this component:
 *
 *  · **The vendor is on every row.** "by Achieng Groceries" is not decoration;
 *    it is the reason the row exists, and it is the link a buyer follows.
 *  · **An empty shelf says what to do**, not just "nothing here". The sentence
 *    comes from the server's invitation, so it matches the market card.
 *  · **The four kinds are one control.** Goods, people, services, equipment —
 *    the same join, told four ways.
 */

const KINDS = [
  {
    key: "goods",
    label: "Goods",
    icon: Package,
    blurb: "Products vendors sell",
  },
  { key: "people", label: "People", icon: Users, blurb: "Find local vendors" },
  {
    key: "services",
    label: "Services",
    icon: Truck,
    blurb: "Find service providers",
  },
  {
    key: "equipment",
    label: "Equipment",
    icon: Wrench,
    blurb: "Find tools and equipment",
  },
];

function money(value, unit) {
  if (value == null) return null;
  const n = Number(value);
  const text = Number.isFinite(n)
    ? `KSh ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`
    : null;
  return text ? (unit ? `${text} / ${unit}` : text) : null;
}

export default function MarketShelf({
  marketId,
  kind: kindProp = "goods",
  invitation,
  className = "",
}) {
  const [kind, setKind] = useState(kindProp);
  const [state, setState] = useState({
    loading: true,
    items: [],
    own: 0,
    error: null,
  });

  useEffect(() => {
    setKind(kindProp);
  }, [kindProp]);

  const load = useCallback(
    async (k) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const res = await marketsAPI.shelf(marketId, { kind: k, limit: 24 });
        setState({
          loading: false,
          items: res.data?.items || [],
          own: res.data?.own || 0,
          error: null,
        });
      } catch (err) {
        setState({ loading: false, items: [], own: 0, error: err });
      }
    },
    [marketId],
  );

  useEffect(() => {
    load(kind);
  }, [load, kind]);

  return (
    <section
      aria-labelledby="market-shelf"
      data-testid="market-shelf"
      className={className}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2
          id="market-shelf"
          className="text-xs font-bold tracking-tight text-ink-1"
        >
          Market shelf
        </h2>
        <span className="rounded-full bg-brand-500/12 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
          Live
        </span>
      </div>

      <div
        role="tablist"
        aria-label="What is on this market's shelf"
        className="mb-2 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar"
      >
        {KINDS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={kind === key}
            onClick={() => setKind(key)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-micro font-semibold transition-colors",
              kind === key
                ? "border-brand-500/50 bg-brand-500/12 text-brand-700 dark:text-brand-300"
                : "border-edge-1 text-ink-3 hover:bg-surface-2 hover:text-ink-1",
            )}
          >
            <Icon size={11} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {state.loading && (
        <div className="grid grid-cols-2 gap-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[68px] animate-pulse rounded-xl bg-surface-2"
            />
          ))}
        </div>
      )}

      {!state.loading && state.error && (
        <p className="rounded-xl border border-dashed border-edge-1 px-3 py-3 text-micro text-ink-4">
          The shelf didn't load.{" "}
          <button
            type="button"
            onClick={() => load(kind)}
            className="font-semibold text-brand-700 underline underline-offset-2 dark:text-brand-400"
          >
            Try again
          </button>
        </p>
      )}

      {!state.loading && !state.error && state.items.length === 0 && (
        <div className="rounded-xl border border-dashed border-edge-1 px-3 py-4 text-center">
          <p className="text-2xs leading-relaxed text-ink-3">
            {state.own > 0
              ? `Your ${state.own === 1 ? "item is" : `${state.own} items are`} on this market's shelf. You are not shown your own stock, so nobody else's has landed yet.`
              : invitation ||
                "Nothing of this kind on this market's shelf yet."}
          </p>
          <Link
            to="/stock"
            className="mt-1.5 inline-block text-micro font-bold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
          >
            Put something on your shelf
          </Link>
        </div>
      )}

      {!state.loading && !state.error && state.items.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {state.items.map((item) => (
            <li key={item.id}>
              <Link
                to={item.to}
                data-testid="market-shelf-item"
                className="flex h-full gap-2 rounded-xl border border-edge-1 bg-surface-1 p-2 transition-colors hover:border-brand-400/60 hover:bg-brand-500/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
              >
                {item.image ? (
                  <Media
                    src={item.image}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-4"
                  >
                    {item.kind === "vendor" ? (
                      <Users size={15} />
                    ) : (
                      <Package size={15} />
                    )}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-2xs font-semibold text-ink-1">
                    {item.title}
                  </span>
                  {item.by && (
                    <span className="mt-0.5 block truncate text-micro text-ink-3">
                      by {item.by}
                    </span>
                  )}
                  {item.note && (
                    <span className="mt-0.5 block truncate text-micro text-ink-4">
                      {item.note}
                    </span>
                  )}
                  {item.category && !item.by && (
                    <span className="mt-0.5 block truncate text-micro text-ink-4">
                      {item.category}
                    </span>
                  )}
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-micro">
                    {money(item.price, item.price_unit) && (
                      <span className="font-bold text-ink-1">
                        {money(item.price, item.price_unit)}
                      </span>
                    )}
                    {item.quantity != null && (
                      <span className="text-ink-4">
                        {item.quantity} available
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!state.loading &&
        !state.error &&
        state.items.length > 0 &&
        state.own > 0 && (
          <p className="mt-2 text-micro text-ink-4">
            Your {state.own === 1 ? "item is" : `${state.own} items are`} on
            this shelf too — hidden from the list above so you are not sold your
            own stock.
          </p>
        )}
    </section>
  );
}
