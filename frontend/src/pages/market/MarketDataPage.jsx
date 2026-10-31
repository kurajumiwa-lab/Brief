import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, BarChart3, Loader2, Lock, Search, Store } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import { marketDataAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

/**
 * MARKET DATA — what the network is paying, gathered from public advertising.
 * ---------------------------------------------------------------------------
 * This screen is the product being sold to signed-in vendors. The rows behind it
 * came from shop signs, price boards and public posts; the seller may have no
 * account here, and the schema says so (`seller_hidden`).
 *
 * The ladder is deliberately blunt, and it is the whole commercial argument:
 *
 *   member   product, price, size, category, market.  Names withheld.
 *   partner  the same rows plus who is selling them and how to reach them.
 *
 * Nothing on this screen is a promise about a seller's stock — a photograph is
 * evidence of a price on a day, not a quotation. The footer says that in words
 * because an operator will paste these numbers into an order.
 */
export default function MarketDataPage() {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [market, setMarket] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // The API's shapes, not a guess at them: `summary` carries an `access`
      // block (tier, what it shows, what it hides, and the upgrade), and the
      // rows come back as `items` because `count` describes the page.
      const [s, o] = await Promise.all([
        marketDataAPI.summary(),
        marketDataAPI.observations({ limit: 60 }),
      ]);
      setSummary(s.data || null);
      setRows(o.data?.items || []);
    } catch (err) {
      setError(apiError(err, "Market data could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (category && row.category !== category) return false;
      if (market && !(row.market || "").toLowerCase().includes(market.toLowerCase())) return false;
      if (q && !`${row.product} ${row.market || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, category, market, query]);

  const access = summary?.access || null;
  const upgrade = access?.upgrade && access.tier !== "partner" ? access.upgrade : null;
  const categories = (summary?.categories || []).map((c) =>
    typeof c === "string" ? { category: c } : c
  );

  return (
    <div className="space-y-5 pb-24" data-testid="market-data">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-1">Market data</h1>
        <p className="text-xs text-ink-3">
          Prices collected from public shop signs, boards and posts — what the market is actually
          charging this week.
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Prices on file" value={summary.observations} icon={BarChart3} />
          <Metric label="Sellers seen" value={summary.sellers} icon={Store} />
          <Metric label="Categories" value={categories.length} icon={BarChart3} />
          <Metric
            label="Your access"
            value={access?.tier === "partner" ? "Partner" : "Member"}
            icon={access?.tier === "partner" ? Store : Lock}
          />
        </div>
      )}

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rice, diapers, cooking oil…"
            icon={Search}
          />
          <Input
            label="Market"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            placeholder="Kisumu, Kikomba…"
          />
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2" htmlFor="md-category">
              Category
            </label>
            <select
              id="md-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-edge-1 bg-surface-1 px-3 py-2 text-sm text-ink-1"
            >
              <option value="">Every category</option>
              {categories.map(({ category: name, price_min_kes, price_max_kes }) => (
                <option key={name} value={name}>
                  {name}
                  {price_min_kes && price_max_kes
                    ? ` — KSh ${Number(price_min_kes).toLocaleString()}–${Number(price_max_kes).toLocaleString()}`
                    : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {error && (
        <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center gap-2 px-5 py-10 text-sm text-ink-3">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Reading the market…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No prices match"
            description="Try a wider category, or clear the market. The dataset grows every time an operator reads a batch."
          />
        ) : (
          <ul className="divide-y divide-edge-1">
            {filtered.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-[10rem] flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-ink-1">{row.product}</span>
                    {row.category && (
                      <Badge variant="gray" size="xs">
                        {row.category}
                      </Badge>
                    )}
                    {row.created_at && (
                      <span className="text-[10px] text-ink-4">
                        seen {new Date(row.created_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-micro text-ink-3">
                    KSh {Number(row.price_kes || 0).toLocaleString()}
                    {row.quantity && row.unit ? ` · ${row.quantity} ${row.unit}` : ""}
                    {row.market ? ` · ${row.market}` : ""}
                  </p>
                  {row.seller ? (
                    <p className="mt-0.5 text-micro font-semibold text-brand-700 dark:text-brand-300">
                      {row.seller.virtual_id ? `${row.seller.virtual_id} · ` : ""}
                      {row.seller.label}
                      {row.seller.phone ? ` · ${row.seller.phone}` : ""}
                    </p>
                  ) : (
                    row.seller_hidden && (
                      <p className="mt-0.5 inline-flex items-center gap-1 text-micro text-ink-4">
                        <Lock size={10} aria-hidden="true" /> Seller withheld on your plan
                      </p>
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {upgrade && !upgrade.active && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-brand-200 bg-brand-50/60 p-4 dark:border-brand-500/20 dark:bg-brand-500/5">
          <div className="min-w-[12rem] flex-1">
            <p className="text-sm font-bold text-ink-1">{upgrade.label || "Unlock the sellers"}</p>
            <p className="text-micro text-ink-3">
              {upgrade.note ||
                "Partner plans show who is selling at the price — the shop, the phone number and the virtual ID. Prices stay free to read."}
            </p>
          </div>
          {/* A real link, not a button that navigates: this may be opened in a
              new tab, and the browser should be able to say where it goes. */}
          <Link
            to={upgrade.to || "/storefront?desk=business_software"}
            onClick={() => toast.info("Nothing is charged here — a human quotes you first")}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-edge-2 bg-surface-0 px-4 text-sm font-semibold text-ink-1 shadow-xs transition-colors hover:bg-surface-2 hover:border-edge-3"
          >
            Request the contacts
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </Card>
      )}

      <p className="px-1 text-micro leading-relaxed text-ink-4">
        Every row is a price seen in public advertising on the date shown — a photograph of a board,
        not a quotation. Confirm with the seller before ordering on it.
      </p>
    </div>
  );
}

function Metric({ label, value, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-edge-1 bg-surface-1 px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-ink-3">
        {Icon && <Icon size={12} aria-hidden="true" />}
        <span className="text-micro">{label}</span>
      </div>
      <p className={cn("mt-0.5 text-xl font-extrabold tabular-nums text-ink-1")}>{value ?? "—"}</p>
    </div>
  );
}
