import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { offersPublicAPI, apiError } from "@/lib/api";

/**
 * OPEN OFFERS — everything businesses share with the network, readable by anyone.
 * No account is needed to look. Each item says how far it has been tested on
 * the network: confirmed (traded with another business) or new.
 */

const TRUST_BADGE = { confirmed: "brand", new: "gray" };

export default function OffersBrowsePage() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let live = true;
    setItems(null);
    offersPublicAPI.browse({ q: term || undefined, limit: 48 })
      .then(({ data }) => { if (live) { setItems(data.offers); setError(null); } })
      .catch((err) => { if (live) setError(apiError(err, "Could not load offers")); });
    return () => { live = false; };
  }, [term]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 pb-16">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-ink-1">Open offers</h1>
        <p className="text-sm text-ink-3">
          Goods and services that businesses on Brief share. Look freely. Each one shows how far it has been tested on the network.
        </p>
        <p className="text-xs text-ink-3">
          <Link to="/auth" className="font-medium text-brand-700 underline">Sign in</Link> to buy or source from a business.
        </p>
      </header>

      <Input placeholder="Search offers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search offers" />

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!items && !error && <PageSpinner />}
      {items && items.length === 0 && <p className="text-sm text-ink-4">Nothing matches yet.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(items || []).map((o) => (
          <Card key={o.id} padding="p-4" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={TRUST_BADGE[o.trust.level] || "gray"}>{o.trust.label}</Badge>
              {o.seller.verified && <Badge variant="blue">Verified business</Badge>}
            </div>
            <p className="text-sm font-semibold text-ink-1">{o.name}</p>
            <p className="text-xs text-ink-3">
              {o.seller.name} · {o.quantity_available} {o.unit} available
              {o.min_order_quantity > 1 ? ` · min ${o.min_order_quantity}` : ""}
            </p>
            <p className="text-sm tabular-nums text-ink-1">
              {o.unit_price != null ? `KSh ${Number(o.unit_price).toLocaleString("en-KE")} per ${o.unit}` : "Price on request"}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
