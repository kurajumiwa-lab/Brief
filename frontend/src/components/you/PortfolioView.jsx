import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight, BadgeCheck, Building2, Check, Copy, Facebook, Globe, Mail,
  MapPin, MessageCircle, PenLine, Phone, Send, Share2, ShieldCheck, Sparkles,
  Twitter,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Media from "@/components/ui/Media";
import Button from "@/components/ui/Button";
import GalleryBoard, { AddGalleryModal } from "@/components/you/GalleryBoard";
import PageOffers from "@/components/you/PageOffers";
import { ClaimBadge, RankChip } from "@/components/identity/Rank";
import { CAPABILITIES, identityLine } from "@/config/identity";
import { regionFromPlace, regionPath } from "@/config/regions";
import { apiError } from "@/lib/api";
import { mailHref, pageAddress, shareLinks, telHref } from "@/lib/pageShare";
import { receiptsAPI } from "@/lib/receiptsApi";
import { cn } from "@/lib/utils";

/**
 * THE PAGE — a small, professional landing page, not a shop front with a handle
 * on it.
 *
 * The old unit was `@handle`: a username you had to explain, attached to a
 * storefront that assumed stock. A page now has a name, a place, a discipline,
 * evidence of work, one clear way to make contact and an address worth sending.
 *
 * The order is the order a stranger reads in: who is this → what do they do →
 * can I see it → how do I reach them. Quick links are repeated in the sidebar
 * and the footer because the page is shared on WhatsApp, and a link that opens
 * halfway down a thread needs an obvious way back to the parts that matter.
 */
export default function PortfolioView({
  vendor,
  profile = {},
  identity = {},
  rank,
  isOwner = false,
  onShare,
  /** What this page offers — public rows from /api/offerings/of/:handle. */
  offers = [],
  /** The owner's save hook: (nextGalleryItems) => Promise. Visitors never get one. */
  onSaveGallery,
}) {
  const [copied, setCopied] = useState(false);
  const [gallery, setGallery] = useState(() => (Array.isArray(profile.gallery_items) ? profile.gallery_items : []));
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryError, setGalleryError] = useState("");
  const [addressCopied, setAddressCopied] = useState(false);
  const initialMerchant = Array.isArray(vendor?.claimed_merchants) && vendor.claimed_merchants.length > 0
    ? vendor.claimed_merchants[0]
    : null;
  const [claimedShop, setClaimedShop] = useState(initialMerchant);
  const [contestOpen, setContestOpen] = useState(false);
  const [contestReason, setContestReason] = useState("");
  const [contestPayload, setContestPayload] = useState("");
  const [contestBusy, setContestBusy] = useState(false);
  const [contestError, setContestError] = useState("");

  async function submitPageContest(event) {
    event.preventDefault();
    if (!claimedShop?.pin) return;
    setContestBusy(true);
    setContestError("");
    try {
      const { data: result } = await receiptsAPI.contestClaim(claimedShop.pin, {
        reason: contestReason.trim(),
        payload: contestPayload.trim(),
      });
      if (result?.merchant) setClaimedShop(result.merchant);
      setContestOpen(false);
      setContestReason("");
      setContestPayload("");
    } catch (err) {
      setContestError(apiError(err, "That contest could not be opened."));
    } finally {
      setContestBusy(false);
    }
  }

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

  // A contact route is shown only when there is one to use. The owner's own
  // identity record wins; a visitor gets only what the owner published.
  const phone =
    identity?.contact?.phone ||
    vendor?.contact_phone ||
    (vendor?.allow_direct_calls ? vendor?.phone : "") ||
    "";
  // Email is published only through the identity record. The account email is
  // private and must never be used as a contact route on a public page.
  const email = identity?.contact?.email || vendor?.contact_email || "";
  const links = shareLinks({ handle, title: name, phone });
  const year = (vendor?.created_at || vendor?.joined_at || "").slice(0, 4);

  // The hero's three numbers are the three things a stranger checks before
  // reading: what can I see, what can I buy, and how long have they been here.
  const stats = [
    { label: gallery.length ? "Photos" : "Selected work", value: gallery.length || work.length },
    { label: offers.length ? "Listings" : "Trades", value: offers.length || vendor?.movements_completed || 0 },
    { label: "Since", value: year || "—" },
  ];

  // Optimistic: the board changes under the owner's thumb immediately, and rolls
  // back with the reason if the server refuses. A visitor can never reach this —
  // `onSaveGallery` is only passed by the owner's page.
  async function persist(next) {
    const previous = gallery;
    setGallery(next);
    setGalleryError("");
    try {
      await onSaveGallery?.(next);
    } catch (error) {
      setGallery(previous);
      setGalleryError(apiError(error, "That change was not saved. Try again."));
    }
  }

  function addPhotos(items) {
    if (!items?.length) return;
    persist([...gallery, ...items].slice(0, 30));
  }

  function removePhoto(index) {
    persist(gallery.filter((_, i) => i !== index));
  }

  async function copy(kind) {
    try {
      await navigator.clipboard.writeText(links.url);
      if (kind === "address") {
        setAddressCopied(true);
        window.setTimeout(() => setAddressCopied(false), 1800);
      } else {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Clipboard blocked: the address is on screen and can be selected.
    }
  }

  return (
    <article className="mx-auto w-full max-w-4xl">
      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <header
        id="top"
        className="overflow-hidden rounded-3xl border border-edge-1 bg-surface-1 shadow-sm"
      >
        <div
          className={cn(
            "relative h-40 w-full overflow-hidden sm:h-56",
            !cover && "bg-gradient-to-br from-brand-800 via-brand-700 to-brand-500",
          )}
        >
          {cover && <img src={cover} alt="" className="h-full w-full object-cover" />}
          {!cover && (
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-35"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 20% 20%, rgba(255,255,255,.35), transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,.18), transparent 35%)",
              }}
            />
          )}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3 sm:p-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/25 px-2.5 py-1 text-micro font-bold text-white backdrop-blur-sm">
              <Globe size={11} aria-hidden="true" />
              Home Office page
            </span>
            <div className="flex items-center gap-1.5">
              {isOwner && (
                <Link
                  to="/you/page"
                  className="inline-flex items-center gap-1 rounded-full bg-surface-0/90 px-2.5 py-1 text-micro font-bold text-ink-2 backdrop-blur-sm hover:bg-surface-0"
                >
                  <PenLine size={11} aria-hidden="true" />
                  Edit
                </Link>
              )}
              <button
                type="button"
                onClick={onShare || (() => copy("share"))}
                className="inline-flex items-center gap-1 rounded-full bg-surface-0/90 px-2.5 py-1 text-micro font-bold text-ink-2 backdrop-blur-sm hover:bg-surface-0"
              >
                <Share2 size={11} aria-hidden="true" />
                Share
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 sm:px-8 sm:pb-7">
          <div className="-mt-12 flex items-end justify-between gap-3 sm:-mt-14">
            <Avatar
              name={name}
              src={profile.avatar_url || vendor?.avatar_url || vendor?.logo_url}
              size="2xl"
              className="rounded-3xl ring-4 ring-surface-1"
            />
            <div className="mb-1 flex flex-wrap items-center justify-end gap-1.5">
              <RankChip rank={rank} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight text-ink-1 sm:text-3xl">
                {name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                {line && <p className="text-sm font-semibold text-ink-2">{line}</p>}
                <span className="inline-flex items-center gap-1 text-2xs text-ink-4">
                  <MapPin size={11} aria-hidden="true" />
                  {region ? `${region.hub}, ${region.name}` : place || "Region not set"}
                </span>
              </div>
            </div>

            <dl className="flex shrink-0 divide-x divide-edge-1 rounded-2xl border border-edge-1 bg-surface-0">
              {stats.map((stat) => (
                <div key={stat.label} className="px-3 py-2 text-center sm:px-4">
                  <dd className="digital text-base font-extrabold text-ink-1">{stat.value}</dd>
                  <dt className="text-micro text-ink-4">{stat.label}</dt>
                </div>
              ))}
            </dl>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
            {region && (
              <Link
                to={regionPath(region)}
                className="inline-flex items-center gap-1 rounded-full border border-edge-1 bg-surface-0 px-2.5 py-1 text-2xs font-semibold text-ink-3 hover:text-ink-1"
              >
                {region.name}
                <ArrowUpRight size={11} aria-hidden="true" />
              </Link>
            )}
          </div>

          {/* ── the one row of actions ─────────────────────────────────── */}
          <div className="mt-4 flex flex-wrap gap-2" data-testid="page-actions">
            {phone && (
              <a
                href={`https://wa.me/${String(phone).replace(/[^\d]/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#25D366] px-4 text-xs font-bold text-white transition-opacity hover:opacity-90"
              >
                <MessageCircle size={15} aria-hidden="true" />
                WhatsApp
              </a>
            )}
            {phone && (
              <a
                href={telHref(phone)}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-edge-2 bg-surface-1 px-4 text-xs font-bold text-ink-2 hover:border-edge-3 hover:text-ink-1"
              >
                <Phone size={15} aria-hidden="true" />
                Call
              </a>
            )}
            {email && (
              <a
                href={mailHref(email)}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-edge-2 bg-surface-1 px-4 text-xs font-bold text-ink-2 hover:border-edge-3 hover:text-ink-1"
              >
                <Mail size={15} aria-hidden="true" />
                Email
              </a>
            )}
            {!isOwner && (
              <Button as={Link} to="/inbox" size="sm" variant={phone ? "secondary" : "primary"} icon={MessageCircle} className="h-10">
                Message
              </Button>
            )}
            {!phone && !email && <span className="self-center text-micro text-ink-4">Contact routes are not published yet.</span>}
          </div>

          {/* ── the first four photos, as a strip ───────────────────────
              A portfolio is looked at before it is read. The strip is the
              top of the board, one tap from the full gallery, and it is
              absent — not empty — when there are no photos yet. */}
          {gallery.length > 0 && (
            <div className="mt-4 -mx-1" data-testid="page-hero-strip">
              <div className="flex items-center justify-between gap-2 px-1">
                <p className="text-micro font-bold uppercase tracking-[0.12em] text-ink-4">
                  {gallery.length} photo{gallery.length === 1 ? "" : "s"}
                </p>
                <a href="#gallery" className="inline-flex items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400">
                  See the board
                  <ArrowUpRight size={12} aria-hidden="true" />
                </a>
              </div>
              <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                {gallery.slice(0, 6).map((photo, index) => (
                  <button
                    key={`${photo.image_url}-${index}`}
                    type="button"
                    onClick={() => document.getElementById("gallery")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-edge-1 bg-surface-2 sm:h-28 sm:w-28"
                    aria-label={photo.caption || `Photo ${index + 1}`}
                  >
                    <Media src={photo.image_url} alt="" className="h-full w-full object-cover" />
                    {index === 5 && gallery.length > 6 && (
                      <span className="absolute inset-0 grid place-items-center bg-ink-1/60 text-xs font-extrabold text-white">
                        +{gallery.length - 6}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── the address, as a place not a route ────────────────────── */}
          {handle && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-edge-1 bg-surface-0 px-3 py-2">
              <Globe size={14} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
              <code className="min-w-0 flex-1 truncate text-micro font-semibold text-ink-2" data-testid="page-address">
                {pageAddress(handle)}
              </code>
              <button
                type="button"
                onClick={() => copy("address")}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-micro font-bold text-ink-3 hover:bg-surface-2 hover:text-ink-1"
                aria-label="Copy page address"
              >
                {addressCopied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                {addressCopied ? "Copied" : "Copy"}
              </button>
            </div>
          )}

          {claimedShop && (
            <div
              data-testid="page-claimed-shop"
              className="mt-4 rounded-2xl border border-edge-1 bg-surface-0 px-3.5 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-ink-1">
                    {claimedShop.name}
                    {claimedShop.pin ? <span className="ml-1.5 font-mono text-micro font-normal text-ink-4">· {claimedShop.pin}</span> : null}
                  </p>
                  <p className="mt-0.5 text-micro text-ink-3" data-testid="page-claimed-shop-status">
                    {claimedShop.claim_status_label || (
                      claimedShop.contested
                        ? "Ownership contested"
                        : claimedShop.probationary
                          ? "Probationary owner"
                          : claimedShop.verified
                            ? "Verified owner"
                            : "Claim under review"
                    )}
                  </p>
                </div>
                {!isOwner && !claimedShop.contested && claimedShop.pin && (
                  <button
                    type="button"
                    data-testid="page-contest-open"
                    onClick={() => setContestOpen((value) => !value)}
                    className="rounded-full border border-edge-2 bg-surface-1 px-2.5 py-1 text-micro font-bold text-ink-3 hover:border-edge-3 hover:text-ink-1"
                  >
                    Contest this claim
                  </button>
                )}
              </div>

              {contestOpen && !isOwner && !claimedShop.contested && (
                <form
                  onSubmit={submitPageContest}
                  data-testid="page-contest-form"
                  className="mt-3 space-y-2 border-t border-edge-1 pt-3"
                >
                  <input
                    value={contestReason}
                    onChange={(event) => setContestReason(event.target.value)}
                    placeholder="Why is this your shop? (8+ characters)"
                    className="h-9 w-full rounded-xl border border-edge-2 bg-surface-1 px-3 text-xs text-ink-1"
                    data-testid="page-contest-reason"
                  />
                  <input
                    value={contestPayload}
                    onChange={(event) => setContestPayload(event.target.value)}
                    placeholder="Optional receipt QR or eTIMS link from this shop"
                    className="h-9 w-full rounded-xl border border-edge-2 bg-surface-1 px-3 text-xs text-ink-1"
                    data-testid="page-contest-payload"
                  />
                  {contestError && (
                    <p className="text-micro text-red-600 dark:text-red-400" data-testid="page-contest-error">
                      {contestError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      loading={contestBusy}
                      disabled={contestReason.trim().length < 8 && !contestPayload.trim()}
                      data-testid="page-contest-submit"
                    >
                      Freeze and review
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setContestOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── the page's own navigation ───────────────────────────────────── */}
      <nav aria-label="Page sections" className="mt-3 flex gap-1 overflow-x-auto no-scrollbar">
        {[
          ["#top", "Home"],
          ["#gallery", "Portfolio"],
          ["#about", "About"],
          ["#offers", "Offers"],
          ["#contact", "Contact"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="shrink-0 rounded-full border border-edge-1 bg-surface-0 px-3 py-1.5 text-micro font-bold text-ink-3 hover:border-edge-2 hover:text-ink-1"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-4">
          {galleryError && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-2xs font-semibold text-danger">
              {galleryError}
            </p>
          )}

          <GalleryBoard
            items={gallery}
            own={isOwner && Boolean(onSaveGallery)}
            onAdd={() => setGalleryOpen(true)}
            onRemove={removePhoto}
          />

          {about && (
            <section id="about" className="rounded-2xl border border-edge-1 bg-surface-1 p-5">
              <h2 className="eyebrow">About</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">{about}</p>
              {capabilities.length > 0 && (
                <>
                  <h3 className="mt-4 text-micro font-bold uppercase tracking-[0.12em] text-ink-4">What I do</h3>
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
                </>
              )}
            </section>
          )}

          {work.length > 0 && (
            <section id="work" data-testid="selected-work" className="rounded-2xl border border-edge-1 bg-surface-1 p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="eyebrow">Selected work</h2>
                {isOwner && (
                  <Link
                    to="/you/page"
                    className="inline-flex items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
                  >
                    Add or edit work
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </Link>
                )}
              </div>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {work.slice(0, 4).map((item, index) => (
                  <li
                    key={`${item.title}-${index}`}
                    className={cn(
                      "overflow-hidden rounded-2xl border border-edge-1 bg-surface-0",
                      index === 0 && "sm:col-span-2",
                    )}
                  >
                    {item.image_url && (
                      <img
                        src={item.image_url}
                        alt=""
                        className={cn("w-full object-cover", index === 0 ? "aspect-[16/9]" : "aspect-[4/3]")}
                      />
                    )}
                    <div className="p-3.5">
                      <p className="text-sm font-bold text-ink-1">{item.title}</p>
                      {item.summary && (
                        <p className="mt-1 text-2xs leading-relaxed text-ink-3">{item.summary}</p>
                      )}
                      <p className="mt-1.5 text-micro text-ink-4">
                        {[item.discipline, item.year].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <PageOffers
            items={offers}
            own={isOwner}
            createHref="/you/page"
          />

          <section
            id="around"
            data-testid="page-region-door"
            className="rounded-2xl border border-edge-1 bg-surface-1 p-4"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                <Sparkles size={16} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-extrabold text-ink-1">
                  {region ? `Around ${region.name}` : "Offers and needs nearby"}
                </h2>
                <p className="mt-1 text-2xs leading-relaxed text-ink-3">
                  {region
                    ? `What other people are offering, asking for and scheduling across ${region.hub} and the wider region.`
                    : "What other people are offering, asking for and scheduling in this network."}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button as={Link} to={region ? `${regionPath(region)}?tab=offers` : "/regions"} size="sm" variant="secondary">
                    See offers around here
                  </Button>
                  <Button as={Link} to="/regions" size="sm" variant="ghost">
                    Browse regions
                  </Button>
                </div>
              </div>
            </div>
          </section>        </div>

        <aside className="space-y-3">
          <section id="contact" className="rounded-2xl border border-edge-1 bg-surface-1 p-4">
            <h2 className="text-sm font-extrabold text-ink-1">
              Reach {isOwner ? "you" : name.split(" ")[0]}
            </h2>
            <p className="mt-1 text-2xs leading-relaxed text-ink-3">
              {phone
                ? "The number below is published by the owner. Messages and calls are welcome."
                : "Send a message here. Your number stays private until you choose to share it."}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {phone && (
                <a
                  href={telHref(phone)}
                  className="inline-flex items-center gap-2 rounded-xl border border-edge-1 bg-surface-0 px-3 py-2 text-xs font-semibold text-ink-2 hover:border-edge-2"
                >
                  <Phone size={14} className="text-brand-600 dark:text-brand-300" aria-hidden="true" />
                  {phone}
                </a>
              )}
              {email && (
                <a
                  href={mailHref(email)}
                  className="inline-flex items-center gap-2 rounded-xl border border-edge-1 bg-surface-0 px-3 py-2 text-xs font-semibold text-ink-2 hover:border-edge-2"
                >
                  <Mail size={14} className="text-brand-600 dark:text-brand-300" aria-hidden="true" />
                  <span className="truncate">{email}</span>
                </a>
              )}
              {!isOwner && (
                <Button as={Link} to="/inbox" size="sm" variant="secondary" icon={MessageCircle}>
                  Send a message
                </Button>
              )}
              {isOwner && (
                <Button as={Link} to="/inbox" size="sm" variant="secondary" icon={MessageCircle}>
                  Open your inbox
                </Button>
              )}
            </div>
          </section>

          <section data-testid="quick-links" className="rounded-2xl border border-edge-1 bg-surface-1 p-4">
            <h2 className="eyebrow">Quick links</h2>
            <ul className="mt-2 divide-y divide-edge-1">
              {[
                ["#top", "Home"],
                ["#gallery", "Portfolio"],
                ["#about", "About"],
                ["#offers", "Offers"],
                ["#contact", "Contact"],
              ].map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="flex items-center justify-between gap-2 py-2 text-xs font-semibold text-ink-2 hover:text-brand-700 dark:hover:text-brand-300">
                    {label}
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </a>
                </li>
              ))}
              {region && (
                <li>
                  <Link to={regionPath(region)} className="flex items-center justify-between gap-2 py-2 text-xs font-semibold text-ink-2 hover:text-brand-700 dark:hover:text-brand-300">
                    {region.name}
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </Link>
                </li>
              )}
              <li>
                <Link to="/regions/all" className="flex items-center justify-between gap-2 py-2 text-xs font-semibold text-ink-2 hover:text-brand-700 dark:hover:text-brand-300">
                  All regions
                  <ArrowUpRight size={12} aria-hidden="true" />
                </Link>
              </li>
            </ul>
          </section>

          <section data-testid="page-share" className="rounded-2xl border border-edge-1 bg-surface-1 p-4">
            <h2 className="eyebrow">Share this page</h2>
            <p className="mt-1 text-2xs leading-relaxed text-ink-3">
              Send it to a customer, a group, or a colleague who needs the details.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <ShareTarget href={links.whatsapp} label="WhatsApp" icon={MessageCircle} tone="whatsapp" />
              <ShareTarget href={links.telegram} label="Telegram" icon={Send} />
              <ShareTarget href={links.facebook} label="Facebook" icon={Facebook} />
              <ShareTarget href={links.x} label="X" icon={Twitter} />
              <ShareTarget href={links.email} label="Email" icon={Mail} />
              <button
                type="button"
                onClick={() => copy("share")}
                className="inline-flex flex-col items-center justify-center gap-1 rounded-xl border border-edge-1 bg-surface-0 px-1.5 py-2 text-micro font-semibold text-ink-3 hover:border-edge-2 hover:text-ink-1"
              >
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </section>
        </aside>
      </div>

      {/* ── a footer, because this is a page and not a card ─────────────── */}
      <footer className="mt-4 rounded-3xl bg-ink-1 px-5 py-6 text-surface-0 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="text-sm font-extrabold tracking-tight">{name}</p>
            <p className="mt-1 text-2xs text-surface-0/60">
              {[line, region ? `${region.hub}, ${region.name}` : place].filter(Boolean).join(" · ") || "A page on Home Office"}
            </p>
            {handle && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 font-mono text-micro text-surface-0/80">
                <Globe size={11} aria-hidden="true" />
                {pageAddress(handle)}
              </p>
            )}
          </div>
          <nav aria-label="Quick links" className="min-w-0">
            <p className="text-micro font-bold uppercase tracking-[0.12em] text-surface-0/50">Quick links</p>
            <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
              <li><a href="#top" className="text-2xs text-surface-0/80 hover:text-surface-0">Home</a></li>
              <li><a href="#gallery" className="text-2xs text-surface-0/80 hover:text-surface-0">Portfolio</a></li>
              <li><a href="#about" className="text-2xs text-surface-0/80 hover:text-surface-0">About</a></li>
              <li><a href="#offers" className="text-2xs text-surface-0/80 hover:text-surface-0">Offers</a></li>
              <li><a href="#contact" className="text-2xs text-surface-0/80 hover:text-surface-0">Contact</a></li>
              <li><Link to="/regions/all" className="text-2xs text-surface-0/80 hover:text-surface-0">All regions</Link></li>
            </ul>
          </nav>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <p className="text-micro text-surface-0/55">
            © {new Date().getFullYear()} {name}. Powered by Home Office.
          </p>
          <Link to="/auth?mode=register" className="text-micro font-bold text-surface-0/80 hover:text-surface-0">
            Build your own page
          </Link>
        </div>
      </footer>

      {isOwner && onSaveGallery && (
        <AddGalleryModal
          open={galleryOpen}
          onClose={() => setGalleryOpen(false)}
          onAdd={addPhotos}
          remaining={30 - gallery.length}
        />
      )}

      <p className="mt-3 text-center text-micro text-ink-4">
        {verifiedInstitution || verifiedLicence
          ? "Confirmed by a third party. A confirmation is a record, not a guarantee of a trade."
          : "This page has not been confirmed by an institution or a regulator."}
      </p>
    </article>
  );
}

function ShareTarget({ href, label, icon: Icon, tone }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-micro font-semibold transition-colors",
        tone === "whatsapp"
          ? "border-[#25D366]/40 bg-[#25D366]/10 text-[#128C4A] hover:bg-[#25D366]/15 dark:text-[#5BE39A]"
          : "border-edge-1 bg-surface-0 text-ink-3 hover:border-edge-2 hover:text-ink-1",
      )}
    >
      <Icon size={14} aria-hidden="true" />
      {label}
    </a>
  );
}
