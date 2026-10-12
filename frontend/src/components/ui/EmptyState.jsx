import { cn } from "@/lib/utils";

/**
 * Infer a relevant marketplace illustration from explicit `illustration` prop
 * or from the title/description text so every EmptyState across the platform
 * renders a cohesive, contextual visual on a solid opaque surface.
 */
function resolveIllustration(illustration, title = "", description = "", tone = "neutral") {
  if (illustration) return illustration;
  if (tone === "danger") return "error";
  if (tone === "restricted") return "restricted";
  if (tone === "expired") return "expired";
  const text = `${title} ${description}`.toLowerCase();
  if (text.includes("match") || text.includes("search") || text.includes("filter")) return "search";
  if (text.includes("message") || text.includes("chat") || text.includes("conversation") || text.includes("room") || text.includes("topic")) return "messages";
  if (text.includes("warehouse") || text.includes("cold") || text.includes("calendar") || text.includes("space") || text.includes("facility") || text.includes("tool") || text.includes("equipment") || text.includes("rental")) return "warehouse";
  if (text.includes("collective") || text.includes("pledge") || text.includes("consolidat") || text.includes("pool") || text.includes("group") || text.includes("lock") || text.includes("cluster")) return "consolidation";
  if (text.includes("job") || text.includes("call") || text.includes("task") || text.includes("shift") || text.includes("worker") || text.includes("squad") || text.includes("contract")) return "jobs";
  if (text.includes("notification") || text.includes("activity") || text.includes("quiet") || text.includes("pulse") || text.includes("feed")) return "notifications";
  if (text.includes("request") || text.includes("booking") || text.includes("movement") || text.includes("order") || text.includes("shipment") || text.includes("route")) return "requests";
  if (text.includes("stock") || text.includes("shelf") || text.includes("item") || text.includes("listing") || text.includes("saved")) return "stock";
  return "stock";
}

function EmptyIllustration({ kind, Icon, tone }) {
  const isDanger = tone === "danger" || kind === "error";
  const isAmber = tone === "amber" || kind === "expired" || kind === "restricted";

  const bgClass = isDanger
    ? "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300"
    : isAmber
    ? "bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-300"
    : "bg-brand-50 text-brand-700 dark:bg-surface-2 dark:text-brand-300";

  return (
    <div
      className="relative mb-4 inline-flex items-center justify-center"
      aria-hidden="true"
      data-testid={`empty-illustration-${kind}`}
    >
      <div className={cn("w-24 h-20 rounded-2xl flex items-center justify-center relative overflow-hidden shadow-2xs", bgClass)}>
        <svg viewBox="0 0 120 96" className="w-full h-full" fill="none">
          {/* Solid card backdrop inside illustration */}
          <rect x="12" y="14" width="96" height="68" rx="10" className="fill-surface-0 stroke-edge-2" strokeWidth="1.5" />
          {kind === "messages" && (
            <>
              <rect x="22" y="24" width="52" height="22" rx="6" className="fill-brand-100 dark:fill-surface-3" />
              <circle cx="32" cy="35" r="5" className="fill-brand-600" />
              <rect x="41" y="31" width="24" height="4" rx="2" className="fill-brand-700" />
              <rect x="41" y="37" width="16" height="3" rx="1.5" className="fill-ink-4" />
              <rect x="46" y="50" width="52" height="22" rx="6" className="fill-surface-2 stroke-edge-2" strokeWidth="1" />
              <rect x="54" y="57" width="28" height="4" rx="2" className="fill-ink-3" />
              <rect x="54" y="63" width="18" height="3" rx="1.5" className="fill-ink-4" />
              <circle cx="90" cy="61" r="4" className="fill-accent-500" />
            </>
          )}
          {kind === "search" && (
            <>
              <rect x="22" y="24" width="48" height="12" rx="4" className="fill-surface-2" />
              <rect x="22" y="40" width="64" height="12" rx="4" className="fill-surface-2" />
              <rect x="22" y="56" width="38" height="12" rx="4" className="fill-surface-2" />
              <circle cx="82" cy="52" r="14" className="fill-brand-50 dark:fill-surface-3 stroke-brand-600" strokeWidth="2.5" />
              <path d="M92 62L100 70" className="stroke-brand-600" strokeWidth="3" strokeLinecap="round" />
            </>
          )}
          {kind === "warehouse" && (
            <>
              <path d="M24 38L60 22L96 38V72H24V38Z" className="fill-surface-1 stroke-brand-600" strokeWidth="2" />
              <rect x="38" y="46" width="18" height="26" rx="2" className="fill-brand-100 dark:fill-surface-3 stroke-brand-600" strokeWidth="1.5" />
              <rect x="64" y="52" width="18" height="20" rx="2" className="fill-accent-100 dark:fill-surface-3 stroke-accent-600" strokeWidth="1.5" />
              <line x1="38" y1="55" x2="56" y2="55" className="stroke-brand-600" strokeWidth="1.2" />
              <line x1="38" y1="63" x2="56" y2="63" className="stroke-brand-600" strokeWidth="1.2" />
            </>
          )}
          {kind === "consolidation" && (
            <>
              <circle cx="34" cy="34" r="8" className="fill-brand-100 stroke-brand-600" strokeWidth="1.8" />
              <circle cx="60" cy="28" r="8" className="fill-brand-100 stroke-brand-600" strokeWidth="1.8" />
              <circle cx="86" cy="34" r="8" className="fill-brand-100 stroke-brand-600" strokeWidth="1.8" />
              <path d="M36 42L52 54M60 36V52M84 42L68 54" className="stroke-brand-500" strokeWidth="1.8" strokeLinecap="round" />
              <rect x="36" y="54" width="48" height="18" rx="5" className="fill-brand-600" />
              <rect x="44" y="61" width="32" height="4" rx="2" className="fill-surface-0" />
            </>
          )}
          {kind === "jobs" && (
            <>
              <rect x="26" y="24" width="68" height="48" rx="7" className="fill-surface-1 stroke-edge-2" strokeWidth="1.5" />
              <rect x="34" y="32" width="18" height="18" rx="4" className="fill-brand-600" />
              <path d="M39 41L42 44L48 38" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="58" y="33" width="28" height="5" rx="2.5" className="fill-ink-2" />
              <rect x="58" y="42" width="20" height="4" rx="2" className="fill-brand-600" />
              <rect x="34" y="56" width="52" height="8" rx="4" className="fill-surface-2" />
            </>
          )}
          {kind === "notifications" && (
            <>
              <rect x="24" y="26" width="72" height="18" rx="5" className="fill-surface-2" />
              <circle cx="34" cy="35" r="4" className="fill-brand-600" />
              <rect x="44" y="32" width="38" height="4" rx="2" className="fill-ink-3" />
              <rect x="24" y="50" width="72" height="18" rx="5" className="fill-surface-1 stroke-edge-2" strokeWidth="1.2" />
              <circle cx="34" cy="59" r="4" className="fill-accent-500" />
              <rect x="44" y="56" width="30" height="4" rx="2" className="fill-ink-4" />
            </>
          )}
          {kind === "requests" && (
            <>
              <rect x="26" y="24" width="44" height="48" rx="6" className="fill-surface-1 stroke-brand-600" strokeWidth="1.6" />
              <rect x="34" y="33" width="28" height="4" rx="2" className="fill-ink-2" />
              <rect x="34" y="42" width="22" height="4" rx="2" className="fill-ink-4" />
              <rect x="34" y="51" width="26" height="4" rx="2" className="fill-ink-4" />
              <circle cx="80" cy="54" r="13" className="fill-brand-600" />
              <path d="M75 54L78.5 57.5L86 50" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
          {(kind === "error" || kind === "restricted" || kind === "expired") && (
            <>
              <rect x="26" y="26" width="68" height="44" rx="8" className="fill-surface-1" />
              <circle cx="60" cy="48" r="14" className={isDanger ? "fill-red-100 stroke-red-600" : "fill-accent-100 stroke-accent-600"} strokeWidth="2" />
              <path d="M60 41V49" className={isDanger ? "stroke-red-600" : "stroke-accent-600"} strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="60" cy="54" r="1.5" className={isDanger ? "fill-red-600" : "fill-accent-600"} />
            </>
          )}
          {kind === "stock" && (
            <>
              <rect x="26" y="44" width="30" height="26" rx="4" className="fill-brand-100 dark:fill-surface-3 stroke-brand-600" strokeWidth="1.6" />
              <rect x="60" y="44" width="30" height="26" rx="4" className="fill-surface-2 stroke-edge-3" strokeWidth="1.6" />
              <rect x="43" y="22" width="30" height="24" rx="4" className="fill-accent-100 dark:fill-surface-2 stroke-accent-600" strokeWidth="1.6" />
              <line x1="34" y1="53" x2="48" y2="53" className="stroke-brand-700" strokeWidth="2" strokeLinecap="round" />
              <line x1="51" y1="31" x2="65" y2="31" className="stroke-accent-700" strokeWidth="2" strokeLinecap="round" />
            </>
          )}
        </svg>
      </div>
      {Icon && (
        <span
          className={cn(
            "absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-xl border border-edge-1 bg-surface-0 shadow-sm flex items-center justify-center",
            isDanger ? "text-red-600 dark:text-red-400" : isAmber ? "text-accent-600 dark:text-accent-400" : "text-brand-700 dark:text-brand-300"
          )}
        >
          <Icon size={16} aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

/**
 * Every empty state answers three questions: what is missing, why, and what
 * to do next. Rendered on a solid opaque surface with a contextual illustration.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact,
  tone = "neutral",
  illustration,
  stateLabel,
}) {
  const kind = resolveIllustration(illustration, title, description, tone);
  const badgeText =
    stateLabel ||
    (kind === "search"
      ? "No matching filter results"
      : tone === "danger"
      ? "Connection or load issue"
      : tone === "restricted"
      ? "Permission restricted"
      : tone === "expired"
      ? "Listing expired"
      : null);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center rounded-2xl border border-edge-1 bg-surface-1 shadow-xs",
        compact ? "py-9 px-5" : "py-14 px-6",
        className
      )}
    >
      <EmptyIllustration kind={kind} Icon={Icon} tone={tone} />
      {badgeText && (
        <span
          className={cn(
            "mb-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-micro font-semibold",
            tone === "danger"
              ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
              : tone === "restricted" || tone === "expired"
              ? "bg-accent-50 text-accent-800 dark:bg-accent-950 dark:text-accent-300"
              : "bg-surface-2 text-ink-3"
          )}
        >
          {badgeText}
        </span>
      )}
      <h3 className="text-base font-semibold text-ink-1">{title}</h3>
      {description && <p className="text-xs text-ink-3 mt-1.5 max-w-sm leading-relaxed text-pretty">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
