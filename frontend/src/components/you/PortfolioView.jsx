import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight, BadgeCheck, Building2, Check, Copy, MapPin, MessageCircle,
  PenLine, Phone, Share2, ShieldCheck,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import { ClaimBadge, RankChip } from "@/components/identity/Rank";
import { CAPABILITIES, identityLine, pagePath } from "@/config/identity";
import { regionFromPlace } from "@/config/regions";
import { cn } from "@/lib/utils";

/**
 * THE PAGE — a portfolio webpage, not a shop front with a handle on it.
 *
 * The old unit was `@handle`: a username you had to explain, attached to a
 * storefront that assumed stock. The new unit is a page at `/p/<handle>` with a
 * name, a place, a discipline, evidence of work and a way to make contact. Stock
 * is one block *inside* it, and only when the person sells goods.
 *
 * The handle survives as a URL and nothing else. It is not shown as an identity,
 * and it is not the thing a person is asked to remember.
 */
export default function PortfolioView({
  vendor,
  profile = {},
  identity = {},
  rank,
  isOwner = false,
  onShare,
}) {
  const [copied, setCopied] = useState(false);
  const name = vendor?.business_name || vendor?.display_name || "Unnamed page";
  const handle = vendor?.vendor_handle;
  const place = vendor?.physical_location || "";
  const region = regionFromPlace(place);
  const line = identityLine({ vendor, identity });
  const work = Array.isArray(profile.work_items) ? profile.work_items : [];
  const about = vendor?.business_description || profile.about || "";
  const capabilities = (identity.capabilities || [])
    .map((value) => CAPABILITIES.find((capability) => capability.value === value))
    .filter(Boolean);
  const affiliation = identity.affiliation;
  const licence = identity.licence;
  const verifiedInstitution = affiliation?.status === "verified";
  const verifiedLicence = licence?.status === "verified";
  const cover = profile.banner_url || vendor?.banner_url;

  async function copyAddress() {
    if (typeof window === "undefined" || !handle) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${pagePath(handle)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="mx-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-edge-1 bg-surface-1">
      {/* Cover: a photograph if the owner has one, otherwise a quiet band. */}
      <div className={cn("relative h-28 w-full overflow-hidden sm:h-36", !cover && "bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500")}>
        {cover && <img src={cover} alt="" className="h-full w-full object-cover" />}
        {isOwner && (
          <Link
            to="/you/page"
            className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-surface-0/90 px-2.5 py-1 text-micro font-bold text-ink-2 backdrop-blur-sm hover:bg-surface-0"
          >
            <PenLine size={11} aria-hidden="true" />
            Edit
          </Link>
        )}
      </div>

      <div className="px-5 pb-6 sm:px-6">
        <div className="-mt-10 flex items-end justify-between gap-3">
          <Avatar
            name={name}
            src={profile.avatar_url || vendor?.avatar_url || vendor?.logo_url}
            size="2xl"
            className="rounded-3xl ring-4 ring-surface-1"
          />
          {!isOwner && (
            <Button
              as={Link}
              to="/inbox"
              size="sm"
              variant="secondary"
              icon={MessageCircle}
              className="mb-1"
            >
              Message
            </Button>
          )}
        </div>

        <div className="mt-4">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-1">{name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {line && <p className="text-xs font-semibold text-ink-2">{line}</p>}
            <span className="inline-flex items-center gap-1 text-2xs text-ink-4">
              <MapPin size={11} aria-hidden="true" />
              {region ? `${region.hub}, ${region.name}` : place || "Region not set"}
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <RankChip rank={rank} />
            {verifiedInstitution && (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-2xs font-bold text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300">
                <Building2 size={12} aria-hidden="true" />
                {affiliation.name}
              </span>
            )}
            {verifiedLicence && (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-2xs font-bold text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300">
                <BadgeCheck size={12} aria-hidden="true" />
                {licence.title || "Licensed"} · {licence.regulator}
              </span>
            )}
            {vendor?.is_verified && !verifiedInstitution && !verifiedLicence && (
              <span className="inline-flex items-center gap-1 rounded-full border border-edge-1 bg-surface-0 px-2.5 py-1 text-2xs font-bold text-ink-2">
                <ShieldCheck size={12} aria-hidden="true" />
                Checked by Home Office
              </span>
            )}
            {(affiliation?.status === "pending" || licence?.status === "pending") && (
              <ClaimBadge claim={affiliation?.status === "pending" ? affiliation : licence} />
            )}
          </div>

          {handle && (
            <div className="mt-3 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-0 px-2.5 py-1.5 text-micro text-ink-3">
                {pagePath(handle)}
              </code>
              <button
                type="button"
                onClick={copyAddress}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-micro font-bold text-ink-3 hover:bg-surface-2 hover:text-ink-1 focus-visible:ring-2 focus-visible:ring-brand-500"
                aria-label="Copy page address"
              >
                {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>

        {about && (
          <section className="mt-6">
            <h2 className="eyebrow">About</h2>
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-2">{about}</p>
          </section>
        )}

        {capabilities.length > 0 && (
          <section className="mt-6">
            <h2 className="eyebrow">What I do</h2>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {capabilities.map((capability) => (
                <li
                  key={capability.value}
                  className="rounded-full border border-edge-1 bg-surface-0 px-3 py-1.5 text-2xs font-semibold text-ink-2"
                >
                  {capability.label.replace(/^I /, "")}
                </li>
              ))}
            </ul>
          </section>
        )}

        {work.length > 0 && (
          <section className="mt-6">
            <h2 className="eyebrow">Selected work</h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {work.slice(0, 4).map((item, index) => (
                <li
                  key={`${item.title}-${index}`}
                  className="rounded-2xl border border-edge-1 bg-surface-0 p-3"
                >
                  {item.image_url && (
                    <img
                      src={item.image_url}
                      alt=""
                      className="mb-2 aspect-[4/3] w-full rounded-xl object-cover"
                    />
                  )}
                  <p className="text-xs font-bold text-ink-1">{item.title}</p>
                  {item.summary && (
                    <p className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-ink-3">{item.summary}</p>
                  )}
                  {item.year && <p className="mt-1 text-micro text-ink-4">{item.year}</p>}
                </li>
              ))}
            </ul>
            {isOwner && (
              <Link
                to="/you/page"
                className="mt-2 inline-flex items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
              >
                Add or edit work
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
            )}
          </section>
        )}

        {/* Contact is a block, not a floating button, so the visitor can see
            exactly which route they are about to use. */}
        <section className="mt-6 rounded-2xl border border-edge-1 bg-surface-0 p-4">
          <h2 className="text-sm font-extrabold text-ink-1">Reach {isOwner ? "you" : name.split(" ")[0]}</h2>
          <p className="mt-1 text-2xs leading-relaxed text-ink-3">
            {vendor?.allow_direct_calls && vendor?.phone
              ? "The number below is published by the owner. Calls are welcome."
              : "Send a message here. Your number stays private until you choose to share it."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!isOwner && (
              <Button as={Link} to="/inbox" size="sm" icon={MessageCircle}>
                Send a message
              </Button>
            )}
            {vendor?.allow_direct_calls && vendor?.phone && (
              <Button as="a" href={`tel:${vendor.phone}`} size="sm" variant="secondary" icon={Phone}>
                {vendor.phone}
              </Button>
            )}
            {isOwner ? (
              <Button size="sm" variant="secondary" icon={Share2} onClick={onShare}>
                Share page
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={Share2} onClick={onShare}>
                Share
              </Button>
            )}
          </div>
        </section>

        <p className="mt-5 text-center text-micro text-ink-4">
          {verifiedInstitution || verifiedLicence
            ? "Confirmed by a third party. A confirmation is a record, not a guarantee of a trade."
            : "This page has not been confirmed by an institution or a regulator."}
        </p>
      </div>
    </article>
  );
}
