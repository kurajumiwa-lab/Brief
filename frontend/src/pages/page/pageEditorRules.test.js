import { describe, expect, it } from "vitest";
import { ABOUT_MAX, TAGLINE_MAX, aboutSource, toPayload, validatePage } from "./pageEditorRules";

describe("Page editor rules", () => {
  it("trims text and keeps the section switches", () => {
    expect(toPayload({ tagline: "  Hi  ", about: " ", show_offers: true, show_hours: false, show_credentials: true }))
      .toEqual({ tagline: "Hi", about: "", show_offers: true, show_hours: false, show_credentials: true });
  });

  it("refuses a tagline or About over the limit", () => {
    expect(validatePage({ tagline: "x".repeat(TAGLINE_MAX + 1) })).toMatch(/tagline/);
    expect(validatePage({ about: "x".repeat(ABOUT_MAX + 1) })).toMatch(/About/);
    expect(validatePage({ tagline: "x".repeat(TAGLINE_MAX) })).toBeNull();
  });

  it("says where a blank About comes from", () => {
    expect(aboutSource({ about: "" }, "Profile text")).toBe("your business description");
    expect(aboutSource({ about: "Mine" }, "Profile text")).toBe("your About text");
    expect(aboutSource({ about: "" }, "")).toBe("nothing yet");
  });
});
