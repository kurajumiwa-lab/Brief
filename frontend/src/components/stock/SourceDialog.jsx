import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { useStockStore } from "@/stores/stockStore";
import { apiError } from "@/lib/api";
import { currency, num } from "@/lib/formatters";
import { numOrNull } from "@/lib/utils";

/** Request stock from another vendor. Creates a `pending` movement and reserves the quantity. */
export default function SourceDialog({ item, open, onClose, onDone }) {
  const source = useStockStore((s) => s.source);
  const min = item?.min_order_quantity || 1;
  const available = item?.quantity_available ?? 0;
  const [quantity, setQuantity] = useState(min);
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  // reset whenever a different item is opened
  useEffect(() => {
    setQuantity(item?.min_order_quantity || 1);
    setPrice("");
    setNotes("");
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const unit = price !== "" ? Number(price) : item?.unit_price ?? 0;
  const total = useMemo(() => Number(quantity || 0) * Number(unit || 0), [quantity, unit]);
  const qtyError =
    quantity !== "" && Number(quantity) < min ? `Minimum order is ${num(min)}` : Number(quantity) > available ? `Only ${num(available)} available` : null;

  const submit = async (e) => {
    e.preventDefault();
    if (qtyError || !item) return;
    setBusy(true);
    try {
      const res = await source(item.id, { quantity: Number(quantity), proposed_price: numOrNull(price), notes: notes.trim() || null });
      toast.success(`Request sent to @${item.vendor_handle} · ${currency(res.total_value ?? total)}`);
      onDone?.(res);
      onClose?.();
    } catch (err) {
      toast.error(apiError(err, "Couldn't create the sourcing request"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open && !!item} onClose={onClose} title={item ? `Source ${item.name}` : ""} description={item ? `from ${item.vendor_business} · @${item.vendor_handle}` : ""} size="sm">
      {item && (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Fact label="available" value={`${num(available)} ${item.unit_of_measure || ""}`} />
            <Fact label="unit price" value={item.unit_price != null ? currency(item.unit_price) : "ask"} />
            <Fact label="min order" value={num(min)} />
          </div>
          <Input label={`Quantity (${item.unit_of_measure || "units"})`} type="number" min={min} max={available} step="any" required value={quantity} onChange={(e) => setQuantity(e.target.value)} error={qtyError} autoFocus />
          <Input label="Proposed unit price" type="number" min="0" step="any" prefix="KES" value={price} onChange={(e) => setPrice(e.target.value)} hint="Leave blank to accept their unit price" />
          <Textarea label="Notes for the supplier" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pickup Saturday morning, cash on collection…" />
          <div className="flex items-center justify-between rounded-lg bg-surface-1 border border-edge-1 px-3 py-2">
            <span className="text-xs text-ink-4">Estimated total</span>
            <span className="font-mono text-sm text-ink-1">{currency(total)}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} icon={ArrowDownToLine} disabled={!!qtyError}>
              Send request
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Fact({ label, value }) {
  return (
    <div className="rounded-lg bg-surface-1 border border-edge-1 py-2 px-1">
      <div className="text-2xs text-ink-4">{label}</div>
      <div className="text-xs font-mono text-ink-1 truncate">{value}</div>
    </div>
  );
}
