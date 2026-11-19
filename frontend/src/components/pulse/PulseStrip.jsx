import { useEffect, useState } from "react";
import { Flame, Timer } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";
import { pulseAPI } from "@/lib/pulseApi";
import { formatKes } from "@/lib/receipts";

const when = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("en-KE", { weekday: "short", hour: "2-digit", minute: "2-digit" });
};

/** The current pulse window plus any live flash drops. */
export default function PulseStrip() {
  const [pulse, setPulse] = useState(null);
  const [drops, setDrops] = useState([]);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [current, dropList] = await Promise.all([pulseAPI.current(), pulseAPI.flashDrops()]);
        if (!live) return;
        setPulse(current.data);
        setDrops(dropList.data.drops || []);
      } catch {
        /* the strip is optional; the Events page still works without it */
      }
    };
    load();
    return () => { live = false; };
  }, []);

  if (!pulse) return null;
  const active = pulse.active;

  const claim = async (drop) => {
    setBusy(drop.id);
    try {
      const { data } = await pulseAPI.claimDrop(drop.id);
      if (data.claimed) {
        toast.success("Claimed — next drop is below. Pay the seller directly.");
        setDrops((rows) => rows.map((row) => (row.id === drop.id
          ? { ...row, remaining: data.drop.remaining, claimed_count: data.drop.claimed_count,
              can_claim: data.drop.remaining > 0 }
          : row)));
      } else {
        toast(data.message);
      }
    } catch (error) {
      toast.error(apiError(error, "That drop could not be claimed."));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-2" data-testid="pulse-strip">
      <div
        className="rounded-2xl border-l-4 border-y border-r border-edge-1 bg-surface-1 p-4"
        style={{ borderLeftColor: pulse.rail?.color || "#E65100" }}
        data-testid="pulse-window"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-4">
              <Flame size={12} style={{ color: pulse.rail?.color || "#E65100" }} />
              {active ? "Happening now" : "Next rhythm"}
            </p>
            <h3 className="mt-0.5 text-sm font-semibold text-ink-1">
              {active ? active.label : pulse.next?.label}
            </h3>
            <p className="text-2xs text-ink-3">{(active || pulse.next)?.hint}</p>
          </div>
          <Badge variant="outline" size="xs">
            {active ? `Ends ${when(active.ends_at)}` : `Starts ${when(pulse.next?.starts_at)}`}
          </Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {((active || pulse.next)?.categories || []).map((category) => (
            <span key={category} className="rounded-full border border-edge-2 px-2 py-0.5 text-2xs text-ink-3">
              {category}
            </span>
          ))}
        </div>
      </div>

      {drops.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-2">
          {drops.map((drop) => (
            <div key={drop.id} className="rounded-xl border border-edge-1 bg-surface-0 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1 truncate text-xs font-semibold text-ink-1">
                    <Timer size={11} className="text-amber-600" /> {drop.label}
                  </p>
                  <p className="text-2xs text-ink-4">
                    {drop.seller?.business ? `${drop.seller.business} · ` : ""}
                    {formatKes(drop.price_kes)} · {drop.remaining} left · {drop.minutes_left} min
                  </p>
                </div>
                <Button size="xs" variant={drop.remaining > 0 ? "secondary" : "ghost"}
                        loading={busy === drop.id} disabled={!drop.can_claim}
                        onClick={() => claim(drop)}>
                  {drop.remaining > 0 ? "Claim" : "Claimed — Next Drop"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
