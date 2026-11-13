import { describe, expect, it } from "vitest";
import { modeLabel, offersFor, priceText, verifiedOnly } from "./pageRules";

describe("public Page rules", () => {
  it("shows the amount for a fixed price, with its unit", () => {
    expect(priceText({ price_mode: "fixed", price_kes: 1500, price_unit: "per_visit" })).toContain("1,500");
    expect(priceText({ price_mode: "fixed", price_kes: 1500, price_unit: "per_visit" })).toContain("per visit");
  });

  it("shows a starting price for negotiable", () => {
    expect(priceText({ price_mode: "negotiable", price_kes: 800, price_unit: null })).toMatch(/^From .*800.*negotiable$/);
  });

  it("never shows an amount for ask_me, even if one is stored", () => {
    expect(priceText({ price_mode: "ask_me", price_kes: 999, price_unit: null })).toBe("Ask me for a price");
    expect(priceText({ price_mode: "fixed", price_kes: null, price_unit: null })).toBe("Ask me for a price");
  });

  it("labels each way with plain words", () => {
    expect(modeLabel("home_visit")).toBe("Home visit");
    expect(modeLabel("pickup_delivery")).toBe("Pickup & delivery");
  });

  it("keeps only verified registrations", () => {
    const out = verifiedOnly([
      { title: "A", status: "verified" },
      { title: "B", status: "self_declared" },
    ]);
    expect(out.map((r) => r.title)).toEqual(["A"]);
  });

  it("builds a labelled price line for each way of a service", () => {
    const [svc] = offersFor([{ name: "Fitting", modes: [{ mode: "in_shop", price_mode: "fixed", price_kes: 500, price_unit: null }] }]);
    expect(svc.modes[0].label).toBe("In shop or at my place");
    expect(svc.modes[0].price).toContain("500");
  });
});
