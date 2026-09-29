import { useEffect, useRef, useState } from "react";
import { Send, Package, HeartHandshake, MessageSquare } from "lucide-react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Input from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { useStockStore } from "@/stores/stockStore";
import { useChatStore } from "@/stores/chatStore";
import { useAuthStore } from "@/stores/authStore";
import { DELIVERY_TERMS, PAYMENT_TERMS } from "@/config/constants";
import { stockAPI, apiError } from "@/lib/api";
import { currency } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const MODES = [
  { value: "text", label: "Message", icon: MessageSquare },
  { value: "stock_share", label: "Share stock", icon: Package },
  { value: "deal_proposal", label: "Propose deal", icon: HeartHandshake },
];

const blankDeal = { stock_item_id: "", quantity: "", price: "", delivery_terms: "pickup", payment_terms: "on_delivery" };

/** Composer. `onSend(payload)` receives a full MessageCreate body. */
export default function ChatInput({ onSend, disabled, sending, placeholder = "Message the room…" }) {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [stockId, setStockId] = useState("");
  const [deal, setDeal] = useState(blankDeal);
  const [dealStock, setDealStock] = useState([]); // items a proposal can be about (the room's item, or the other side's shelf)
  const mine = useStockStore((s) => s.mine);
  const fetchMine = useStockStore((s) => s.fetchMine);
  const room = useChatStore((s) => s.activeRoom);
  const me = useAuthStore((s) => s.vendor);
  const ref = useRef(null);

  useEffect(() => {
    if (mode === "stock_share" && mine.length === 0) fetchMine().catch(() => {});
  }, [mode, mine.length, fetchMine]);

  // Deal mode: proposals are structured (v2.1) — pick real stock so the API can price and reserve it.
  useEffect(() => {
    if (mode !== "deal_proposal" || !room) return;
    let alive = true;
    const others = (room.participants || []).filter((p) => p.id !== me?.id);
    const load = async () => {
      let items = [];
      if (room.deal_stock_item_id) {
        const { data } = await stockAPI.get(room.deal_stock_item_id);
        items = [data];
      } else if (others.length) {
        const results = await Promise.all(others.map((o) => stockAPI.network({ vendor_handle: o.vendor_handle }).then((r) => r.data).catch(() => [])));
        items = results.flat();
      } else {
        const { data } = await stockAPI.network({});
        items = data;
      }
      if (!alive) return;
      setDealStock(items);
      setDeal((d) => (d.stock_item_id || items.length !== 1 ? d : { ...d, stock_item_id: items[0].id, price: items[0].wholesale_price ?? items[0].unit_price ?? "" }));
    };
    load().catch(() => alive && setDealStock([]));
    return () => {
      alive = false;
    };
  }, [mode, room, me?.id]);

  // auto-grow
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [text]);

  const dealTotal = Number(deal.quantity || 0) * Number(deal.price || 0);
  const dealItem = dealStock.find((i) => i.id === deal.stock_item_id);

  const submit = async () => {
    if (disabled || sending) return;
    let payload;
    if (mode === "stock_share") {
      if (!stockId) return toast.error("Pick an item to share");
      const item = mine.find((i) => i.id === stockId);
      payload = { message_type: "stock_share", shared_stock_id: stockId, content: text.trim() || `Sharing ${item?.name || "stock"} from my shelf` };
    } else if (mode === "deal_proposal") {
      if (!deal.stock_item_id) return toast.error("Pick the stock the deal is about");
      if (!(Number(deal.quantity) > 0)) return toast.error("How many units?");
      if (deal.price === "" || Number(deal.price) < 0) return toast.error("Propose a price per unit");
      const deal_data = {
        stock_item_id: deal.stock_item_id,
        quantity: Number(deal.quantity),
        proposed_price_per_unit: Number(deal.price),
        delivery_terms: deal.delivery_terms,
        payment_terms: deal.payment_terms,
        notes: text.trim() || null,
      };
      payload = { message_type: "deal_proposal", deal_data, content: text.trim() || `Proposal: ${deal.quantity} × ${dealItem?.name || "stock"} at ${currency(deal.price)} per ${dealItem?.unit_of_measure || "unit"}` };
    } else {
      if (!text.trim()) return;
      payload = { message_type: "text", content: text.trim() };
    }
    try {
      await onSend(payload);
      setText("");
      setStockId("");
      setDeal(blankDeal);
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
          <Select
            value={deal.stock_item_id}
            onChange={(e) => {
              const it = dealStock.find((i) => i.id === e.target.value);
              setDeal({ ...deal, stock_item_id: e.target.value, price: it ? (it.wholesale_price ?? it.unit_price ?? "") : deal.price });
            }}
            placeholder={dealStock.length ? "Which stock?" : "No stock to deal on here"}
            options={dealStock.map((i) => ({ value: i.id, label: `${i.name} · ${i.quantity_available ?? i.quantity_in_stock} ${i.unit_of_measure || ""} · @${i.vendor_handle}` }))}
            aria-label="Deal stock"
            wrapperClassName="col-span-2 sm:col-span-4"
          />
          <Input type="number" min="1" step="1" placeholder="Quantity" value={deal.quantity} onChange={(e) => setDeal({ ...deal, quantity: e.target.value })} aria-label="Deal quantity" />
          <Input type="number" min="0" step="any" placeholder="Price / unit" prefix="KES" value={deal.price} onChange={(e) => setDeal({ ...deal, price: e.target.value })} aria-label="Deal price per unit" />
          <Select value={deal.delivery_terms} onChange={(e) => setDeal({ ...deal, delivery_terms: e.target.value })} options={DELIVERY_TERMS} aria-label="Delivery terms" />
          <Select value={deal.payment_terms} onChange={(e) => setDeal({ ...deal, payment_terms: e.target.value })} options={PAYMENT_TERMS} aria-label="Payment terms" />
          <div className="col-span-2 sm:col-span-4 h-8 flex items-center justify-between px-2 rounded-lg bg-surface-2 border border-edge-1 text-2xs font-mono text-amber-200">
            <span className="text-ink-4">{dealItem ? `list ${currency(dealItem.wholesale_price ?? dealItem.unit_price ?? 0)} / ${dealItem.unit_of_measure || "unit"}` : "the API reserves stock when the other side accepts"}</span>
            <span>{dealTotal ? `total ${currency(dealTotal)}` : "total —"}</span>
          </div>
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
