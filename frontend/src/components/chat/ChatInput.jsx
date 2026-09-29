import { useEffect, useRef, useState } from "react";
import { Send, Package, HeartHandshake, MessageSquare } from "lucide-react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { useStockStore } from "@/stores/stockStore";
import { apiError } from "@/lib/api";
import { currency } from "@/lib/formatters";
import { cn, numOrNull } from "@/lib/utils";

const MODES = [
  { value: "text", label: "Message", icon: MessageSquare },
  { value: "stock_share", label: "Share stock", icon: Package },
  { value: "deal_proposal", label: "Propose deal", icon: HeartHandshake },
];

/** Composer. `onSend(payload)` receives a full MessageCreate body. */
export default function ChatInput({ onSend, disabled, sending, placeholder = "Message the room…" }) {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [stockId, setStockId] = useState("");
  const [deal, setDeal] = useState({ item: "", quantity: "", unit_price: "", delivery: "", payment: "" });
  const mine = useStockStore((s) => s.mine);
  const fetchMine = useStockStore((s) => s.fetchMine);
  const ref = useRef(null);

  useEffect(() => {
    if (mode === "stock_share" && mine.length === 0) fetchMine().catch(() => {});
  }, [mode, mine.length, fetchMine]);

  // auto-grow
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [text]);

  const dealTotal = Number(deal.quantity || 0) * Number(deal.unit_price || 0);

  const submit = async () => {
    if (disabled || sending) return;
    let payload;
    if (mode === "stock_share") {
      if (!stockId) return toast.error("Pick an item to share");
      const item = mine.find((i) => i.id === stockId);
      payload = { message_type: "stock_share", shared_stock_id: stockId, content: text.trim() || `Sharing ${item?.name || "stock"} from my shelf` };
    } else if (mode === "deal_proposal") {
      if (!deal.item.trim() || !deal.quantity) return toast.error("A deal needs an item and a quantity");
      const deal_data = {
        item: deal.item.trim(),
        quantity: Number(deal.quantity),
        unit_price: numOrNull(deal.unit_price),
        total: deal.unit_price ? dealTotal : null,
        delivery: deal.delivery.trim() || null,
        payment: deal.payment.trim() || null,
        notes: text.trim() || null,
        status: "proposed",
      };
      payload = { message_type: "deal_proposal", deal_data, content: text.trim() || `Deal: ${deal.quantity} × ${deal.item}${deal.unit_price ? ` @ ${currency(deal.unit_price)}` : ""}` };
    } else {
      if (!text.trim()) return;
      payload = { message_type: "text", content: text.trim() };
    }
    try {
      await onSend(payload);
      setText("");
      setStockId("");
      setDeal({ item: "", quantity: "", unit_price: "", delivery: "", payment: "" });
      if (mode !== "text") setMode("text");
    } catch (err) {
      toast.error(apiError(err, "Message not sent"));
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey && mode === "text") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-edge-1 bg-surface-1 p-3 space-y-2">
      <div className="flex items-center gap-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => setMode(m.value)}
            className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors", mode === m.value ? "bg-brand-950 text-brand-200" : "text-ink-4 hover:text-ink-2 hover:bg-surface-3")}
          >
            <m.icon size={11} /> {m.label}
          </button>
        ))}
      </div>

      {mode === "stock_share" && (
        <Select value={stockId} onChange={(e) => setStockId(e.target.value)} placeholder={mine.length ? "Choose from your shelf…" : "Your shelf is empty"} options={mine.map((i) => ({ value: i.id, label: `${i.name} · ${i.quantity_available} ${i.unit_of_measure || ""}${i.unit_price != null ? ` · ${currency(i.unit_price)}` : ""}` }))} />
      )}

      {mode === "deal_proposal" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Input placeholder="Item" value={deal.item} onChange={(e) => setDeal({ ...deal, item: e.target.value })} wrapperClassName="col-span-2 sm:col-span-1" />
          <Input type="number" min="0" step="any" placeholder="Quantity" value={deal.quantity} onChange={(e) => setDeal({ ...deal, quantity: e.target.value })} />
          <Input type="number" min="0" step="any" placeholder="Unit price" prefix="KES" value={deal.unit_price} onChange={(e) => setDeal({ ...deal, unit_price: e.target.value })} />
          <div className="h-9 flex items-center justify-end px-2 rounded-lg bg-surface-2 border border-edge-1 text-xs font-mono text-amber-200">{dealTotal ? currency(dealTotal) : "total"}</div>
          <Input placeholder="Delivery (e.g. pickup Sat)" value={deal.delivery} onChange={(e) => setDeal({ ...deal, delivery: e.target.value })} wrapperClassName="col-span-2" />
          <Input placeholder="Payment (e.g. M-Pesa on receipt)" value={deal.payment} onChange={(e) => setDeal({ ...deal, payment: e.target.value })} wrapperClassName="col-span-2" />
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={mode === "text" ? placeholder : "Add a note (optional)"}
          aria-label="Message"
          className="flex-1 resize-none rounded-xl border border-edge-2 bg-surface-2 px-3.5 py-2 text-sm text-ink-1 placeholder:text-ink-4 focus:outline-none focus:border-brand-500 disabled:opacity-50"
        />
        <Button onClick={submit} loading={sending} disabled={disabled} icon={Send} aria-label="Send" className="h-10 w-10 !px-0 rounded-xl" />
      </div>
    </div>
  );
}
