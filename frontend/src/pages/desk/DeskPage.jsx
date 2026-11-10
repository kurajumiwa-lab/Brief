import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import { offeringsAPI, apiError } from "@/lib/api";

const KIND_LABEL = { goods: "Goods", service: "Services", tool: "Tools and rentals" };
const KIND_ORDER = ["goods", "service", "tool"];

/**
 * MY DESK (flagged, see config/flags.js). What I offer, in one list, with links to
 * the parts that already exist: the morning brief and the home office. Read-only here;
 * each item is changed where it already lives.
 */
export default function DeskPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data: body } = await offeringsAPI.mine();
      setData(body);
    } catch (e) {
      setError(apiError(e, "Could not load what you offer. Try again."));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-xl font-extrabold text-ink-1">My desk</h1>
        <Card className="p-4 text-sm text-ink-2" role="alert">{error}</Card>
        <Button onClick={load}>Try again</Button>
      </div>
    );
  }
  if (!data) return <PageSpinner />;

  const groups = KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABEL[kind],
    items: data.items.filter((i) => i.kind === kind),
  }));
  const total = data.items.length;

  return (
    <div className="space-y-5 p-4">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight text-ink-1">My desk</h1>
        <p className="text-sm text-ink-2">Everything you offer, in one place.</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/brief" className="block rounded-xl p-4 hover:bg-surface-2">
          <p className="font-semibold text-ink-1">Today</p>
          <p className="text-sm text-ink-2">What needs you: low stock, money to follow up, open requests.</p>
        </Link>
        <Link to="/office" className="block rounded-xl p-4 hover:bg-surface-2">
          <p className="font-semibold text-ink-1">My office</p>
          <p className="text-sm text-ink-2">Your team, your events and your calendar.</p>
        </Link>
      </div>

      {total === 0 ? (
        <EmptyState
          title="Nothing offered yet"
          description="Add goods, a service or a tool and it will appear here."
          action={<Link to="/stock" className="text-sm font-semibold text-brand-600">Add to your stock</Link>}
        />
      ) : (
        groups.filter((g) => g.items.length > 0).map((g) => (
          <section key={g.kind} aria-labelledby={`desk-${g.kind}`} className="space-y-2">
            <h2 id={`desk-${g.kind}`} className="text-sm font-bold uppercase tracking-wide text-ink-2">
              {g.label} ({g.items.length})
            </h2>
            <ul className="space-y-2">
              {g.items.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <Card className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink-1">{item.title}</p>
                      <p className="text-xs text-ink-2">
                        {item.category ? `${item.category.replace(/_/g, " ")} · ` : ""}
                        {item.price != null ? `KES ${Math.round(item.price).toLocaleString()}${item.price_unit ? ` ${item.price_unit.replace(/_/g, " ")}` : ""}` : "Price on request"}
                      </p>
                    </div>
                    <span className={`shrink-0 text-xs font-semibold ${item.available ? "text-tech-700" : "text-ink-2"}`}>
                      {item.available ? "Available" : "Not offered"}
                    </span>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
