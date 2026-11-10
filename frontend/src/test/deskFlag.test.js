import { describe, expect, it } from "vitest";
import { DESK_ENABLED } from "@/config/flags";

describe("desk feature flag", () => {
  it("is off by default, so current users see no change", () => {
    // Tests run without VITE_DESK_ENABLED set, so the flag must read false.
    expect(DESK_ENABLED).toBe(false);
  });
});
