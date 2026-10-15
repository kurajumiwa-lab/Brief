import { Building2 } from "lucide-react";
import { cn, initials } from "@/lib/utils";

const sizes = {
  xs: "w-6 h-6 text-micro rounded-lg",
  sm: "w-8 h-8 text-2xs rounded-lg",
  md: "w-10 h-10 text-xs rounded-xl",
  lg: "w-14 h-14 text-base rounded-2xl",
  xl: "w-20 h-20 text-2xl rounded-3xl",
  "2xl": "w-24 h-24 text-3xl rounded-3xl",
};

const badgeSizes = {
  xs: "w-3.5 h-3.5 text-[7px] -bottom-0.5 -right-0.5 rounded",
  sm: "w-4 h-4 text-[8px] -bottom-0.5 -right-0.5 rounded-md",
  md: "w-5 h-5 text-[9px] -bottom-1 -right-1 rounded-md",
  lg: "w-6 h-6 text-[10px] -bottom-1 -right-1 rounded-lg",
  xl: "w-7 h-7 text-2xs -bottom-1 -right-1 rounded-lg",
  "2xl": "w-8 h-8 text-xs -bottom-1 -right-1 rounded-xl",
};

// Deterministic palette: the same business always gets the same colour, which
// makes avatars function as recognisable identity across every surface.
const palette = [
  "bg-brand-600",
  "bg-blue-600",
  "bg-accent-600",
  "bg-orchid-600",
  "bg-rose-600",
  "bg-teal-600",
  "bg-indigo-600",
  "bg-orange-600",
];

const hue = (s = "") => palette[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];

/**
 * Identity avatar supporting:
 * - Standard avatar (`name`, `src`)
 * - Chat & organizational identity modes:
 *   · `personal_photo` — personal profile photograph/avatar
 *   · `business_logo` — business logo emblem
 *   · `combined` — personal photograph as primary avatar + business logo as secondary corner marker
 *   · `business_with_role` — business logo/emblem with sender role context
 */
export default function Avatar({
  name = "",
  size = "md",
  ring,
  className,
  online,
  src,
  logoSrc,
  businessName,
  personalName,
  mode,
}) {
  const effectiveMode = mode || (logoSrc && src ? "combined" : logoSrc ? "business_logo" : "default");
  const isBusinessPrimary = effectiveMode === "business_logo" || effectiveMode === "business_with_role";
  const isCombined = effectiveMode === "combined";

  const primarySrc = isBusinessPrimary ? logoSrc || src : src;
  const primaryLabel =
    effectiveMode === "personal_photo" || isCombined
      ? personalName || name
      : businessName || name;

  const secondaryName = businessName || name;
  const sizeCls = sizes[size] || sizes.md;
  const shapeCls = effectiveMode === "personal_photo" || isCombined ? "rounded-full" : "";

  return (
    <div className={cn("relative shrink-0 inline-flex", className)} data-identity-mode={effectiveMode}>
      {primarySrc ? (
        <img
          src={primarySrc}
          alt=""
          className={cn(
            "object-cover bg-surface-2 border border-edge-1",
            sizeCls,
            shapeCls,
            ring && "ring-2 ring-brand-500 ring-offset-2 ring-offset-surface-0"
          )}
        />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center font-bold text-white select-none",
            sizeCls,
            shapeCls,
            hue(primaryLabel || name),
            ring && "ring-2 ring-brand-500 ring-offset-2 ring-offset-surface-0"
          )}
          aria-hidden="true"
        >
          {initials(primaryLabel || name)}
        </div>
      )}

      {/* Secondary organizational marker when in combined mode */}
      {isCombined && (
        <span
          className={cn(
            "absolute flex items-center justify-center font-bold text-white ring-2 ring-surface-0 shadow-xs overflow-hidden bg-surface-0",
            badgeSizes[size] || badgeSizes.md
          )}
          title={secondaryName ? `Business: ${secondaryName}` : "Business logo"}
          data-testid="avatar-business-badge"
        >
          {logoSrc ? (
            <img src={logoSrc} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className={cn("w-full h-full flex items-center justify-center", hue(secondaryName || "Biz"))}>
              {secondaryName ? initials(secondaryName).slice(0, 2) : <Building2 size={10} />}
            </span>
          )}
        </span>
      )}

      {/* Subtle indicator for pure business logo mode when explicitly set */}
      {effectiveMode === "business_logo" && logoSrc && (
        <span
          className="sr-only"
          data-testid="avatar-business-logo"
        >
          Business logo
        </span>
      )}

      {effectiveMode === "personal_photo" && (
        <span className="sr-only" data-testid="avatar-personal-photo">
          Personal photo
        </span>
      )}

      {online && !isCombined && (
        <span
          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-brand-500 ring-2 ring-surface-0"
          aria-label="Active"
        />
      )}
    </div>
  );
}
