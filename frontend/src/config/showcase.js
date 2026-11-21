import { Briefcase, Building2, Camera, CalendarDays, Package, Scissors, Sparkles, Users } from "lucide-react";

/**
 * THE SHOWCASE VOCABULARY — one set of words for every page's photographs.
 *
 * The gallery is only useful if the chips on one page mean the same thing as
 * the chips on the next. So the tags are a fixed list, mirrored in
 * `backend/app/services/gallery_showcase.py`; the server files an unknown tag
 * under `other` rather than inventing a chip nobody else has.
 *
 * `icon` is chosen so a chip reads at a glance in market daylight — a camera
 * for the work itself, a building for the premises, scissors for the trade.
 */
export const GALLERY_TAGS = [
  { value: "work", label: "Our work", icon: Sparkles },
  { value: "before-after", label: "Before & after", icon: Camera },
  { value: "premises", label: "Premises", icon: Building2 },
  { value: "team", label: "The team", icon: Users },
  { value: "product", label: "Products", icon: Package },
  { value: "event", label: "Events", icon: CalendarDays },
  { value: "other", label: "Other", icon: Briefcase },
];

export const GALLERY_TAG_VALUES = GALLERY_TAGS.map((tag) => tag.value);

export const DEFAULT_GALLERY_TAG = "work";

export function galleryTag(value) {
  return GALLERY_TAGS.find((tag) => tag.value === value) || GALLERY_TAGS[0];
}

/** Mirrors MAX_GALLERY_ITEMS in `app/services/gallery_showcase.py`. */
export const MAX_GALLERY_ITEMS = 30;

/**
 * The offer kinds a page can show, in the order a buyer reads them: what you
 * can hire someone to do, then what you can buy from them, then what you can
 * rent. The words match the desk's, because the same rows feed both.
 */
export const OFFER_KINDS = [
  { value: "service", label: "Services", icon: Scissors },
  { value: "goods", label: "Goods", icon: Package },
  { value: "tool", label: "For hire", icon: Briefcase },
];

export function offerKind(value) {
  return OFFER_KINDS.find((kind) => kind.value === value) || null;
}

/** "KSh 1,500 · per visit" — a price as a person writes it, or nothing. */
export function priceLine(item) {
  const price = item?.price;
  const unit = item?.price_unit;
  const mode = item?.price_mode;
  if (mode === "ask_me" || price === null || price === undefined) {
    return unit ? `Ask · ${unit}` : "Ask for a price";
  }
  const amount = `KSh ${Number(price).toLocaleString("en-KE")}`;
  return unit ? `${amount} · ${unit}` : amount;
}
