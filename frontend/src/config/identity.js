import { regionFromPlace } from "@/config/regions";

/**
 * ONE IDENTITY, ONE LADDER.
 *
 * The old model made everybody a vendor at the door, then asked which shelf
 * they belonged to. That is wrong for this market: a person can sell tomatoes
 * this month, drive a boda next month and teach on weekends. The account is a
 * *person*; what they do is a set of capabilities they can change, and the only
 * thing that should not change is how much the network can trust what they say
 * about themselves.
 *
 * Three ideas, in order:
 *
 *   intent       why they joined. Not a category. `explore` is a complete,
 *                valid answer and must never be treated as an empty profile.
 *   capability   what they can do *today*. Stock is only one of four, and it is
 *                locked until the person says they sell goods.
 *   exposure     what they have made checkable — a region, a contact route, a
 *                completed trade, a verified licence, a verified institution.
 *
 * Rank is derived from exposure, never bought. A paid plan can buy seats,
 * storage or a faster review; it cannot buy a level.
 */

export const INTENT = {
  EXPLORE: "explore",
  OFFER: "offer",
  REPRESENT: "represent",
};

export const INTENTS = [
  {
    value: INTENT.EXPLORE,
    label: "Just looking",
    short: "Looking around",
    blurb: "Find people, services and prices. No page, no stock, no questions.",
    detail: "You can save things and come back. Nothing about you is public until you choose to publish a page.",
    icon: "compass",
  },
  {
    value: INTENT.OFFER,
    label: "I want to be found",
    short: "An open page",
    blurb: "A portfolio page for you, your trade or your practice.",
    detail: "You write what you do and where. Buyers can reach you without either side sharing a number first.",
    icon: "user",
  },
  {
    value: INTENT.REPRESENT,
    label: "I represent an institution",
    short: "An institution",
    blurb: "A school, clinic, SACCO, company, church or association.",
    detail: "You get a home office and a page for the institution. The badge waits until the institution confirms you.",
    icon: "building",
  },
];

export const CAPABILITIES = [
  {
    value: "sell_goods",
    label: "I sell goods",
    short: "Goods",
    blurb: "Produce, stock, materials or equipment for sale.",
    unlocks: "A shelf and a price list",
    route: "/stock",
    icon: "package",
  },
  {
    value: "offer_services",
    label: "I offer services",
    short: "Services",
    blurb: "A trade, a skill, a repair, a consultation or a delivery.",
    unlocks: "Bookings and a service list",
    route: "/create?type=service",
    icon: "wrench",
  },
  {
    value: "rent_assets",
    label: "I rent out equipment or space",
    short: "Rentals",
    blurb: "Tools, vehicles, cold storage, halls or land.",
    unlocks: "A rental calendar",
    route: "/tools",
    icon: "key",
  },
  {
    value: "licensed",
    label: "I hold a professional licence",
    short: "Licensed",
    blurb: "A regulated practice: medicine, law, accounting, engineering, pharmacy.",
    unlocks: "The licence badge, after a check",
    route: "/you/identity",
    icon: "badge",
  },
];

export const CAPABILITY_VALUES = CAPABILITIES.map((c) => c.value);

export const hasCapability = (identity, value) =>
  Array.isArray(identity?.capabilities) && identity.capabilities.includes(value);

export const canSellGoods = (identity) => hasCapability(identity, "sell_goods");

/** Whether a person is allowed to add stock at all. */
export function stockAllowed({ identity, vendor } = {}) {
  if (canSellGoods(identity)) return true;
  // A legacy account that already holds stock has, in effect, declared it.
  // We do not delete a shelf someone is already trading from.
  return Boolean(vendor?.has_stock || vendor?.total_stock_moved > 0);
}

/* ── Institutions and licences ───────────────────────────────────────────── */

export const CLAIM_STATUS = {
  NONE: "none",
  PENDING: "pending",
  VERIFIED: "verified",
  REJECTED: "rejected",
};

export const CLAIM_STATUS_LABEL = {
  none: "Not claimed",
  pending: "Waiting for the institution",
  verified: "Confirmed",
  rejected: "Not confirmed",
};

/**
 * The connection test. A person may *say* they represent a clinic; that is a
 * claim, not a fact. To turn it into a fact one of these has to happen:
 *
 *   domain_email  a code sent to an address on the institution's own domain
 *   call_back     a six-digit code read out to the institution's published line
 *   letter        a signed letter on letterhead, reviewed by a person
 *
 * Any of them is enough. The app records which one, so an operator reviewing a
 * claim knows what was actually checked rather than trusting a green tick.
 */
export const AFFILIATION_METHODS = [
  {
    value: "domain_email",
    label: "Code to the official email",
    blurb: "Sent to an address on the institution's own domain.",
    icon: "mail",
  },
  {
    value: "call_back",
    label: "Code to the official phone",
    blurb: "Read out to the number published on their site or letterhead.",
    icon: "phone",
  },
  {
    value: "letter",
    label: "Letter on letterhead",
    blurb: "Uploaded and reviewed by a person. Slowest, and the most conclusive.",
    icon: "file",
  },
];

export const INSTITUTION_KINDS = [
  "Company",
  "School or college",
  "Clinic or hospital",
  "SACCO or cooperative",
  "Association",
  "Faith organisation",
  "Government office",
  "Other",
];

/** Regulators named in the product. Adding one is a line here. */
export const REGULATORS = [
  { value: "KMPDC", label: "Kenya Medical Practitioners & Dentists Council", country: "KE" },
  { value: "NCK", label: "Nursing Council of Kenya", country: "KE" },
  { value: "PPB", label: "Pharmacy & Poisons Board", country: "KE" },
  { value: "LSK", label: "Law Society of Kenya", country: "KE" },
  { value: "ICPAK", label: "Institute of Certified Public Accountants of Kenya", country: "KE" },
  { value: "EBK", label: "Engineers Board of Kenya", country: "KE" },
  { value: "AAK", label: "Architects & Quantity Surveyors Board", country: "KE" },
  { value: "KRA", label: "Kenya Revenue Authority (tax agent)", country: "KE" },
  { value: "UMDPC", label: "Uganda Medical & Dental Practitioners Council", country: "UG" },
  { value: "ULS", label: "Uganda Law Society", country: "UG" },
  { value: "ICPAU", label: "Institute of Certified Public Accountants of Uganda", country: "UG" },
  { value: "EFDA", label: "Ethiopian Food & Drug Authority", country: "ET" },
  { value: "EPA", label: "Ethiopian Pharmacists Association", country: "ET" },
  { value: "RMDC", label: "Rwanda Medical & Dental Council", country: "RW" },
  { value: "OTHER", label: "Another regulator", country: "" },
];

/* ── Rank ────────────────────────────────────────────────────────────────── */

/**
 * Five levels. Each one is a *checkable fact*, not a score:
 *
 *   0  Visitor       no public page.
 *   1  Present       a page with a name, a region and a line about the work.
 *   2  Reachable     one contact route confirmed — a verified number or email.
 *   3  Trading       at least one completed movement recorded in the network.
 *   4  Trusted       five completed movements and a fulfilment rate of 90%+.
 *   5  Institution   a confirmed institution or a confirmed professional licence.
 *
 * The jump from 4 to 5 is not "more of the same". It is a different kind of
 * claim: somebody other than the account holder checked it. That is deliberately
 * the hardest rung and the only one a person cannot reach alone.
 */
export const RANKS = [
  {
    level: 0,
    key: "visitor",
    label: "Visitor",
    short: "Visitor",
    blurb: "Here to look around. Nothing is public.",
    tone: "quiet",
  },
  {
    level: 1,
    key: "present",
    label: "Present",
    short: "Present",
    blurb: "A page a buyer can read and place.",
    tone: "quiet",
  },
  {
    level: 2,
    key: "reachable",
    label: "Reachable",
    short: "Reachable",
    blurb: "One contact route is confirmed, so people can reach you.",
    tone: "brand",
  },
  {
    level: 3,
    key: "trading",
    label: "Trading",
    short: "Trading",
    blurb: "At least one completed movement is on record.",
    tone: "brand",
  },
  {
    level: 4,
    key: "trusted",
    label: "Trusted",
    short: "Trusted",
    blurb: "A fulfilment record people can see before they commit.",
    tone: "amber",
  },
  {
    level: 5,
    key: "institution",
    label: "Confirmed",
    short: "Confirmed",
    blurb: "An institution or a regulator has confirmed who you are.",
    tone: "amber",
  },
];

export const RANK_BY_LEVEL = Object.fromEntries(RANKS.map((rank) => [rank.level, rank]));

export const rankByKey = (key) => RANKS.find((rank) => rank.key === key) || RANKS[0];

const hasText = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * Everything a rank is built from, named once. The UI renders this list as the
 * ladder, so "how do I go up?" is answerable without reading documentation.
 */
export function exposure({ vendor, profile, identity } = {}) {
  const place = vendor?.physical_location || profile?.preferred_regions?.[0] || "";
  const region = regionFromPlace(place) || null;
  // A completed movement and a receipt-backed trade confirmed by both sides
  // are different records, but both are a trade the network watched happen.
  const completed =
    Number(vendor?.movements_completed || 0) + Number(vendor?.confirmed_trade_proofs || 0);
  const fulfilment = vendor?.fulfillment_rate;
  // A route is exposed when a buyer can actually use it: a number with direct
  // calls on, an address the member chose to publish, or a number our staff have
  // already checked. It does not require verification — rank measures exposure,
  // and the check is a separate, stronger claim (level 5).
  const contactExposed = Boolean(
    identity?.contact?.phone ||
      identity?.contact?.email ||
      vendor?.phone_verified_at ||
      (vendor?.phone && vendor?.allow_direct_calls),
  );
  const pageLive =
    vendor?.page_live !== false &&
    vendor?.intent !== INTENT.EXPLORE &&
    hasText(vendor?.business_name || vendor?.display_name) &&
    hasText(vendor?.vendor_handle);
  const described = hasText(vendor?.business_description) || hasText(profile?.about);
  const placed = Boolean(region || hasText(place));
  const institution = identity?.affiliation?.status === CLAIM_STATUS.VERIFIED;
  const licensed = identity?.licence?.status === CLAIM_STATUS.VERIFIED;

  return [
    {
      key: "page",
      label: "Publish a page",
      detail: "Your name, your region and one honest line about the work.",
      done: pageLive,
      step: 1,
      to: "/you/page",
    },
    {
      key: "described",
      label: "Say what you do",
      detail: "A description buyers can read before they call.",
      done: described,
      step: 1,
      to: "/you/page",
    },
    {
      key: "placed",
      label: "Set your region",
      detail: "So the people near you can find you first.",
      done: placed,
      step: 1,
      to: "/you/page",
    },
    {
      key: "contact",
      label: "Publish a contact route",
      detail: "A number or address buyers can use. You decide who sees it.",
      done: contactExposed,
      step: 2,
      to: "/you/identity",
    },
    {
      key: "trade",
      label: "Complete one trade",
      detail: "A movement, or a shop receipt the shop confirmed.",
      done: completed >= 1,
      step: 3,
      to: "/trades/proofs",
    },
    {
      key: "record",
      label: "Build a fulfilment record",
      detail: "Five completed trades with 90%+ delivered.",
      done: completed >= 5 && (fulfilment == null || fulfilment >= 0.9),
      step: 4,
      to: "/orders/records",
    },
    {
      key: "institution",
      label: "Get an institution confirmed",
      detail: "The institution answers a connection test.",
      done: institution,
      step: 5,
      to: "/you/identity",
    },
    {
      key: "licence",
      label: "Get a licence confirmed",
      detail: "A regulator's record checked by our staff.",
      done: licensed,
      step: 5,
      to: "/you/identity",
    },
  ];
}

/**
 * The rank, plus how far along the current rung a person is. The progress bar
 * only ever measures the *next* rung, because a bar that measures everything at
 * once tells a new member they are 4% of the way to being trusted, which is both
 * true and useless.
 */
export function rankFor({ vendor, profile, identity } = {}) {
  const items = exposure({ vendor, profile, identity });
  const done = (key) => Boolean(items.find((item) => item.key === key)?.done);

  let level = 0;
  if (done("page")) level = 1;
  if (level >= 1 && done("contact")) level = 2;
  if (level >= 2 && done("trade")) level = 3;
  if (level >= 3 && done("record")) level = 4;
  if (level >= 4 && (done("institution") || done("licence"))) level = 5;

  const rank = RANK_BY_LEVEL[level] || RANKS[0];
  const next = RANK_BY_LEVEL[Math.min(level + 1, 5)];

  // At the top rung there is no next rung, so there is nothing to offer. A
  // second claim (a licence alongside an institution) is optional polish, not a
  // task the product nags a confirmed member about.
  const forNext = level >= 5 ? [] : items.filter((item) => item.step === next.level);
  const complete = forNext.filter((item) => item.done).length;
  const progress = level >= 5 ? 100 : Math.round((complete / Math.max(forNext.length, 1)) * 100);

  return {
    ...rank,
    progress,
    next,
    nextItems: forNext.filter((item) => !item.done),
    items,
    // The one action the UI should offer. Never more than one.
    nextAction: forNext.find((item) => !item.done) || null,
  };
}

/**
 * A short, honest line for a portfolio page: "Licensed nurse · Kisumu, Kenya".
 * It favours the checkable claim over the self-described one.
 */
export function identityLine({ vendor, identity } = {}) {
  if (identity?.affiliation?.status === CLAIM_STATUS.VERIFIED) {
    return identity.affiliation.role
      ? `${identity.affiliation.role} · ${identity.affiliation.name}`
      : identity.affiliation.name;
  }
  if (identity?.licence?.status === CLAIM_STATUS.VERIFIED) {
    return `${identity.licence.title || "Licensed professional"} · ${identity.licence.regulator || ""}`.trim();
  }
  const discipline = (identity?.capabilities || [])
    .map((value) => CAPABILITIES.find((c) => c.value === value)?.short)
    .filter(Boolean);
  const place = vendor?.physical_location || vendor?.region || "";
  return [discipline.slice(0, 2).join(" & "), place].filter(Boolean).join(" · ");
}

/** The public address of a page. A handle is a URL, not an identity. */
export function pagePath(handle) {
  return handle ? `/p/${handle}` : "/you";
}

export function pageAddress(handle, origin) {
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${pagePath(handle)}`;
}
