import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Package,
  PenLine,
  Wallet,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Truck,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import { ClaimBadge, RankChip } from "@/components/identity/Rank";
import { CAPABILITIES, CLAIM_STATUS, INTENTS, RANKS, canSellGoods, pagePath } from "@/config/identity";
import { pageAddress } from "@/lib/pageShare";
import { regionFromPlace } from "@/config/regions";
import { cn } from "@/lib/utils";

const CAPABILITY_META = {
  sell_goods: { shortTitle: "Sell goods", icon: Package, activeLabel: "Active" },
  offer_services: { shortTitle: "Offer services", icon: Briefcase, activeLabel: "Active" },
  rent_assets: { shortTitle: "Rent equipment", icon: Truck, activeLabel: "Active" },
  licensed: { shortTitle: "Professional licence", icon: Award, activeLabel: "Declared" },
};

/**
 * YOU — Professional identity & business control centre.
 *
 * Organised into six sections:
 *   01. Profile identity
 *   02. Your standing
 *   03. What I do
 *   04. Identity & verification
 *   05. Business workspace
 *   06. Your stock & settings
 */
export default function YouView({
  vendor,
  profile = {},
  identity = {},
  rank,
  institution = null,
  counts = {},
  onToggleCapability,
  onShare,
  onCopy,
  copied = false,
}) {
  const [levelsOpen, setLevelsOpen] = useState(false);

  const name = vendor?.business_name || vendor?.display_name || "Your page";
  const handle = vendor?.vendor_handle;
  const place = vendor?.physical_location || "";
  const region = regionFromPlace(place);
  const intent = INTENTS.find((item) => item.value === identity.intent);
  const affiliation = identity.affiliation;
  const licence = identity.licence;
  const selling = canSellGoods(identity);
  const selected = Array.isArray(identity.capabilities) ? identity.capabilities : [];

  const nextAction = rank?.nextItems?.[0] || null;
  const isVerified = Boolean(counts.verified || (rank?.level ?? 0) >= 5);
  const licenceDeclared = selected.includes("licensed");
  const licenceVerified = licence?.status === CLAIM_STATUS.VERIFIED;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-5 py-2 sm:px-6">
      {/* 01. Profile identity */}
      <header className="overflow-hidden rounded-[20px] border border-edge-1 bg-[#FFFFFF] dark:bg-surface-1">
        <div className="h-20 w-full bg-gradient-to-r from-[#103D32] via-[#176B53] to-[#1F8466]" />
        <div className="p-5">
          <div className="-mt-11 flex items-end justify-between gap-3">
            <Avatar
              name={name}
              src={profile.avatar_url || vendor?.avatar_url || vendor?.logo_url}
              size="xl"
              className="rounded-[18px] ring-4 ring-[#FFFFFF] dark:ring-surface-1"
            />
            <div className="mb-1 flex gap-1.5">
              <Button as={Link} to="/you/page" size="sm" variant="secondary" icon={PenLine}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" icon={Share2} onClick={onShare} aria-label="Share page" />
            </div>
          </div>

          <h1 className="mt-3 text-xl font-extrabold tracking-tight text-ink-1">{name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <RankChip rank={rank} />
            <span className="text-2xs text-ink-4">
              {region ? `${region.hub}, ${region.name}` : place || "Region not set"}
            </span>
          </div>

          {handle && (
            <div className="mt-3 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl bg-[#F5F4EF] px-3 py-1.5 text-micro text-ink-3 dark:bg-surface-0">
                {pageAddress(handle)}
              </code>
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1.5 text-micro font-bold text-ink-3 hover:bg-[#F5F4EF] hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-[#103D32] dark:hover:bg-surface-2"
              >
                {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <Link
                to={pagePath(handle)}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-[#E7F1EC] px-2.5 py-1.5 text-micro font-bold text-[#103D32] hover:bg-[#D5E8DF] dark:bg-brand-500/15 dark:text-brand-300"
              >
                Open
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
            </div>
          )}

          <dl className="mt-4 grid grid-cols-3 divide-x divide-edge-1 rounded-2xl border border-edge-1 bg-[#F5F4EF] py-3 dark:bg-surface-0">
            {[
              ["On the page", counts.offers ?? 0],
              ["Trades", counts.trades ?? 0],
              ["Confirmed", isVerified ? "Yes" : "No"],
            ].map(([label, value]) => (
              <div key={label} className="px-2 text-center">
                <dd className="text-sm font-extrabold tabular-nums text-ink-1">{value}</dd>
                <dt className="mt-0.5 text-micro text-ink-4">{label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </header>

      {/* 02. Your standing */}
      {rank && (
        <section
          className="rounded-[20px] border border-edge-1 bg-[#FFFFFF] p-5 dark:bg-surface-1"
          aria-labelledby="rank-heading"
          data-testid="rank-ladder"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-micro font-semibold uppercase tracking-wider text-ink-4">
                Your standing
              </p>
              <h2 id="rank-heading" className="mt-0.5 text-base font-extrabold tracking-tight text-ink-1">
                {rank.label} — Level {rank.level}/5
              </h2>
            </div>
            <span className="inline-flex items-center rounded-full bg-[#E7F1EC] px-2.5 py-1 text-micro font-bold text-[#103D32] dark:bg-brand-500/15 dark:text-brand-300">
              {rank.level} of 5
            </span>
          </div>

          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-[#F5F4EF] dark:bg-surface-3"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={rank.progress ?? 0}
            aria-label={rank.next ? `Progress to ${rank.next.label}` : "Maximum level reached"}
          >
            <div
              className="h-full rounded-full bg-[#176B53] transition-all duration-300"
              style={{ width: `${Math.max(8, rank.progress ?? 0)}%` }}
            />
          </div>

          {rank.level < 5 && rank.next ? (
            <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-[#F5F4EF] p-3.5 sm:flex-row sm:items-center sm:justify-between dark:bg-surface-0">
              <div className="min-w-0">
                <p className="text-2xs font-bold text-ink-1">
                  Next milestone: {rank.next.label}
                </p>
                <p className="mt-0.5 text-micro text-ink-3">
                  {nextAction ? nextAction.label : rank.next.blurb}
                </p>
              </div>
              {nextAction?.to && (
                <Link
                  to={nextAction.to}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[#103D32] px-3.5 py-2 text-micro font-bold text-white transition-colors hover:bg-[#176B53]"
                >
                  Complete action
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              )}
            </div>
          ) : (
            <p className="mt-3 text-2xs text-ink-3">{rank.blurb}</p>
          )}

          <button
            type="button"
            onClick={() => setLevelsOpen((v) => !v)}
            aria-expanded={levelsOpen}
            className="mt-3 inline-flex items-center gap-1 text-micro font-bold text-[#103D32] hover:underline dark:text-brand-400"
          >
            {levelsOpen ? "Hide the five levels" : "How the five levels work"}
            {levelsOpen ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
          </button>

          {levelsOpen && (
            <ol className="mt-3 space-y-2 border-t border-edge-1 pt-3">
              {RANKS.map((item) => {
                const reached = item.level <= rank.level;
                return (
                  <li key={item.key} className="flex items-start gap-2.5 text-2xs">
                    <span
                      className={cn(
                        "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-micro font-bold",
                        reached
                          ? "bg-[#103D32] text-white"
                          : "bg-[#F5F4EF] text-ink-4 dark:bg-surface-2",
                      )}
                    >
                      {item.level}
                    </span>
                    <div className="min-w-0">
                      <span className={cn("font-bold", reached ? "text-ink-1" : "text-ink-3")}>
                        {item.label}
                      </span>
                      <p className="text-micro text-ink-4">{item.blurb}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      {/* 03. What I do */}
      <section
        className="rounded-[20px] border border-edge-1 bg-[#FFFFFF] p-5 dark:bg-surface-1"
        aria-labelledby="capabilities-heading"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="capabilities-heading" className="text-base font-extrabold tracking-tight text-ink-1">
              What I do
            </h2>
            <p className="mt-0.5 text-2xs text-ink-3">
              Your professional activities — tap to switch on or off.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {CAPABILITIES.map((capability) => {
            const active = selected.includes(capability.value);
            const meta = CAPABILITY_META[capability.value] || {
              shortTitle: capability.short,
              icon: Package,
              activeLabel: "Active",
            };
            const Icon = meta.icon;

            return (
              <button
                key={capability.value}
                type="button"
                onClick={() => onToggleCapability?.(capability.value)}
                aria-pressed={active}
                className={cn(
                  "flex flex-col items-start justify-between gap-2.5 rounded-[18px] border p-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[#103D32]",
                  active
                    ? "border-[#176B53]/30 bg-[#E7F1EC] dark:border-brand-500/30 dark:bg-brand-500/10"
                    : "border-transparent bg-[#F5F4EF] hover:border-edge-2 dark:bg-surface-0",
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-xl",
                      active
                        ? "bg-[#103D32] text-white"
                        : "bg-[#FFFFFF] text-ink-3 dark:bg-surface-2",
                    )}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-micro font-bold",
                      active
                        ? "bg-[#FFFFFF] text-[#103D32] dark:bg-brand-500/20 dark:text-brand-300"
                        : "bg-[#FFFFFF]/70 text-ink-4 dark:bg-surface-2",
                    )}
                  >
                    {active ? meta.activeLabel : "Off"}
                  </span>
                </div>
                <span className="text-xs font-bold text-ink-1">{meta.shortTitle}</span>
              </button>
            );
          })}
        </div>

        {handle && (
          <Link
            to={`/p/${handle}?add=photos`}
            data-testid="you-add-work-photos"
            className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-edge-1 bg-[#F5F4EF] px-3.5 py-2.5 hover:border-edge-2 dark:bg-surface-0"
          >
            <span className="min-w-0">
              <span className="block text-xs font-bold text-ink-1">Add photos of your work</span>
              <span className="mt-0.5 block text-micro text-ink-3">
                Tag them <strong>Before &amp; after</strong> to show results.
              </span>
            </span>
            <ArrowUpRight size={14} className="shrink-0 text-ink-4" aria-hidden="true" />
          </Link>
        )}

        <Link to="/rate-card" className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-edge-1 bg-[#F5F4EF] px-3.5 py-2.5 hover:border-edge-2 dark:bg-surface-0">
          <span><span className="block text-xs font-bold text-ink-1">Service &amp; creator rate card</span><span className="mt-0.5 block text-micro text-ink-3">Share packages, prices and examples of your work.</span></span>
          <ArrowUpRight size={14} className="shrink-0 text-ink-4" aria-hidden="true" />
        </Link>

        {!selling && (
          <p className="mt-3 rounded-2xl bg-[#F5F4EF] px-3.5 py-2.5 text-2xs leading-relaxed text-ink-3 dark:bg-surface-0">
            Stock is off because &ldquo;Sell goods&rdquo; is not active. Existing buyer saves remain intact.
          </p>
        )}
      </section>

      {/* 04. Identity & verification */}
      <section
        className="rounded-[20px] border border-edge-1 bg-[#FFFFFF] p-5 dark:bg-surface-1"
        aria-labelledby="identity-heading"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="identity-heading" className="text-base font-extrabold tracking-tight text-ink-1">
              Identity &amp; verification
            </h2>
            <p className="mt-0.5 text-2xs text-ink-3">
              Declared credentials vs. what has been independently checked.
            </p>
          </div>
          <Link
            to="/you/identity"
            className="shrink-0 text-micro font-bold text-[#103D32] hover:underline dark:text-brand-400"
          >
            Manage
          </Link>
        </div>

        <ul className="mt-3 divide-y divide-edge-1">
          <li className="flex items-center gap-3 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#F5F4EF] text-ink-2 dark:bg-surface-2">
              <Sparkles size={14} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-2xs font-bold text-ink-1">Why you joined</span>
              <span className="block text-micro text-ink-4">{intent?.label || "Not chosen yet"}</span>
            </span>
            <Link to="/start" className="text-micro font-bold text-[#103D32] hover:underline dark:text-brand-400">
              Change
            </Link>
          </li>

          <li className="flex items-center gap-3 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#F5F4EF] text-ink-2 dark:bg-surface-2">
              <Building2 size={14} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-2xs font-bold text-ink-1">Institution</span>
              <span className="block truncate text-micro text-ink-4">
                {affiliation?.name || "Not claimed"}
                {affiliation?.role ? ` · ${affiliation.role}` : ""}
              </span>
            </span>
            <ClaimBadge claim={affiliation} />
          </li>

          <li className="flex items-center gap-3 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#F5F4EF] text-ink-2 dark:bg-surface-2">
              <ShieldCheck size={14} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-2xs font-bold text-ink-1">Professional licence</span>
              <span className="block truncate text-micro text-ink-4">
                {licence
                  ? `${licence.title || "Professional"} · ${licence.regulator || ""}`
                  : licenceDeclared
                    ? "Declared in What I do — submit details to verify"
                    : "Not declared"}
              </span>
            </span>
            {licenceVerified ? (
              <ClaimBadge claim={licence} />
            ) : licenceDeclared && !licence ? (
              <span className="rounded-full bg-[#E7F1EC] px-2.5 py-0.5 text-micro font-bold text-[#103D32] dark:bg-brand-500/15 dark:text-brand-300">
                Declared
              </span>
            ) : (
              <ClaimBadge claim={licence} />
            )}
          </li>

          <li className="flex items-center gap-3 py-3">
            <span
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-xl",
                isVerified
                  ? "bg-[#E7F1EC] text-[#103D32] dark:bg-brand-500/15 dark:text-brand-300"
                  : "bg-[#F5F4EF] text-ink-3 dark:bg-surface-2",
              )}
            >
              <Check size={14} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-2xs font-bold text-ink-1">Verification status</span>
              <span className="block text-micro text-ink-4">
                {isVerified ? "Identity and standing confirmed" : "Pending full verification"}
              </span>
            </span>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-micro font-bold",
                isVerified
                  ? "bg-[#E7F1EC] text-[#103D32] dark:bg-brand-500/15 dark:text-brand-300"
                  : "bg-[#F5F4EF] text-ink-4 dark:bg-surface-2",
              )}
            >
              {isVerified ? "Verified" : "Unverified"}
            </span>
          </li>
        </ul>
      </section>

      {/* 05. Business workspace */}
      <section
        className="rounded-[20px] border border-edge-1 bg-[#FFFFFF] p-5 dark:bg-surface-1"
        aria-labelledby="office-heading"
      >
        <p className="text-micro font-semibold uppercase tracking-wider text-ink-4">
          Business workspace
        </p>
        <div className="mt-3 rounded-2xl bg-[#F5F4EF] p-4 dark:bg-surface-0">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#E7F1EC] text-[#103D32] dark:bg-brand-500/15 dark:text-brand-300">
              <Building2 size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="office-heading" className="text-sm font-extrabold tracking-tight text-ink-1">
                Home office
              </h2>
              <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
                {institution
                  ? `${institution.name} — manage colleagues, roles and shared calendar.`
                  : "Manage colleagues, roles and shared calendar."}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <Link
              to="/office"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#103D32] px-3.5 py-2 text-micro font-bold text-white transition-colors hover:bg-[#176B53]"
            >
              {institution ? "Open home office" : "Create or join an office"}
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
            {!institution && (
              <Link
                to="/you/identity"
                className="inline-flex items-center rounded-xl px-3 py-2 text-micro font-bold text-[#103D32] hover:bg-[#E7F1EC] dark:text-brand-400"
              >
                Claim an institution
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* 06. Opportunities & earnings */}
      <section className="space-y-2.5" aria-label="Opportunities and earnings">
        <Link
          to="/you/earnings"
          className="flex items-center gap-3 rounded-[20px] border border-edge-1 bg-[#FFFFFF] p-5 transition-colors hover:border-edge-2 dark:bg-surface-1"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#E7F1EC] text-[#103D32] dark:bg-brand-500/15 dark:text-brand-300">
            <Wallet size={18} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ink-1">My opportunities &amp; earnings</span>
            <span className="mt-0.5 block text-2xs text-ink-4">
              Work completed, referrals verified, commissions pending · due · paid — and what cannot be counted yet.
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-ink-4" aria-hidden="true" />
        </Link>
      </section>

      {/* 06. Your stock & settings */}
      <section className="space-y-2.5" aria-label="Stock and settings">
        {selling && (
          <Link
            to="/stock"
            className="flex items-center gap-3 rounded-[20px] border border-edge-1 bg-[#FFFFFF] p-5 transition-colors hover:border-edge-2 dark:bg-surface-1"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#E7F1EC] text-[#103D32] dark:bg-brand-500/15 dark:text-brand-300">
              <Package size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-ink-1">Your stock</p>
                <span className="rounded-full bg-[#E7F1EC] px-2 py-0.5 text-micro font-bold text-[#103D32] dark:bg-brand-500/15 dark:text-brand-300">
                  {counts.offers ?? 0} published
                </span>
              </div>
              <p className="mt-0.5 text-2xs text-ink-4">
                Manage published listings and availability.
              </p>
            </div>
            <ChevronRight size={16} className="shrink-0 text-ink-4" aria-hidden="true" />
          </Link>
        )}

        <Link
          to="/more"
          className="flex items-center justify-between gap-3 rounded-[20px] border border-edge-1 bg-[#FFFFFF] p-5 transition-colors hover:border-edge-2 dark:bg-surface-1"
        >
          <span className="flex items-center gap-3 text-sm font-bold text-ink-1">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#F5F4EF] text-ink-3 dark:bg-surface-2">
              <Settings size={16} aria-hidden="true" />
            </span>
            <span>
              Settings &amp; records
              <span className="block text-2xs font-normal text-ink-4">
                Account preferences, records and tools
              </span>
            </span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-ink-4" aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
