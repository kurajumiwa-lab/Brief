/**
 * Feature flags. Each one reads a Vite build-time variable and defaults OFF, so a
 * build without the variable behaves exactly as before.
 *
 * DESK_ENABLED: the "My desk" screen at /desk (offerings + links to the morning brief
 * and the home office). Set VITE_DESK_ENABLED=true to turn it on.
 */
export const DESK_ENABLED = import.meta.env?.VITE_DESK_ENABLED === "true";

/**
 * NEARBY_DOORS_ENABLED: "Open front doors" at /doors, the nearby people who currently
 * offer something to the network. Set VITE_NEARBY_DOORS_ENABLED=true to turn it on.
 */
export const NEARBY_DOORS_ENABLED = import.meta.env?.VITE_NEARBY_DOORS_ENABLED === "true";

/**
 * ONBOARDING_ACTIVITIES_ENABLED: the "What do you do?" card on Home. A person picks what
 * they do (several at once), or skips it and finishes later. Set
 * VITE_ONBOARDING_ACTIVITIES_ENABLED=true to turn it on.
 */
export const ONBOARDING_ACTIVITIES_ENABLED = import.meta.env?.VITE_ONBOARDING_ACTIVITIES_ENABLED === "true";

/**
 * FIVE_TAB_NAV_ENABLED: the five-tab shape (Desk, Nearby, Mail, Search, Me). Off keeps the
 * current five (Home, Local network, Mall, Connect, My World). Set
 * VITE_FIVE_TAB_NAV_ENABLED=true to turn it on. Routes do not change either way.
 */
export const FIVE_TAB_NAV_ENABLED = import.meta.env?.VITE_FIVE_TAB_NAV_ENABLED === "true";

/**
 * CREDENTIALS_ENABLED: licences and credentials on Me, credential badges on front doors and the
 * business profile. OFF by default until the legal review (plan D3) is done.
 * Set VITE_CREDENTIALS_ENABLED=true to opt in.
 */
export const CREDENTIALS_ENABLED = import.meta.env?.VITE_CREDENTIALS_ENABLED === "true";

/**
 * PROFESSIONAL_PROFILE_ENABLED: the professional card on a business profile (services, hours,
 * registrations, completed appointments). ON by default. Set VITE_PROFESSIONAL_PROFILE_ENABLED=false
 * to turn it off.
 */
export const PROFESSIONAL_PROFILE_ENABLED = import.meta.env?.VITE_PROFESSIONAL_PROFILE_ENABLED !== "false";

/**
 * MAIL_ENABLED: the consolidated "Mail" screen at /mail — every conversation I have joined
 * (direct, deals, groups, business lists, topics) in one list, each opening the existing chat
 * thread. Conversations only; the bell (Connect) stays for notifications.
 * Set VITE_MAIL_ENABLED=true to turn it on. Off, the Mail tab keeps pointing at Connect.
 */
export const MAIL_ENABLED = import.meta.env?.VITE_MAIL_ENABLED === "true";

/**
 * CIRCLES_TRUSTED_ENABLED: on Me, a Circles panel (follow or unfollow the circles on the
 * existing social endpoints) and an "add trusted contact by handle" form (the existing
 * saved-relationships endpoint). Set VITE_CIRCLES_TRUSTED_ENABLED=true to turn it on.
 */
export const CIRCLES_TRUSTED_ENABLED = import.meta.env?.VITE_CIRCLES_TRUSTED_ENABLED === "true";

/**
 * BRIEF_LANDING_ENABLED: the Morning Brief is the default landing page at "/" (after sign-in
 * too). Off, "/" is Home as before. Home stays reachable at /home either way.
 * Set VITE_BRIEF_LANDING_ENABLED=true to turn it on.
 */
export const BRIEF_LANDING_ENABLED = import.meta.env?.VITE_BRIEF_LANDING_ENABLED === "true";

/**
 * SERVICE_PROFILES_ENABLED: service-aware wording on the Desk (visits, hours, shifts instead
 * of stock words for services; the empty state says it links to goods stock). Copy only; no
 * data or route changes. Off keeps the existing wording.
 * Set VITE_SERVICE_PROFILES_ENABLED=true to turn it on.
 */
export const SERVICE_PROFILES_ENABLED = import.meta.env?.VITE_SERVICE_PROFILES_ENABLED === "true";

/**
 * POST_TRADE_RATING_GATE_ENABLED: a finished trade becomes final once its post-trade rating is
 * recorded, and the rating prompt appears on bookings and received stock. OFF by default. Ratings
 * measure exposure to the market and move no money. Set VITE_POST_TRADE_RATING_GATE_ENABLED=true.
 */
export const POST_TRADE_RATING_GATE_ENABLED = import.meta.env?.VITE_POST_TRADE_RATING_GATE_ENABLED === "true";
