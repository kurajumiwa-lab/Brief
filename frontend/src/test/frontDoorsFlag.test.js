import { describe, expect, it } from "vitest";
import { NEARBY_DOORS_ENABLED, DESK_ENABLED } from "@/config/flags";

describe("feature flags default off", () => {
  it("open front doors is off unless VITE_NEARBY_DOORS_ENABLED=true", () => {
    expect(NEARBY_DOORS_ENABLED).toBe(false);
  });
  it("desk is on by default: it is the only screen that sets a price", () => {
    // Changed deliberately. As an opt-in flag the desk was invisible in
    // production, so a business had no discoverable place to add a service,
    // a duration or a price. It is now opt-out — VITE_DESK_ENABLED=false hides it.
    expect(DESK_ENABLED).toBe(true);
  });
});

import { ONBOARDING_ACTIVITIES_ENABLED } from "@/config/flags";

describe("onboarding activities flag", () => {
  it("'What do you do?' is off unless VITE_ONBOARDING_ACTIVITIES_ENABLED=true", () => {
    expect(ONBOARDING_ACTIVITIES_ENABLED).toBe(false);
  });
});
