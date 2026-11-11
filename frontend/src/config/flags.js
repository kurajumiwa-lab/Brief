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
 * MAIL_ENABLED: the consolidated "Mail" screen at /mail — every conversation I have joined
 * (direct, deals, groups, business lists, topics) in one list, each opening the existing chat
 * thread. Conversations only; the bell (Connect) stays for notifications.
 * Set VITE_MAIL_ENABLED=true to turn it on. Off, the Mail tab keeps pointing at Connect.
 */
export const MAIL_ENABLED = import.meta.env?.VITE_MAIL_ENABLED === "true";
