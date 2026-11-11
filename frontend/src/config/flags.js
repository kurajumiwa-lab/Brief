/**
 * Feature flags. Each one reads a Vite build-time variable and defaults OFF, so a
 * build without the variable behaves exactly as before.
 *
 * DESK_ENABLED: the "My desk" screen at /desk (offerings + links to the morning brief
 * and the home office). Set VITE_DESK_ENABLED=true to turn it on.
 */
export const DESK_ENABLED = import.meta.env?.VITE_DESK_ENABLED === "true";
