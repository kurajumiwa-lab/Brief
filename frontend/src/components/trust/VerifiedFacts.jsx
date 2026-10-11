import { BadgeCheck, FileText, ShieldQuestion, AlertTriangle, XCircle, Clock3 } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   VERIFIED FACTS
   ---------------------------------------------------------------------------
   The paperwork half of trust. TrustSignals derives a level from real trade
   (fulfilment over completed movements); this module renders the *documents*
   a business has put on record and exactly how far each one got.

   The wording is the contract, not decoration:

       verified    a named person saw the document or checked the reference
       documented  a file is on record; no human has checked it yet
       declared    the owner says so; nothing seen
       expired     the printed date has passed — it is not a live fact
       rejected    a verifier sent it back, and the reason is shown

   Nothing here is summed into a score, and nothing says "compliant". A
   passport is a record of evidence, and the disclaimer travels with it.
   ═══════════════════════════════════════════════════════════════════════════ */

export const FACT_STATUS = {
  verified: {
    label: "Verified", variant: "brand", icon: BadgeCheck,
    hint: "A named person saw the document or checked the reference on the date shown.",
  },
  documented: {
    label: "On file, unchecked", variant: "blue", icon: FileText,
    hint: "The file is on record, but no human has checked it yet.",
  },
  declared: {
    label: "Declared", variant: "amber", icon: ShieldQuestion,
    hint: "The owner told us; nothing has been seen yet.",
  },
  expired: {
    label: "Expired", variant: "gray", icon: Clock3,
    hint: "The date the document carries has passed — this is no longer a live fact.",
  },
  rejected: {
    label: "Sent back", variant: "red", icon: XCircle,
    hint: "A verifier found a problem; the reason is on the claim.",
  },
  withdrawn: {
    label: "Withdrawn", variant: "gray", icon: AlertTriangle,
    hint: "The owner took this down.",
  },
};

export function FactStatusBadge({ status, size = "xs" }) {
  const meta = FACT_STATUS[status] || FACT_STATUS.declared;
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant} size={size} title={meta.hint}>
      <Icon size={10} aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

/** One claim, as a row. `mine` adds the file link and the verifier's words. */
export function FactRow({ fact, mine = false }) {
  const verifiedOn = fact.verified_at ? new Date(fact.verified_at).toLocaleDateString() : null;
  return (
    <div className="rounded-xl border border-edge-1 bg-surface-1 px-3 py-2.5 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink-1 truncate">{fact.label}</p>
          <p className="text-2xs text-ink-4 truncate">{fact.issuer}</p>
        </div>
        <FactStatusBadge status={fact.status} />
      </div>
      <p className="text-2xs text-ink-3">
        {fact.status === "verified" && verifiedOn && <>Checked {verifiedOn}</>}
        {fact.status === "verified" && fact.expires_on && <> · valid to {fact.expires_on}</>}
        {fact.status !== "verified" && fact.expires_on && <>Expires {fact.expires_on}</>}
        {fact.reference && <span className="text-ink-4"> · ref {fact.reference}</span>}
      </p>
      {fact.rejection_reason && (
        <p className="text-2xs text-red-700 dark:text-red-300">{fact.rejection_reason}</p>
      )}
      {mine && fact.verification_note && (
        <p className="text-2xs text-ink-3 italic">Verifier: {fact.verification_note}</p>
      )}
      {mine && fact.evidence_url && (
        <a href={fact.evidence_url} target="_blank" rel="noreferrer"
           className="text-2xs text-brand-700 dark:text-brand-300 underline">
          {fact.evidence_name || "Evidence"}
        </a>
      )}
    </div>
  );
}

export function VerifiedFacts({ facts = [], mine = false, emptyText }) {
  if (!facts.length) {
    return emptyText ? <p className="text-2xs text-ink-4">{emptyText}</p> : null;
  }
  return (
    <div className="space-y-1.5">
      {facts.map((fact) => <FactRow key={fact.id} fact={fact} mine={mine} />)}
    </div>
  );
}

/**
 * Compact strip for a shop front: the headline in the owner's words and one
 * chip per LIVE VERIFIED fact. Nothing else — a profile is not the place for
 * a business's gaps.
 */
export function VerifiedStrip({ headline, facts = [], onOpen, className }) {
  const verified = facts.filter((f) => f.status === "verified");
  if (!headline && !verified.length) return null;
  return (
    <div className={cn("rounded-xl border border-edge-1 bg-surface-1 px-3 py-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs font-semibold text-ink-3 inline-flex items-center gap-1">
          <BadgeCheck size={11} className="text-brand-600 dark:text-brand-300" />
          Business passport
        </p>
        {onOpen && (
          <button type="button" onClick={onOpen} className="text-2xs text-brand-700 dark:text-brand-300 underline cursor-pointer">
            {verified.length} verified fact{verified.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
      {headline && <p className="text-xs text-ink-1 mt-1">{headline}</p>}
      {verified.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {verified.map((fact) => (
            <span key={fact.id}
                  className="text-[10px] font-semibold rounded-full bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300 px-2 py-0.5">
              {fact.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
