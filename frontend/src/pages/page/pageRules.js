// Pure rules for the public Page (/page/:handle). Kept apart from the screen so they can be tested.
import { currency } from "@/lib/formatters";

const MODE_LABEL = {
  in_shop: "In shop or at my place",
  home_visit: "Home visit",
  remote: "Remote or online",
  drop_off: "Drop-off",
  pickup_delivery: "Pickup & delivery",
  clinic: "In shop or at my place",
  home: "Home visit",
};

/** Label for one way a service is given. */
export const modeLabel = (mode) => MODE_LABEL[mode] || String(mode).replace(/_/g, " ");

/**
 * The price shown for one way a service is given. Mirrors the backend rules:
 * fixed shows the amount, negotiable shows it as a starting point, ask_me shows no amount.
 */
export function priceText({ price_mode, price_kes, price_unit }) {
  const unit = price_unit ? ` ${price_unit.replace(/_/g, " ")}` : "";
  if (price_mode === "ask_me" || price_kes === null || price_kes === undefined) {
    return "Ask me for a price";
  }
  if (price_mode === "negotiable") return `From ${currency(price_kes)}${unit} · negotiable`;
  return `${currency(price_kes)}${unit}`;
}

/** Only verified registrations appear on the Page. */
export const verifiedOnly = (registrations = []) => registrations.filter((r) => r.status === "verified");

/** Services with at least one way to give them, and the ways as a list. */
export function offersFor(services = []) {
  return services.map((s) => ({
    ...s,
    modes: (s.modes || []).map((m) => ({ ...m, label: modeLabel(m.mode), price: priceText(m) })),
  }));
}
