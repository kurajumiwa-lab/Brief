import { useState } from "react";
import {
  BadgeCheck, Check, Circle, Copy, ImageIcon, RefreshCw, ShieldAlert,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { socialTrustAPI, apiError } from "@/lib/api";
import { mediaUrl } from "@/lib/media";
import { useAuthStore } from "@/stores/authStore";
import { formatKes } from "@/lib/receipts";
import { cn } from "@/lib/utils";

/**
 * THE SOCIAL SELLER TRUST HEADER on /p/:handle.
 *
 * A TikTok or Facebook buyer opens this from a bio link, so it leads with the
 * three things that are checkable without an account: completed deliveries, a
 * current stock-in-hand photo, and the seller's public bio links.
 *
 * Every signal carries its own sentence about what it does *not* prove. The
 * copy is not decoration: it is the difference between "a photo exists" and a
 * badge that implies the platform has verified the business.
 */

const PLATFORM_LABEL = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };

export default function SocialTrustCard({ card, className }) {
  const [copied, setCopied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNote, setReportNote] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const viewer = useAuthStore((s) => s.vendor);
  if (!card) return null;
  const canReport = Boolean(viewer?.vendor_handle) && viewer.vendor_handle !== card.handle;

  async function copyReply() {
    try {
      await navigator.clipboard.writeText(card.trust_reply);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      toast.success("Trust reply copied — paste it in the comments or bio.");
    } catch {
      toast.error("Copy is blocked in this browser. Select the text instead.");
    }
  }

  const disputed = Number(card.dispute?.open_reports || 0) > 0;

  async function sendReport() {
    if (reportNote.trim().length < 20) {
      return toast.error("Describe what went wrong in at least 20 characters.");
    }
    setReporting(true);
    try {
      await socialTrustAPI.reportDelivery({ seller_handle: card.handle, note: reportNote.trim() });
      setReported(true);
      setReportOpen(false);
      toast.success("Report recorded. The seller can respond; it is an allegation, not a finding.");
    } catch (err) {
      toast.error(apiError(err, "That report could not be filed."));
    } finally {
      setReporting(false);
    }
  }

  return (
    <section
      className={cn("overflow-hidden rounded-2xl border border-edge-1 bg-surface-1", className)}
      aria-labelledby="trust-heading"
      data-testid="social-trust-card"
    >
      {card.dispute?.warning && (
        <div
          className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100"
          role="alert"
          data-testid="delivery-warning-banner"
        >
          <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-xs font-extrabold leading-snug">{card.dispute.warning_text}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed opacity-80">{card.dispute.signal_note}</p>
          </div>
        </div>
      )}

      <div className="space-y-3 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Trust card</p>
            <h2 id="trust-heading" className="mt-0.5 text-sm font-extrabold tracking-tight text-ink-1">
              {card.name}
            </h2>
          </div>
          <Button size="sm" variant="secondary" className="min-h-[44px]" icon={copied ? Check : Copy} onClick={copyReply}>
            {copied ? "Copied" : "Copy Trust Reply"}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2" role="list">
          <div role="listitem" className="rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-2 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Completed deliveries</p>
            <p className="mt-0.5 text-lg font-extrabold tabular-nums text-emerald-900 dark:text-emerald-100" data-testid="trust-deliveries">
              {card.verified_deliveries}
            </p>
            <p className="text-[10px] leading-tight text-emerald-800/70 dark:text-emerald-200/70">{card.delivery_note}</p>
          </div>
          <div
            role="listitem"
            className={cn(
              "rounded-xl border px-2.5 py-2",
              disputed
                ? "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                : "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
            )}
          >
            <p className={cn("text-[10px] font-semibold uppercase tracking-wide", disputed ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300")}>Delivery reports</p>
            <p className={cn("mt-0.5 text-lg font-extrabold tabular-nums", disputed ? "text-amber-900 dark:text-amber-100" : "text-emerald-900 dark:text-emerald-100")} data-testid="trust-dispute-ratio">
              {card.dispute?.ratio_label || "0 unresolved"}
            </p>
            <p className={cn("text-[10px] leading-tight", disputed ? "text-amber-800/70 dark:text-amber-200/70" : "text-emerald-800/70 dark:text-emerald-200/70")}>
              {card.dispute?.signal_note}
            </p>
          </div>
        </div>

        {card.stock_proof ? (
          <article className="overflow-hidden rounded-xl border border-edge-1 bg-surface-0" data-testid="stock-in-hand">
            <div className="flex items-center gap-1.5 border-b border-edge-1 px-2.5 py-1.5 text-[10px] font-bold text-ink-2">
              <ImageIcon size={11} aria-hidden="true" />
              {card.stock_proof.label}
            </div>
            <img
              src={mediaUrl(card.stock_proof.image_url)}
              alt={`${card.stock_proof.item_title} with today's code`}
              className="h-40 w-full object-cover"
              loading="lazy"
            />
            <div className="space-y-0.5 px-2.5 py-2">
              <p className="text-xs font-bold text-ink-1">{card.stock_proof.item_title}</p>
              {card.stock_proof.price_kes != null && (
                <p className="text-[11px] font-semibold text-ink-2">{formatKes(card.stock_proof.price_kes)}</p>
              )}
              <p className="text-[10px] leading-relaxed text-ink-4">{card.stock_proof.signal_note}</p>
            </div>
          </article>
        ) : (
          <div className="rounded-xl border border-dashed border-edge-2 bg-surface-0 px-3 py-3 text-center">
            <p className="text-[11px] font-semibold text-ink-2">No current stock-in-hand photo</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-ink-4">
              A photo is valid for 48 hours. Ask the seller for one before paying.
            </p>
          </div>
        )}

        {card.bio_links.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="bio-links">
            {card.bio_links.map((link) => (
              <a
                key={link.platform}
                href={link.profile_url}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold",
                  link.bio_verified
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200"
                    : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
                )}
                title={link.signal_note}
              >
                {link.bio_verified ? <BadgeCheck size={11} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}
                {PLATFORM_LABEL[link.platform] || link.platform} @{link.handle} {link.bio_verified ? "✔" : "— not matched"}
              </a>
            ))}
          </div>
        )}
        {card.bio_links.length > 0 && (
          <p className="text-[10px] leading-relaxed text-ink-4">{card.bio_links[0].signal_note}</p>
        )}

        {card.routines?.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="trust-routines">
            {card.routines.map((routine) => (
              <span
                key={`${routine.title}-${routine.day_of_week}`}
                className="inline-flex items-center gap-1 rounded-full border border-edge-2 bg-surface-2 px-2 py-1 text-[10px] font-bold text-ink-2"
                title={routine.title}
              >
                <RefreshCw size={10} aria-hidden="true" />
                {routine.recurrence_label} · {routine.start_time_local} · {routine.town}
              </span>
            ))}
          </div>
        )}

        {canReport && (
          <div className="border-t border-edge-1 pt-2">
            {reported ? (
              <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                Report recorded. It stays visible until the seller resolves it.
              </p>
            ) : reportOpen ? (
              <div className="space-y-1.5">
                <label className="block text-[10px] font-semibold text-ink-2">
                  What happened?
                  <textarea
                    rows={2}
                    value={reportNote}
                    onChange={(event) => setReportNote(event.target.value)}
                    placeholder="Paid on 12 Nov, parcel never arrived; M-Pesa receipt available."
                    className="mt-1 w-full rounded-lg border border-edge-2 bg-surface-0 px-2 py-1.5 text-xs text-ink-1"
                  />
                </label>
                <p className="text-[10px] leading-relaxed text-ink-4">
                  Only Level 2+ buyers with a trade with this seller can report.
                  A report is an allegation, not a finding, and changes no standing.
                </p>
                <div className="flex gap-1.5">
                  <Button size="xs" variant="ghost" onClick={() => setReportOpen(false)}>Cancel</Button>
                  <Button size="xs" variant="secondary" loading={reporting} onClick={sendReport}>File report</Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                className="text-[10px] font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900 dark:text-amber-200"
              >
                Report a delivery problem
              </button>
            )}
          </div>
        )}

        <p className="border-t border-edge-1 pt-2 text-[10px] leading-relaxed text-ink-4">
          {card.signals_note} Nobody can buy standing on this network.
        </p>
      </div>
    </section>
  );
}
