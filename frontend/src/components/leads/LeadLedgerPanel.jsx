import { useEffect, useState } from "react";
import { Receipt, Sparkles, Users } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { leadAPI } from "@/lib/leadApi";
import { formatKes } from "@/lib/receipts";

const ACTION_LABEL = {
  call: "Called", whatsapp: "WhatsApp", visit: "Visited", book: "Booked",
  claim: "Claimed", quote: "Asked for a quote", join: "Joined",
};

/**
 * The merchant's side of the lead ledger. A statement, not a wallet: Brief
 * records the handshake and the fair contribution; the business pays it and the
 * scout bounty directly.
 */
export default function LeadLedgerPanel() {
  const [data, setData] = useState(null);
  const [scout, setScout] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [mine, scouted] = await Promise.all([leadAPI.mine(), leadAPI.scouted()]);
        if (!live) return;
        setData(mine.data);
        setScout(scouted.data);
      } catch {
        if (live) setError(true);
      }
    };
    load();
    return () => { live = false; };
  }, []);

  if (error) return null;
  if (!data) {
    return (
      <section data-testid="lead-ledger-panel" className="rounded-card-lg border border-edge-1 bg-surface-1 p-5">
        <p className="text-xs text-ink-4">Loading your lead ledger…</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="lead-ledger-heading"
      data-testid="lead-ledger-panel"
      className="rounded-card-lg border border-edge-1 bg-surface-1 p-5 shadow-xs space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="lead-ledger-heading" className="flex items-center gap-2 text-lg font-bold text-ink-1">
            <Receipt size={18} className="text-brand-600" aria-hidden="true" /> Lead ledger
          </h2>
          <p className="mt-0.5 text-2xs text-ink-3">
            A verified handshake is a person who called, visited, booked or asked you for a quote.
            One person, one handshake, however many taps.
          </p>
        </div>
        <Badge variant="brand" size="sm">{data.month}</Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Verified handshakes" value={data.verified_leads} />
        <Stat label="People" value={data.unique_people} icon={Users} />
        <Stat label="Fair contribution" value={formatKes(data.due_kes)} />
        <Stat label="Scout bounties" value={formatKes(data.scout_bounty_kes)} hint="Paid directly" />
      </div>

      {Object.keys(data.by_target_kind || {}).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(data.by_target_kind).map(([kind, count]) => (
            <Badge key={kind} variant="outline" size="xs">{kind} · {count}</Badge>
          ))}
          {data.scouts_credited > 0 && (
            <Badge variant="amber" size="xs">{data.scouts_credited} scout{data.scouts_credited === 1 ? "" : "s"} credited</Badge>
          )}
        </div>
      )}

      {(data.recent || []).length === 0 ? (
        <p className="text-xs text-ink-4">
          No handshakes yet. When someone taps Connect on your Page or asks for a quote, it lands here.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {data.recent.slice(0, 6).map((lead) => (
            <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge-1 bg-surface-0 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-ink-1">{lead.target_label}</p>
                <p className="text-2xs text-ink-4">
                  {ACTION_LABEL[lead.action] || lead.action}
                  {lead.scout ? ` · spotted by @${lead.scout.handle}` : ""}
                  {lead.created_at ? ` · ${lead.created_at.slice(0, 10)}` : ""}
                </p>
              </div>
              <span className="text-2xs font-semibold text-ink-2">{formatKes(lead.fee_kes)}</span>
            </li>
          ))}
        </ul>
      )}

      {scout?.leads > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-1">
            <Sparkles size={13} className="text-amber-600" /> You also scout: {formatKes(scout.earned_kes)} from {scout.leads} referral{scout.leads === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 text-2xs text-ink-3">The business pays you directly; Wasta records the credit.</p>
        </div>
      )}

      <p className="text-micro text-ink-4">{data.note}</p>
    </section>
  );
}

function Stat({ label, value, icon: Icon, hint }) {
  return (
    <div className="rounded-xl border border-edge-1 bg-surface-0 p-3">
      <p className="flex items-center gap-1 text-2xs text-ink-4">
        {Icon && <Icon size={11} />} {label}
      </p>
      <p className="mt-1 text-lg font-bold text-ink-1 tabular-nums">{value}</p>
      {hint && <p className="text-micro text-ink-4">{hint}</p>}
    </div>
  );
}
