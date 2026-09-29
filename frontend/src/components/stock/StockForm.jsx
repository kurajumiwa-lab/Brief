import { useEffect, useState } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { STOCK_UNITS } from "@/config/constants";
import { useStockStore } from "@/stores/stockStore";
import { apiError } from "@/lib/api";
import { numOrNull, splitList } from "@/lib/utils";

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

/** Create (no `item`) or edit (`item`) a stock line. Calls `onDone(item)` on success. */
export default function StockForm({ item, onDone, onCancel }) {
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
