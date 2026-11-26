/**
 * IS THIS BUSINESS REACHABLE?
 *
 * The drawer's identity header carries one small indicator, and the only honest
 * thing it can say is whether somebody could actually reach this business right
 * now. That is two facts, not a mood and not a score:
 *
 *   the page      published: a name and a handle a stranger can open
 *   the route     a phone, address or email a buyer can actually use
 *
 * Both are already computed by `exposure()` in `@/config/identity` — the same
 * list the rank ladder renders. This module does not define them a second time;
 * a second definition would drift, and then the drawer would disagree with the
 * Profile page about whether the same business is findable.
 *
 * There are four states and no more:
 *
 *   reachable    live page + a published route: a stranger can find and reply
 *   one-way      one of the two is missing, and the label says which
 *   unpublished  neither is true — the business has not gone public yet
 *   unknown      not signed in, so there is nothing to judge
 *
 * "Unknown" is deliberately its own state. Painting a grey dot as "offline"
 * because a field was missing is the same class of lie as inventing a
 * verification badge.
 */

import { exposure } from "@/config/identity";

export const REACHABILITY = {
  REACHABLE: "reachable",
  PAGE_ONLY: "page-only",
  ROUTE_ONLY: "route-only",
  UNPUBLISHED: "unpublished",
  UNKNOWN: "unknown",
};

/**
 * @param {object|null} vendor    the signed-in vendor record (may be null)
 * @param {object}      [identity] the identity store's slice, when loaded
 * @param {object}      [profile]  the extended profile, when loaded
 */
export function reachability(vendor, identity, profile) {
  if (!vendor) {
    return {
      state: REACHABILITY.UNKNOWN,
      label: "Signed out",
      detail: "Sign in to manage this workspace.",
    };
  }

  const items = exposure({ vendor, profile, identity });
  const live = Boolean(items.find((item) => item.key === "page")?.done);
  const route = Boolean(items.find((item) => item.key === "contact")?.done);

  if (live && route) {
    return {
      state: REACHABILITY.REACHABLE,
      label: "Reachable",
      detail: "Your page is live and someone can reply to you.",
    };
  }

  if (live && !route) {
    return {
      state: REACHABILITY.PAGE_ONLY,
      label: "Page live, no reply route",
      detail: "People can find you, but there is no number or address to use.",
    };
  }

  if (!live && route) {
    return {
      state: REACHABILITY.ROUTE_ONLY,
      label: "No page yet",
      detail: "You published a route, but your page is not live.",
    };
  }

  return {
    state: REACHABILITY.UNPUBLISHED,
    label: "Not published",
    detail: "A page and a reply route are what make you findable.",
  };
}
