/**
 * CATEGORY DATA REQUESTS — the facts a business category needs before the
 * network can use it properly.
 *
 * Each rule says: if a business is in `category` and `field` is still empty,
 * ask for it once, in one popup, with one input. Once a valid answer is saved
 * the popup stops.
 *
 *   {
 *     key: "rider-vehicle",          // unique, also remembers the dismissal
 *     category: "rider",             // a value from business_categories
 *     field: "vehicle_type",         // the field the answer is saved to
 *     scope: "profile",              // "profile" → vendorAPI.updateProfile
 *                                    // "vendor"  → vendorAPI.update
 *     label: "What do you deliver with?",
 *     prompt: "Tell buyers what you travel with, so they know what to expect.",
 *     placeholder: "e.g. motorbike, van, bicycle",
 *     minLength: 2,
 *   }
 *
 * EMPTY ON PURPOSE. A rule ships only once the list of required facts for each
 * category has been decided. Until then nobody sees a category popup, and the
 * mechanism is covered by tests with rules passed in directly.
 */
export const CATEGORY_REQUIREMENTS = [];

const SCOPE_FIELDS = { profile: "profile", vendor: "vendor" };

function isFilled(value, minLength = 1) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length >= minLength;
  return Boolean(value);
}

/**
 * The first rule that applies and is still missing, or null.
 * `dismissedKeys` holds rules already answered on this device.
 */
export function pendingCategoryRequest({ rules = CATEGORY_REQUIREMENTS, vendor, profile, dismissedKeys = [] } = {}) {
  const categories = vendor?.business_categories || [];
  for (const rule of rules) {
    if (!categories.includes(rule.category)) continue;
    if (dismissedKeys.includes(rule.key)) continue;
    const source = SCOPE_FIELDS[rule.scope] === "vendor" ? vendor : profile;
    if (!source) continue; // not loaded yet: ask nothing rather than the wrong thing
    if (!isFilled(source[rule.field], rule.minLength)) return rule;
  }
  return null;
}
