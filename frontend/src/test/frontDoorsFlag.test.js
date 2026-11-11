import { describe, expect, it } from "vitest";
import { NEARBY_DOORS_ENABLED, DESK_ENABLED } from "@/config/flags";

describe("feature flags default off", () => {
  it("open front doors is off unless VITE_NEARBY_DOORS_ENABLED=true", () => {
    expect(NEARBY_DOORS_ENABLED).toBe(false);
  });
  it("desk stays off by default too", () => {
    expect(DESK_ENABLED).toBe(false);
  });
});

import { ONBOARDING_ACTIVITIES_ENABLED } from "@/config/flags";

describe("onboarding activities flag", () => {
  it("'What do you do?' is off unless VITE_ONBOARDING_ACTIVITIES_ENABLED=true", () => {
    expect(ONBOARDING_ACTIVITIES_ENABLED).toBe(false);
  });
});
