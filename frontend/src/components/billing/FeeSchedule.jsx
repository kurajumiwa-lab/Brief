import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import { feesAPI } from "@/lib/api";

/**
 * Transparent fee schedule. Free for now: the server says so, and this card
 * repeats it. A rule only shows a charge when the server reports it as live.
 */
export default function FeeSchedule() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    feesAPI.schedule()
      .then(({ data: body }) => { if (alive) setData(body); })
      .catch(() => { if (alive) setData({ fees_live: false, message: "Free for now. No fees are being charged.", rules: [] }); });
    return () => { alive = false; };
  }, []);

  if (!data) return null;
  const live = data.fees_live === true;

  return (
    <Card>
      <p className="text-sm font-bold text-ink-1">Fees</p>
      <p className="text-2xs text-ink-3 mt-1 leading-relaxed">{data.message}</p>
      {live && data.rules?.some((r) => r.charging_now) ? (
        <div className="mt-3 space-y-1.5">
          {data.rules.filter((r) => r.charging_now).map((r) => (
            <p key={r.key} className="text-2xs text-ink-2">
              {r.label}: {r.basis === "bps" ? `${(r.rate_bps / 100).toFixed(2)}% of the value` : `KSh ${r.amount_kes.toLocaleString("en-KE")}`}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
