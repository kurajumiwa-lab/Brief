import { Share2 } from "lucide-react";
import { eventAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";

export default function WhatsAppRosterButton({ event }) {
  const share = async () => {
    const popup = window.open("about:blank", "_blank");
    if (!popup) { toast.error("Please allow pop-ups to share the roster."); return; }
    popup.opener = null;
    try {
      const { data } = await eventAPI.roster(event.id);
      const names = data.confirmed_names.slice(0, 8).join(", ") || "Be the first to confirm";
      const extra = data.confirmed_names.length > 8 ? ` +${data.confirmed_names.length - 8} others` : "";
      const msg = [`*${event.title.toUpperCase()}*`, `When: ${new Date(event.start_date + "Z").toLocaleString()}${event.departure_time ? ` · ${event.departure_time}` : ""}`, event.meeting_point && `Meet: ${event.meeting_point}`, `Cost: KSh ${event.entry_fee}`, event.payment_number && `${event.payment_method}: ${event.payment_number}${event.payment_account ? ` · Account: ${event.payment_account}` : ""} (${event.payment_recipient_name || ""})`, `Spots: ${data.confirmed_count}/${data.capacity || "∞"} confirmed · ${data.waitlist_count} waiting`, `Confirmed: ${names}${extra}`, `${window.location.origin}/e/${event.slug || event.id}`].filter(Boolean).join("\n");
      popup.location.href = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    } catch (error) { popup.close(); toast.error(apiError(error)); }
  };
  return <button type="button" onClick={share} className="flex items-center gap-2 rounded-xl border border-edge-1 px-3 py-2 text-sm"><Share2 size={15} /> Share live roster</button>;
}
