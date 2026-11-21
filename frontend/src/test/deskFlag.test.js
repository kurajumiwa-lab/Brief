import { describe, expect, it } from "vitest";
import { DESK_ENABLED } from "@/config/flags";

describe("desk feature flag", () => {
  it("is on by default, because it is the only screen that sets a price", () => {
    // Tests run without VITE_DESK_ENABLED set. The desk used to be opt-in, which
    // meant a new business could not find where to add a service, a duration or
    // a price at all. It is now an opt-out: only an explicit "false" hides it.
    expect(DESK_ENABLED).toBe(true);
  });
});
