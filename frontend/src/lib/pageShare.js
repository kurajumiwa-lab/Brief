import { BRAND } from "@/config/brand";
import { pagePath } from "@/config/identity";

/**
 * THE ADDRESS OF A PAGE, AND EVERY WAY TO PASS IT ON.
 *
 * A page is only useful if it can be sent: to a customer on WhatsApp, to a
 * colleague by email, or into a group where the next buyer is already reading.
 * The address should read like a place — `ogallo.vendorworld.ke` — rather than
 * an internal route (`/p/ogallo`), because that is the thing a person says out
 * loud and writes on a receipt.
 *
 * `VITE_PAGE_DOMAIN` turns on the subdomain form in a deployment that has a
 * wildcard DNS record. Until then every link still points at the working route,
 * so sharing never sends someone to a host that does not answer.
 */
export const pageDomain = () => import.meta.env.VITE_PAGE_DOMAIN || BRAND.domain || "";

/** The address to *show*: `ogallo.vendorworld.ke`. */
export function pageAddress(handle) {
  if (!handle) return "";
  const domain = pageDomain();
  return domain ? `${handle}.${domain}` : pagePath(handle);
}

/** The address to *copy or share*: always one that currently opens. */
export function pageUrl(handle) {
  if (!handle) return "";
  const domain = pageDomain();
  if (domain && typeof window !== "undefined" && window.location?.hostname?.endsWith(domain)) {
    return `${window.location.protocol}//${handle}.${domain}`;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${pagePath(handle)}`;
  }
  return pagePath(handle);
}

const enc = encodeURIComponent;
const digits = (phone = "") => String(phone).replace(/[^\d]/g, "");

/**
 * The share sheet, in the order people here actually use it: WhatsApp first,
 * then a copyable link, then the networks. `phone` is used only when the owner
 * publishes a number — a WhatsApp chat with the owner is a better landing than
 * a WhatsApp composer with no recipient.
 */
export function shareLinks({ handle, title = "", phone = "" }) {
  const url = pageUrl(handle);
  const text = title ? `${title} — ${url}` : url;
  const wa = digits(phone);

  return {
    whatsapp: wa
      ? `https://wa.me/${wa}?text=${enc(`Hello ${title || ""}, I found your page.`.trim())}`
      : `https://wa.me/?text=${enc(text)}`,
    telegram: `https://t.me/share/url?url=${enc(url)}&text=${enc(title)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
    x: `https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}`,
    email: `mailto:?subject=${enc(title || "A page worth a look")}&body=${enc(text)}`,
    url,
  };
}

export function telHref(phone) {
  const value = digits(phone);
  return value ? `tel:${value}` : "";
}

export function mailHref(email) {
  return email ? `mailto:${email}` : "";
}
