import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Coins, Footprints, Info, Wallet } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { hiringAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

/**
 * PRICE WORK — the receipt game, told honestly.
 *
 * One work day is twelve accepted price observations in one town. The ladder is
 * published: 100% pays KSh 200, 75% pays 150, 50% pays 100, below half pays
 * nothing and says why. Three things are stated on this screen rather than
 * buried, because each one is what stops it being a scam:
 *
 *   1. It is a paid task, not wages, and not a salary.
 *   2. The town pool is published BEFORE you start, so the rate cannot quietly
 *      drop after the work is done.
 *   3. Every rejected line must carry a reason.
 *
 * And the money story: a reward accrues here and the payer records a direct
 * M-Pesa reference. Brief never holds it.
 */
export default function PriceWorkPage() {
  const token = useAuthStore((s) => s.token);
  const [today, setToday] = useState(null);
  const [mine, setMine] = useState(null);
  const [town, setTown] = useState("");
  const [accepted, setAccepted] = useState("12");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [t, m] = await Promise.all([
      hiringAPI.rewardsToday(town || undefined).catch(() => null),
      token ? hiringAPI.myRewards().catch(() => null) : Promise.resolve(null),
    ]);
    if (t) setToday(t.data);
    setMine(m ? m.data : null);
  }, [town, token]);

  useEffect(() => {
    load();
  }, [load]);

  const assess = async () => {
    const count = Number(accepted);
    if (!Number.isInteger(count) || count < 0) {
      toast.error("Accepted observations must be a whole number.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await hiringAPI.assessDay({ accepted: count, town: town || null });
      toast.success(
        data.amount_kes > 0
          ? `KSh ${data.amount_kes} accrued. It is paid when the payer records the reference.`
          : "Assessed, but below half. The reason is on the entry.",
      );
      load();
    } catch (err) {
      toast.error(apiError(err, "Couldn't record that day."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <header className="space-y-1.5">
        <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
          <Footprints size={13} aria-hidden="true" /> Price work
        </p>
        <h1 className="text-xl font-semibold text-ink-1">Walk. Note the price. Get paid.</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-3">
          A shop’s price is public the moment it is written on a shelf. Collecting a town’s
          prices is real work, and this is what it pays.
        </p>
      </header>

      {!today && <PageSpinner />}

      {today && (
        <Card padding="p-4" className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-micro font-bold uppercase tracking-wide text-ink-4">Today, in {today.town || "your town"}</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-ink-1">
                KSh {today.full_day_kes.toLocaleString("en-KE")}
                <span className="ml-1 text-xs font-semibold text-ink-3">for a full day</span>
              </p>
              <p className="text-micro text-ink-4">
                Pool used today: KSh {today.committed_kes.toLocaleString("en-KE")} of{" "}
                {today.pool_kes.toLocaleString("en-KE")}
              </p>
            </div>
            <Badge variant={today.full_day_kes < 200 ? "amber" : "brand"}>
              {today.full_day_kes < 200 ? "Pool busy — reduced rate" : "Full rate today"}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-ink-3">{today.reason}</p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {today.ladder.map((step) => (
              <div key={step.share} className="rounded-lg bg-surface-2 px-2.5 py-2">
                <p className="text-micro font-bold uppercase tracking-wide text-ink-4">
                  {step.accepted} of {today.required_per_day}
                </p>
                <p className="text-sm font-bold tabular-nums text-ink-1">
                  KSh {step.kes.toLocaleString("en-KE")}
                </p>
              </div>
            ))}
            {/* The ladder stops at half on purpose; below it you earn nothing,
                and the reason is always written down. */}
            <div className="rounded-lg bg-surface-2 px-2.5 py-2">
              <p className="text-micro font-bold uppercase tracking-wide text-ink-4">under half</p>
              <p className="text-sm font-bold tabular-nums text-ink-1">KSh 0</p>
            </div>
          </div>

          <p className="flex items-start gap-1.5 rounded-lg bg-accent-50 p-2.5 text-micro leading-relaxed text-accent-900 dark:bg-accent-600/10 dark:text-accent-100">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            {today.payment_note} Below half of a day, nothing is earned — and every rejected
            line must carry a reason, so you always know what went wrong.
          </p>

          {token ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <Input label="Town" value={town} onChange={(e) => setTown(e.target.value)} placeholder="e.g. Kisii" />
              <Input
                label="Accepted observations"
                type="number" min="0" max="60" inputMode="numeric"
                value={accepted} onChange={(e) => setAccepted(e.target.value)}
              />
              <div className="flex items-end">
                <Button type="button" onClick={assess} disabled={saving} className="w-full sm:w-auto">
                  {saving ? "Recording…" : "Record this day"}
                </Button>
              </div>
            </div>
          ) : (
            <Link to="/auth" className="text-xs font-bold text-brand-700 hover:underline dark:text-brand-300">
              Sign in to record a day →
            </Link>
          )}
        </Card>
      )}

      {mine && (
        <Card padding="p-4" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-1">My days</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="amber">Accrued KSh {mine.accrued_kes.toLocaleString("en-KE")}</Badge>
              <Badge variant="brand">Paid KSh {mine.paid_kes.toLocaleString("en-KE")}</Badge>
            </div>
          </div>
          <p className="text-micro text-ink-4">
            Accrued means the number exists and the payer has not yet recorded a reference.
            Nobody is paid from Wasta, and a reward is never a salary.
          </p>
          {mine.items.length === 0 ? (
            <p className="text-xs text-ink-3">No days recorded yet.</p>
          ) : (
            <ul className="divide-y divide-edge-1">
              {mine.items.map((row) => (
                <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink-1">
                      {row.work_date} · {row.town || "town not stated"}
                    </p>
                    <p className="text-micro leading-relaxed text-ink-4">{row.reason}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold tabular-nums text-ink-1">
                      KSh {row.amount_kes.toLocaleString("en-KE")}
                    </p>
                    <p className="text-micro font-semibold uppercase tracking-wide text-ink-4">
                      {row.status}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="flex items-start gap-1.5 text-micro text-ink-4">
            <Wallet size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            Monthly cap KSh {mine.monthly_cap_kes.toLocaleString("en-KE")} — about twenty full days.
            It exists so this never quietly becomes a job.
          </p>
        </Card>
      )}

      <p className="flex items-start gap-1.5 rounded-card border border-edge-1 bg-surface-1 p-3 text-micro leading-relaxed text-ink-3">
        <Info size={12} className="mt-0.5 shrink-0 text-ink-4" aria-hidden="true" />
        <span>
          What counts as an observation: an item, a price, the shop, and the date — with a
          photo where you can get one. A price already confirmed in the last two weeks earns
          nothing, and the same receipt never earns twice.{" "}
          <Link to="/savings" className="font-bold text-brand-700 hover:underline dark:text-brand-300">
            See what the data already shows
          </Link>
          .
        </span>
      </p>

      <p className="flex items-center gap-1.5 text-micro text-ink-4">
        <Coins size={12} aria-hidden="true" />
        Every reward is recorded with a payment reference when it is paid.
      </p>
    </div>
  );
}
