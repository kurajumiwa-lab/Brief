import { Link } from "react-router-dom";
import {
  ArrowUpRight, Building2, Check, ChevronRight, Copy, Package, PenLine,
  Settings, Share2, ShieldCheck, Sparkles,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import { ClaimBadge, RankChip, RankLadder } from "@/components/identity/Rank";
import { CAPABILITIES, INTENTS, canSellGoods, pagePath } from "@/config/identity";
import { pageAddress } from "@/lib/pageShare";
import { regionFromPlace } from "@/config/regions";
import { cn } from "@/lib/utils";

/**
 * YOU — the page, the ladder and the identity, in that order.
 *
 * This replaces a 798-line "My World" that rendered eleven quick actions, four
 * destination groups, the workspace tools and a settings list, all at once. The
 * owner does not need a second navigation here: the five tabs are above, the
 * drawer is one tap away, and the only decisions on this screen are
 *
 *   what my page says        → open / edit
 *   what I am able to do     → the capability switches
 *   what has been confirmed  → the identity panel
 *   where I belong           → the home office
 *
 * A capability is a switch, not a category. Turning goods off hides the shelf;
 * it does not delete a listing a buyer may already have saved.
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
  const name = vendor?.business_name || vendor?.display_name || "Your page";
  const handle = vendor?.vendor_handle;
  const place = vendor?.physical_location || "";
  const region = regionFromPlace(place);
  const intent = INTENTS.find((item) => item.value === identity.intent);
  const affiliation = identity.affiliation;
  const licence = identity.licence;
  const selling = canSellGoods(identity);
  const selected = Array.isArray(identity.capabilities) ? identity.capabilities : [];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      {/* Identity header */}
      <header className="overflow-hidden rounded-2xl border border-edge-1 bg-surface-1">
        <div className="h-20 w-full bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500" />
        <div className="px-5 pb-4 sm:px-6">
          <div className="-mt-8 flex items-end justify-between gap-3">
            <Avatar
              name={name}
              src={profile.avatar_url || vendor?.avatar_url || vendor?.logo_url}
              size="xl"
              className="rounded-2xl ring-4 ring-surface-1"
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
            <div className="mt-2.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-0 px-2.5 py-1.5 text-micro text-ink-3">
                {pageAddress(handle)}
              </code>
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-micro font-bold text-ink-3 hover:bg-surface-2 hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <Link
                to={pagePath(handle)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-micro font-bold text-brand-700 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
              >
                Open
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
            </div>
          )}

          <dl className="mt-4 grid grid-cols-3 divide-x divide-edge-1 rounded-xl border border-edge-1 bg-surface-0 py-2.5">
            {[
              ["On the page", counts.offers ?? 0],
              ["Trades", counts.trades ?? 0],
              ["Confirmed", counts.verified ? "Yes" : "No"],
            ].map(([label, value]) => (
              <div key={label} className="px-2 text-center">
                <dd className="text-sm font-extrabold tabular-nums text-ink-1">{value}</dd>
                <dt className="mt-0.5 text-micro text-ink-4">{label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <RankLadder rank={rank} showAll compact />

      {/* Capabilities */}
      <section className="rounded-2xl border border-edge-1 bg-surface-1 p-4 sm:p-5" aria-labelledby="capabilities-heading">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="capabilities-heading" className="text-base font-extrabold tracking-tight text-ink-1">
              What I do
            </h2>
            <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
              Switch these on when they are true — they become the &ldquo;What I do&rdquo; line on
              your page. You can change them any month; the network is built for that.
            </p>
          </div>
        </div>
        {handle && (
          <Link
            to={`/p/${handle}?add=photos`}
            data-testid="you-add-work-photos"
            className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-edge-1 bg-surface-0 px-3 py-2.5 hover:border-edge-2"
          >
            <span className="min-w-0">
              <span className="block text-xs font-bold text-ink-1">Add photos of your work</span>
              <span className="mt-0.5 block text-2xs leading-snug text-ink-3">
                Opens your page at the photo sheet. Tag them <strong>Before &amp; after</strong>
                &nbsp;to show a result, not just a product.
              </span>
            </span>
            <ArrowUpRight size={14} className="shrink-0 text-ink-4" aria-hidden="true" />
          </Link>
        )}

        <ul className="mt-3 space-y-1">
          {CAPABILITIES.map((capability) => {
            const active = selected.includes(capability.value);
            return (
              <li key={capability.value}>
                <button
                  type="button"
                  onClick={() => onToggleCapability?.(capability.value)}
                  aria-pressed={active}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-brand-500",
                    active
                      ? "border-brand-200 bg-brand-50/60 dark:border-brand-500/30 dark:bg-brand-500/10"
                      : "border-transparent hover:bg-surface-2",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                      active
                        ? "border-brand-700 bg-brand-700 text-white"
                        : "border-edge-2 bg-surface-0 text-transparent",
                    )}
                    aria-hidden="true"
                  >
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-ink-1">{capability.label}</span>
                    <span className="block text-2xs leading-snug text-ink-3">{capability.blurb}</span>
                    {active && (
                      <span className="mt-0.5 block text-micro font-medium text-brand-700 dark:text-brand-400">
                        Unlocks: {capability.unlocks}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {!selling && (
          <p className="mt-2 rounded-xl bg-surface-0 px-3 py-2 text-2xs leading-relaxed text-ink-3">
            Stock is off because you have not said you sell goods. Nothing is
            hidden from a buyer who already saved a listing; the shelf simply
            stops being offered to you as a place to add more.
          </p>
        )}
      </section>

      {/* Identity and claims */}
      <section className="rounded-2xl border border-edge-1 bg-surface-1 p-4 sm:p-5" aria-labelledby="identity-heading">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="identity-heading" className="text-base font-extrabold tracking-tight text-ink-1">
              Identity
            </h2>
            <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
              What has been checked, and what is still waiting.
            </p>
          </div>
          <Link
            to="/you/identity"
            className="shrink-0 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
          >
            Manage
          </Link>
        </div>

        <ul className="mt-3 divide-y divide-edge-1">
          <li className="flex items-center gap-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">
              <Sparkles size={14} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-2xs font-bold text-ink-1">Why you joined</span>
              <span className="block text-micro text-ink-4">{intent?.label || "Not chosen yet"}</span>
            </span>
            <Link to="/start" className="text-micro font-bold text-brand-700 hover:underline dark:text-brand-400">
              Change
            </Link>
          </li>

          <li className="flex items-center gap-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">
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

          <li className="flex items-center gap-3 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">
              <ShieldCheck size={14} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-2xs font-bold text-ink-1">Licence</span>
              <span className="block truncate text-micro text-ink-4">
                {licence ? `${licence.title || "Professional"} · ${licence.regulator || ""}` : "Not claimed"}
              </span>
            </span>
            <ClaimBadge claim={licence} />
          </li>
        </ul>
      </section>

      {/* Home office */}
      <section className="rounded-2xl border border-edge-1 bg-surface-1 p-4 sm:p-5" aria-labelledby="office-heading">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <Building2 size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="office-heading" className="text-base font-extrabold tracking-tight text-ink-1">
              Home office
            </h2>
            <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
              {institution
                ? `${institution.name} — the people you work with, their roles and the shared calendar.`
                : "For an institution or a team: one place for the people, their roles and a shared calendar."}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button as={Link} to="/office" size="sm" variant={institution ? "primary" : "secondary"}>
            {institution ? "Open home office" : "Create or join an office"}
          </Button>
          {!institution && (
            <Button as={Link} to="/you/identity" size="sm" variant="ghost">
              Claim an institution
            </Button>
          )}
        </div>
      </section>

      {/* Stock: only when it is a real part of this person's work */}
      {selling && (
        <section className="flex items-center gap-3 rounded-2xl border border-edge-1 bg-surface-1 px-4 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2">
            <Package size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-1">Your stock</p>
            <p className="text-2xs text-ink-4">Only published items a buyer can actually get are shown.</p>
          </div>
          <Link
            to="/stock"
            className="inline-flex shrink-0 items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
          >
            Manage
            <ChevronRight size={13} aria-hidden="true" />
          </Link>
        </section>
      )}

      <Link
        to="/more"
        className="flex items-center justify-between gap-3 rounded-2xl border border-edge-1 bg-surface-1 px-4 py-3.5 hover:border-edge-2"
      >
        <span className="flex items-center gap-2.5 text-xs font-bold text-ink-1">
          <Settings size={15} className="text-ink-3" aria-hidden="true" />
          Settings &amp; records
          <span className="hidden text-micro font-medium text-ink-4 sm:inline">
            — the long list, also on Home as &ldquo;The counter&rdquo;
          </span>
        </span>
        <ChevronRight size={15} className="text-ink-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
