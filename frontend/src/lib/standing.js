import { rankFor } from "@/config/identity";

/**
 * The standing of the person behind a feed card.
 *
 * The feed carries the facts, so the same `rankFor` ladder is used everywhere.
 * `contact_exposed` is a boolean, never the phone number itself.
 *
 * `Vendor.is_verified` is not mapped to rank 5: it records that our team checked
 * the business, not that an institution or regulator confirmed the person. A
 * card may only show a level the server can derive from these fields.
 */
export function ownerRank(owner) {
  if (!owner) return rankFor();
  return rankFor({
    vendor: {
      ...owner,
      vendor_handle: owner.handle,
      business_name: owner.name,
      page_live: owner.page_live === true,
      intent: owner.page_live === true ? "offer" : "explore",
      business_description: owner.business_description || "",
      physical_location: owner.physical_location || "",
      movements_completed: Number(owner.movements_completed || 0),
      confirmed_trade_proofs: Number(owner.confirmed_trade_proofs || 0),
      contact_exposed: Boolean(owner.contact_exposed),
    },
  });
}

export const ownerLevel = (owner) => ownerRank(owner).level;
