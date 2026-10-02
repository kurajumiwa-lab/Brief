import { useEffect, useRef, useState } from "react";
import { Image, ClipboardList, Check } from "lucide-react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { STOCK_UNITS } from "@/config/constants";
import { useStockStore } from "@/stores/stockStore";
import { apiError, fileAPI } from "@/lib/api";
import { numOrNull, splitList } from "@/lib/utils";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// STOCK FORM — the honest ways stock gets on the shelf.
//
// Create mode offers three doors, simplest first:
//   * PHOTO + NOTE — a picture of the item, its name, the price, the count.
//     The photo is uploaded through /api/files/upload and rides on the row.
//   * TEMPLATE — the common items of a shop type, as NAMES ONLY. You price
//     the ones you actually stock; blank lines are skipped, never filled
//     with a number the app would have to invent.
//   * FULL FORM — every field the row allows (SKU, tiers, quality, tags).
// Edit mode shows the full form only — a row already exists to edit.
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATES = [
  { id: "general", label: "General store", items: ["500ml cooking oil", "1kg sugar", "500g red tea", "2kg maize flour", "500ml dish soap", "2kg washing soap", "1L milk", "1kg salt", "100g matches", "1 roll tissue"] },
  { id: "food", label: "Food & beverages", items: ["1L milk", "500g maize flour", "1kg rice", "1L cooking oil", "500g green lentils", "1kg sugar", "1L tomato sauce", "500g beans", "100g red tea", "500g githeri mix"] },
  { id: "household", label: "Household & cleaning", items: ["500ml dish soap", "2kg washing soap", "1L floor cleaner", "1 roll tissue", "100g matches", "1L disinfectant", "500ml surface cleaner", "1 pack sponges", "1 roll garbage bags", "1L air freshener"] },
];

const MODES = [
  { id: "photo", label: "Photo + note", icon: Image },
  { id: "template", label: "Template", icon: ClipboardList },
];

// ── Photo + note ─────────────────────────────────────────────────────────────
function PhotoNoteForm({ onDone }) {
  const { add } = useStockStore();
  const fileRef = useRef(null);
  const [photo, setPhoto] = useState(null); // { url, name } | null
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ name: "", price: "", quantity: "", unit: "units" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const { data } = await fileAPI.upload(file);
      setPhoto({ url: data.url, name: file.name });
    } catch (err) {
      setError(apiError(err, "The photo could not be uploaded"));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const price = Number(form.price);
    if (!form.name.trim()) return setError("Give the item a name");
    if (!Number.isFinite(price) || price <= 0) return setError("The price must be a number above zero");
    setSaving(true);
    setError("");
    try {
      const saved = await add({
        name: form.name.trim(),
        quantity_in_stock: Number(form.quantity || 0),
        unit_of_measure: form.unit,
        unit_price: price,
        images: photo ? [photo.url] : [],
      });
      toast.success(`${saved.name} is on the shelf`);
      onDone?.(saved);
    } catch (err) {
      setError(apiError(err, "Couldn't add the item"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-2xl border border-dashed border-brand-500/40 bg-surface-1 hover:bg-surface-2 transition-colors p-4 flex items-center gap-3 text-left"
        >
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
          {photo ? (
            <>
              <img src={photo.url} alt="" className="w-14 h-14 rounded-xl object-cover" />
              <span className="min-w-0">
                <span className="block text-sm text-ink-1 font-medium truncate">{photo.name}</span>
                <span className="block text-2xs text-ink-4 mt-0.5">Tap to replace</span>
              </span>
            </>
          ) : (
            <>
              <span className="w-14 h-14 rounded-xl bg-brand-500/10 text-brand-300 flex items-center justify-center shrink-0">
                <Image size={20} />
              </span>
              <span>
                <span className="block text-sm text-ink-1 font-medium">{uploading ? "Uploading…" : "Add a photo"}</span>
                <span className="block text-2xs text-ink-4 mt-0.5">The shelf shows it first</span>
              </span>
            </>
          )}
        </button>
      </div>

      <Input label="Item name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Sukuma wiki" />
      <div className="grid grid-cols-3 gap-3">
        <Input label="Price (KES)" type="number" min="0" step="any" required value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} placeholder="unit price" prefix="KES" />
        <Input label="Quantity" type="number" min="0" step="any" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} placeholder="0" />
        <Select label="Unit" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} options={STOCK_UNITS.map((u) => ({ value: u, label: u }))} />
      </div>

      {error && <p className="text-xs text-red-400 font-medium" role="alert">{error}</p>}
      <Button type="submit" loading={saving || uploading} fullWidth>
        Add to my stock
      </Button>
      <p className="text-2xs text-ink-4 text-center">Saved as a live line — the network can source it the moment it lands.</p>
    </form>
  );
}

// ── Template ─────────────────────────────────────────────────────────────────
function TemplateForm({ onDone }) {
  const { add } = useStockStore();
  const [tplId, setTplId] = useState(null);
  const [rows, setRows] = useState({}); // name → { qty, price }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tpl = TEMPLATES.find((t) => t.id === tplId) || null;

  const pricedCount = tpl
    ? tpl.items.filter((n) => {
        const r = rows[n] || {};
        const p = Number(r.price);
        return r.price !== undefined && r.price !== "" && Number.isFinite(p) && p > 0;
      }).length
    : 0;

  const submit = async () => {
    if (!tpl) return;
    const priced = tpl.items.filter((n) => Number(rows[n]?.price) > 0);
    if (priced.length === 0) return setError("Price at least one item — blank lines are skipped, never filled in");
    setBusy(true);
    setError("");
    let added = 0;
    const failures = [];
    for (const name of priced) {
      const r = rows[name];
      try {
        await add({
          name,
          quantity_in_stock: Number(r.qty || 0),
          unit_of_measure: "units",
          unit_price: Number(r.price),
        });
        added += 1;
      } catch (err) {
        failures.push(`${name}: ${apiError(err, "refused")}`);
      }
    }
    setBusy(false);
    if (added > 0) toast.success(`${added} item${added === 1 ? "" : "s"} added to your shelf`);
    if (failures.length > 0) setError(failures.join(" · "));
    if (added > 0) onDone?.();
  };

  if (!tpl) {
    return (
      <div className="space-y-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setTplId(t.id); setRows({}); setError(""); }}
            className="w-full text-left glass glass-hover rounded-2xl p-3.5 transition-colors"
          >
            <p className="text-sm font-semibold text-ink-1">{t.label}</p>
            <p className="text-2xs text-ink-4 mt-0.5">{t.items.length} common items · you price the ones you have</p>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-1">{tpl.label}</p>
        <button type="button" onClick={() => setTplId(null)} className="text-2xs font-semibold text-ink-4 underline hover:text-ink-2">
          Change
        </button>
      </div>
      <div className="rounded-2xl bg-surface-1 divide-y divide-white/[0.04] max-h-72 overflow-y-auto">
        {tpl.items.map((name) => (
          <div key={name} className="flex items-center gap-2 px-3 py-2">
            <p className="flex-1 text-xs text-ink-2 truncate">{name}</p>
            <input
              value={rows[name]?.qty ?? ""}
              onChange={(e) => setRows((r) => ({ ...r, [name]: { ...r[name], qty: e.target.value } }))}
              type="number" min="0" inputMode="numeric" placeholder="qty"
              className="w-14 px-2 py-1.5 rounded-lg bg-surface-0 text-xs text-right tabular-nums text-ink-1 placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
              aria-label={`${name} quantity`}
            />
            <input
              value={rows[name]?.price ?? ""}
              onChange={(e) => setRows((r) => ({ ...r, [name]: { ...r[name], price: e.target.value } }))}
              type="number" min="0" inputMode="decimal" placeholder="KES"
              className="w-20 px-2 py-1.5 rounded-lg bg-surface-0 text-xs text-right tabular-nums text-ink-1 placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
              aria-label={`${name} price`}
            />
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-400 font-medium" role="alert">{error}</p>}
      <Button onClick={submit} loading={busy} disabled={pricedCount === 0} icon={Check} fullWidth>
        Add {pricedCount} priced item{pricedCount === 1 ? "" : "s"}
      </Button>
      <p className="text-2xs text-ink-4 text-center">Names only — prices are yours to state. Blank lines are skipped.</p>
    </div>
  );
}

// ── Full form (the original row editor) ──────────────────────────────────────
const blank = {
  name: "",
  sku: "",
  category: "",
  quantity_in_stock: "",
  unit_of_measure: "units",
  cost_price: "",
  wholesale_price: "",
  unit_price: "",
  min_order_quantity: "1",
  visible_to_network: true,
  tags: "",
};

const fromItem = (item) =>
  item
    ? {
        name: item.name || "",
        sku: item.sku || "",
        category: item.category || "",
        quantity_in_stock: item.quantity_in_stock ?? "",
        unit_of_measure: item.unit_of_measure || "units",
        cost_price: item.cost_price ?? "",
        wholesale_price: item.wholesale_price ?? "",
        unit_price: item.unit_price ?? "",
        min_order_quantity: item.min_order_quantity ?? "1",
        visible_to_network: item.visible_to_network ?? true,
        tags: (item.tags || []).join(", "),
      }
    : blank;

function FullForm({ item, onDone, onCancel }) {
  const { add, update, categories } = useStockStore();
  const [form, setForm] = useState(() => fromItem(item));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  useEffect(() => setForm(fromItem(item)), [item]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = "Give it a name";
    if (form.quantity_in_stock !== "" && Number(form.quantity_in_stock) < 0) errs.quantity_in_stock = "Can't be negative";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      category: form.category.trim() || null,
      quantity_in_stock: Number(form.quantity_in_stock || 0),
      unit_of_measure: form.unit_of_measure,
      cost_price: numOrNull(form.cost_price),
      wholesale_price: numOrNull(form.wholesale_price),
      unit_price: numOrNull(form.unit_price),
      min_order_quantity: Number(form.min_order_quantity || 1),
      visible_to_network: !!form.visible_to_network,
      tags: splitList(form.tags),
    };
    setSaving(true);
    try {
      const saved = item ? await update(item.id, payload) : await add(payload);
      toast.success(item ? "Stock updated" : `${saved.name} is on the shelf`);
      onDone?.(saved);
    } catch (err) {
      toast.error(apiError(err, "Couldn't save stock"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="Item name" required value={form.name} onChange={set("name")} error={errors.name} placeholder="Sukuma wiki" wrapperClassName="sm:col-span-2" />
        <Input label="SKU" value={form.sku} onChange={set("sku")} placeholder="SUK-1" className="font-mono" />
        <Input label="Category" value={form.category} onChange={set("category")} placeholder="vegetables" list="stock-categories" />
        <datalist id="stock-categories">
          {categories.map((c) => (
            <option key={c.category || c} value={c.category || c} />
          ))}
        </datalist>
        <Input label="Quantity in stock" type="number" min="0" step="any" value={form.quantity_in_stock} onChange={set("quantity_in_stock")} error={errors.quantity_in_stock} />
        <Select label="Unit" value={form.unit_of_measure} onChange={set("unit_of_measure")} options={STOCK_UNITS.map((u) => ({ value: u, label: u }))} />
      </div>

      <div>
        <p className="text-xs font-medium text-ink-3 mb-1.5">Pricing (KES, optional)</p>
        <div className="grid grid-cols-3 gap-3">
          <Input type="number" min="0" step="any" value={form.cost_price} onChange={set("cost_price")} placeholder="cost" prefix="KES" />
          <Input type="number" min="0" step="any" value={form.wholesale_price} onChange={set("wholesale_price")} placeholder="wholesale" prefix="KES" />
          <Input type="number" min="0" step="any" value={form.unit_price} onChange={set("unit_price")} placeholder="unit price" prefix="KES" />
        </div>
        <p className="text-2xs text-ink-4 mt-1">Vendors sourcing from you pay the unit price unless you agree otherwise in a deal.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="Minimum order" type="number" min="1" step="1" value={form.min_order_quantity} onChange={set("min_order_quantity")} />
        <Input label="Tags" value={form.tags} onChange={set("tags")} placeholder="fresh, farm-gate, organic" hint="Comma separated" />
      </div>

      <label className="flex items-center gap-2.5 rounded-lg border border-edge-1 bg-surface-1 px-3 py-2.5 cursor-pointer">
        <input type="checkbox" checked={form.visible_to_network} onChange={set("visible_to_network")} className="accent-brand-500 w-4 h-4" />
        <span className="text-sm text-ink-2">Visible to the network</span>
        <span className="ml-auto text-2xs text-ink-4">Other vendors can source it</span>
      </label>

      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={saving}>
          {item ? "Save changes" : "Add to shelf"}
        </Button>
      </div>
    </form>
  );
}

/** Create (no `item`) or edit (`item`) a stock line. Calls `onDone(item)` on success. */
export default function StockForm({ item, onDone, onCancel }) {
  const [mode, setMode] = useState("photo");
  const isCreate = !item;

  return (
    <div className="space-y-4">
      {isCreate && (
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.05] w-fit" role="tablist">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={mode === id}
              onClick={() => setMode(id)}
              className={cn(
                "px-3.5 h-8 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-all",
                mode === id ? "bg-brand-500/20 text-brand-200" : "text-ink-4 hover:text-ink-2"
              )}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
          <button
            role="tab"
            aria-selected={mode === "full"}
            onClick={() => setMode("full")}
            className={cn(
              "px-3.5 h-8 rounded-lg text-xs font-medium transition-all",
              mode === "full" ? "bg-brand-500/20 text-brand-200" : "text-ink-4 hover:text-ink-2"
            )}
          >
            Full form
          </button>
        </div>
      )}
      {isCreate && mode === "photo" && <PhotoNoteForm onDone={onDone} />}
      {isCreate && mode === "template" && <TemplateForm onDone={onDone} />}
      {(item || mode === "full") && <FullForm item={item} onDone={onDone} onCancel={isCreate ? undefined : onCancel} />}
    </div>
  );
}
