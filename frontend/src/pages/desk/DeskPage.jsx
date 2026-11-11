import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import { toast } from "@/components/ui/Toast";
import OfferingForm from "@/components/desk/OfferingForm";
import { AssignedToMe, ManageWork } from "@/components/desk/WorkersPanel";
import { offeringsAPI, apiError } from "@/lib/api";

const KIND_LABEL = { goods: "Goods", service: "Services", tool: "Tools and rentals" };
const KIND_ORDER = ["goods", "service", "tool"];
const STATUS_LABEL = { paused: "Paused", archived: "Archived" };

function priceText(item) {
  if (item.price_mode === "ask_me") return "Ask me for the price";
  if (item.price == null) return "Price on request";
  const amount = `KES ${Math.round(item.price).toLocaleString()}${item.price_unit ? ` ${item.price_unit.replace(/_/g, " ")}` : ""}`;
  return item.price_mode === "negotiable" ? `${amount} (negotiable)` : amount;
}

/**
 * MY DESK (flagged). What I offer, with the full lifecycle: add, edit, pause, resume, archive.
 * Every change goes to the backend, which checks that I own the offering. Pausing and
 * resuming switch the same flags the rest of the app already reads.
 */
export default function DeskPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null); // null | "new" | offering item
  const [busy, setBusy] = useState("");

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

  const act = async (item, action) => {
    setBusy(`${item.kind}-${item.id}`);
    try {
      await offeringsAPI.setStatus(item.kind, item.id, action);
      toast.success(action === "pause" ? "Paused" : action === "resume" ? "Back on your desk" : "Archived");
      await load();
    } catch (e) {
      toast.error(apiError(e, "Couldn't change that. Try again."));
    } finally {
      setBusy("");
    }
  };

  const archive = (item) => {
    if (window.confirm(`Archive “${item.title}”? It will be hidden. You can still see it with “Show archived”.`)) {
      act(item, "archive");
    }
  };

  if (error && !data) {
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-1">My desk</h1>
          <p className="text-sm text-ink-2">Everything you offer, in one place.</p>
        </div>
        {editing === null && <Button onClick={() => setEditing("new")}>Add an offering</Button>}
      </header>

      {editing !== null && (
        <Card className="p-4">
          <h2 className="mb-3 text-base font-bold text-ink-1">
            {editing === "new" ? "Add an offering" : `Edit “${editing.title}”`}
          </h2>
          <OfferingForm
            offering={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={async () => { setEditing(null); await load(); }}
          />
        </Card>
      )}

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

      <AssignedToMe />
      <ManageWork />

      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={showArchived}
          onChange={async (e) => {
            setShowArchived(e.target.checked);
            try {
              const { data: body } = await offeringsAPI.mine({ include_archived: e.target.checked });
              setData(body);
            } catch (err) { toast.error(apiError(err, "Couldn't load. Try again.")); }
          }} />
        Show archived
      </label>

      {total === 0 ? (
        <EmptyState
          title="Nothing offered yet"
          description="Add goods, a service or a tool and it will appear here."
          action={
            <div className="flex flex-col items-center gap-2">
              <Button onClick={() => setEditing("new")}>Add your first offering</Button>
              <Link to="/stock" className="text-sm font-semibold text-brand-600">Add to your stock</Link>
            </div>
          }
        />
      ) : (
        groups.filter((g) => g.items.length > 0).map((g) => (
          <section key={g.kind} aria-labelledby={`desk-${g.kind}`} className="space-y-2">
            <h2 id={`desk-${g.kind}`} className="text-sm font-bold uppercase tracking-wide text-ink-2">
              {g.label} ({g.items.length})
            </h2>
            <ul className="space-y-2">
              {g.items.map((item) => {
                const key = `${item.kind}-${item.id}`;
                const archived = item.status === "archived";
                return (
                  <li key={key}>
                    <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink-1">
                          {item.title}
                          {STATUS_LABEL[item.status] && (
                            <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-2xs font-semibold text-ink-2">
                              {STATUS_LABEL[item.status]}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-ink-2">
                          {item.category ? `${item.category.replace(/_/g, " ")} · ` : ""}
                          {priceText(item)}
                          {item.service_radius_km ? ` · within ${item.service_radius_km} km` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span className={`text-xs font-semibold ${item.available ? "text-tech-700" : "text-ink-2"}`}>
                          {item.available ? "Available" : "Not offered"}
                        </span>
                        {!archived && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>Edit</Button>
                            {item.status === "active" ? (
                              <Button size="sm" variant="ghost" disabled={busy === key} onClick={() => act(item, "pause")}>Pause</Button>
                            ) : (
                              <Button size="sm" variant="ghost" disabled={busy === key} onClick={() => act(item, "resume")}>Resume</Button>
                            )}
                            <Button size="sm" variant="ghost" disabled={busy === key} onClick={() => archive(item)}>Archive</Button>
                          </>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
