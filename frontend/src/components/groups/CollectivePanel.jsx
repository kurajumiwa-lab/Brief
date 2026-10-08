import { useCallback, useEffect, useState } from "react";
import { ShoppingBasket, Plus, Coins, Undo2, ChevronRight } from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { collectiveAPI, apiError } from "@/lib/api";
import { COLLECTIVE_STATUSES, STOCK_UNITS } from "@/config/constants";
import { currency, num, shortDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const statusMeta = (s) => COLLECTIVE_STATUSES.find((c) => c.value === s) || { label: s, variant: "gray" };
const NEXT = { gathering: ["cancelled"], quota_met: ["negotiating", "ordered", "cancelled"], negotiating: ["ordered", "cancelled"], ordered: ["fulfilled", "cancelled"] };

/**
 * Collective sourcing inside a group (v2.1 §5.3): pool quantities so the
 * organiser can buy at bulk price. Members pledge; the request flips to
 * quota_met on its own; the organiser or a group admin moves it along.
 */
export default function CollectivePanel({ group, canOpen }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    if (!group?.id) return Promise.resolve();
    setLoading(true);
    return collectiveAPI
      .list({ group_id: group.id })
      .then(({ data }) => setRequests(data))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, [group?.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!group) return null;
  const active = requests.filter((r) => !["fulfilled", "cancelled"].includes(r.status));
  const closed = requests.filter((r) => ["fulfilled", "cancelled"].includes(r.status));

  return (
    <section data-testid="collective-panel">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-ink-2 inline-flex items-center gap-1.5">
          <ShoppingBasket size={13} className="text-brand-600 dark:text-brand-400" /> Collective buys{" "}
          {requests.length > 0 && <span className="font-mono text-ink-4">{active.length}</span>}
        </h4>
        {canOpen && (
          <Button size="xs" variant="secondary" icon={Plus} onClick={() => setCreating((v) => !v)}>
            Open a request
          </Button>
        )}
      </div>

      {creating && (
        <CreateForm
          groupId={group.id}
          onDone={() => {
            setCreating(false);
            load();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {loading && requests.length === 0 ? (
        <p className="text-2xs text-ink-4">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="text-2xs text-ink-4">{canOpen ? "Nobody is pooling an order here yet. Open one and members pledge their share." : "Join the group to see and join collective buys."}</p>
      ) : (
        <ul className="space-y-2">
          {active.map((r) => (
            <RequestRow key={r.id} request={r} onChange={load} />
          ))}
          {closed.length > 0 && <li className="text-2xs text-ink-4 pt-1">{closed.length} closed</li>}
          {closed.slice(0, 3).map((r) => (
            <RequestRow key={r.id} request={r} onChange={load} compact />
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestRow({ request: r, onChange, compact }) {
  const [pledging, setPledging] = useState(false);
  const [qty, setQty] = useState(r.my_pledge?.pledged_quantity ?? "");
  const [maxPrice, setMaxPrice] = useState(r.my_pledge?.max_price_per_unit ?? "");
  const [busy, setBusy] = useState("");
  const meta = statusMeta(r.status);
  const open = r.status === "gathering" || r.status === "quota_met";

  const act = async (kind, fn, ok) => {
    setBusy(kind);
    try {
      const res = await fn();
      if (ok) toast.success(typeof ok === "function" ? ok(res) : ok);
      setPledging(false);
      await onChange?.();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <li className={cn("rounded-lg border border-edge-1 bg-surface-1 p-3", compact && "opacity-70")} data-testid="collective-request">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink-1 truncate">{r.item_name}</p>
          <p className="text-2xs text-ink-4">
            {num(r.target_quantity)} {r.unit_of_measure}
            {r.target_price_per_unit != null && <> at ≤ {currency(r.target_price_per_unit)}</>} · by <span className="font-mono">@{r.organizer_handle}</span>
            {r.deadline && <> · closes {shortDate(r.deadline)}</>}
          </p>
        </div>
        <Badge variant={meta.variant} size="xs">
          {meta.label}
        </Badge>
      </div>

      <div className="mt-2">
        <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
          <div className={cn("h-full rounded-full transition-all", r.progress_pct >= 100 ? "bg-brand-500" : "bg-accent-500")} style={{ width: `${Math.min(100, r.progress_pct || 0)}%` }} />
        </div>
        <div className="flex justify-between text-2xs text-ink-4 mt-1 font-mono">
          <span>
            {num(r.current_pledged_quantity)} / {num(r.target_quantity)} pledged
          </span>
          <span>
            {r.pledge_count} vendor{r.pledge_count === 1 ? "" : "s"}
            {r.my_pledge && <span className="text-brand-600 dark:text-brand-400"> · you {num(r.my_pledge.pledged_quantity)}</span>}
          </span>
        </div>
      </div>

      {!compact && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {open && !pledging && (
            <Button size="xs" icon={Coins} onClick={() => setPledging(true)}>
              {r.my_pledge ? "Change pledge" : "Pledge"}
            </Button>
          )}
          {open && r.my_pledge && (
            <Button size="xs" variant="ghost" icon={Undo2} loading={busy === "withdraw"} onClick={() => act("withdraw", () => collectiveAPI.withdraw(r.id), "Pledge withdrawn")}>
              Withdraw
            </Button>
          )}
          {r.can_manage &&
            (NEXT[r.status] || []).map((next) => (
              <Button key={next} size="xs" variant={next === "cancelled" ? "dangerGhost" : "secondary"} icon={next === "cancelled" ? undefined : ChevronRight} loading={busy === next} onClick={() => act(next, () => collectiveAPI.setStatus(r.id, next), `Now ${statusMeta(next).label.toLowerCase()}`)}>
                {next === "cancelled" ? "Cancel" : statusMeta(next).label}
              </Button>
            ))}
        </div>
      )}

      {pledging && (
        <form
          className="mt-2.5 grid grid-cols-[1fr_1fr_auto] gap-2 items-end"
          aria-label="Pledge"
          onSubmit={(e) => {
            e.preventDefault();
            if (!(Number(qty) > 0)) return toast.error("How many units will you take?");
            act("pledge", () => collectiveAPI.pledge(r.id, { pledged_quantity: Number(qty), max_price_per_unit: maxPrice === "" ? null : Number(maxPrice) }), (res) => (res?.data?.status === "quota_met" ? "Quota met — the organiser can order" : "Pledge recorded"));
          }}
        >
          <Input type="number" min="1" step="1" label={`Units (${r.unit_of_measure})`} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
          <Input type="number" min="0" step="any" label="Max price / unit" prefix="KES" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
          <div className="flex gap-1 pb-px">
            <Button size="sm" type="submit" loading={busy === "pledge"}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPledging(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

function CreateForm({ groupId, onDone, onCancel }) {
  const [form, setForm] = useState({ item_name: "", item_category: "", target_quantity: "", target_price_per_unit: "", unit_of_measure: "units", deadline: "", description: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (form.item_name.trim().length < 2 || !(Number(form.target_quantity) > 0)) return toast.error("Name the item and set a target quantity");
    setBusy(true);
    try {
      await collectiveAPI.create({
        group_id: groupId,
        item_name: form.item_name.trim(),
        item_category: form.item_category.trim() || null,
        target_quantity: Number(form.target_quantity),
        target_price_per_unit: form.target_price_per_unit === "" ? null : Number(form.target_price_per_unit),
        unit_of_measure: form.unit_of_measure,
        deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
        description: form.description.trim() || null,
      });
      toast.success("Request opened — members have been told");
      onDone?.();
    } catch (err) {
      toast.error(apiError(err, "Couldn't open the request"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="rounded-xl border border-edge-1 bg-surface-2 p-3 mb-3 space-y-2" aria-label="New collective request">
      <div className="grid grid-cols-2 gap-2">
        <Input label="Item" required value={form.item_name} onChange={set("item_name")} placeholder="Grade A tomatoes (crate)" wrapperClassName="col-span-2" autoFocus />
        <Input label="Target quantity" type="number" min="1" step="1" required value={form.target_quantity} onChange={set("target_quantity")} />
        <Select label="Unit" value={form.unit_of_measure} onChange={set("unit_of_measure")} options={STOCK_UNITS.map((u) => ({ value: u, label: u }))} />
        <Input label="Target price / unit" type="number" min="0" step="any" prefix="KES" value={form.target_price_per_unit} onChange={set("target_price_per_unit")} />
        <Input label="Pledges close" type="date" value={form.deadline} onChange={set("deadline")} />
        <Input label="Category" value={form.item_category} onChange={set("item_category")} placeholder="fresh produce" wrapperClassName="col-span-2" />
      </div>
      <Input label="Notes" value={form.description} onChange={set("description")} placeholder="Farm-gate price holds at 30 crates. We split the lorry." />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" loading={busy}>
          Open request
        </Button>
      </div>
    </form>
  );
}
