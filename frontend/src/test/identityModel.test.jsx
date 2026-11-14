import { describe, expect, it } from "vitest";
import {
  COUNTRIES, REGIONS, DEFAULT_REGION, regionFromPlace, regionPath, regionLine, countryName,
} from "@/config/regions";
import {
  INTENTS, CAPABILITIES, CLAIM_STATUS, AFFILIATION_METHODS, RANKS,
  stockAllowed, canSellGoods, rankFor, identityLine, pagePath,
} from "@/config/identity";

/**
 * The redesign's product promises, written as tests.
 *
 * These are not UI snapshots. They pin the four things the old app got wrong:
 * geography was markets, entry was a vendor category, stock existed before a
 * person said they sold anything, and standing was a score you could buy into.
 */
describe("regions, not markets", () => {
  it("covers five countries with one short, unique region list", () => {
    expect(COUNTRIES.map((c) => c.code)).toEqual(["KE", "UG", "ET", "RW", "TZ"]);
    expect(REGIONS).toHaveLength(21);
    expect(new Set(REGIONS.map((r) => r.slug)).size).toBe(21);
    for (const region of REGIONS) {
      expect(region.name).toBeTruthy();
      expect(region.hub).toBeTruthy();
      expect(region.aliases.length).toBeGreaterThan(0);
      expect(region.knownFor.length).toBeGreaterThan(0);
      expect(COUNTRIES.some((c) => c.code === region.country)).toBe(true);
    }
  });

  it("resolves the city people actually type, not a market name", () => {
    expect(regionFromPlace("Kisumu")?.slug).toBe("nyanza");
    expect(regionFromPlace("I live in Kisii town")?.slug).toBe("nyanza");
    expect(regionFromPlace("Mombasa")?.slug).toBe("coast");
    expect(regionFromPlace("Kampala")?.country).toBe("UG");
    expect(regionFromPlace("somewhere unheard of")).toBeNull();
    expect(regionFromPlace("")).toBeNull();
    // An unset region is shown as unset, never silently guessed.
    expect(DEFAULT_REGION.slug).toBe("nairobi-metro");
  });

  it("links with a region address and a readable line", () => {
    const nyanza = REGIONS.find((r) => r.slug === "nyanza");
    expect(regionPath(nyanza)).toBe("/regions/nyanza");
    expect(regionLine(nyanza)).toContain("Kisumu");
    expect(regionLine(nyanza)).toContain("Kenya");
    expect(countryName("KE")).toBe("Kenya");
  });
});

describe("a person, not a vendor category", () => {
  it("makes looking around a complete answer", () => {
    expect(INTENTS.map((i) => i.value)).toEqual(["explore", "offer", "represent"]);
    const explore = INTENTS[0];
    expect(explore.label).toMatch(/looking/i);
    expect(explore.blurb).toMatch(/no page/i);
    expect(explore.blurb).not.toMatch(/empty|incomplete|setup/i);
  });

  it("expresses work as four toggleable capabilities, not a shelf", () => {
    expect(CAPABILITIES.map((c) => c.value)).toEqual([
      "sell_goods", "offer_services", "rent_assets", "licensed",
    ]);
  });

  it("opens stock only when the person says they sell goods, or already trades", () => {
    expect(stockAllowed({ identity: { capabilities: [] } })).toBe(false);
    expect(stockAllowed({ identity: { intent: "explore" } })).toBe(false);
    expect(stockAllowed({ identity: { capabilities: ["offer_services"] } })).toBe(false);

    expect(stockAllowed({ identity: { capabilities: ["sell_goods"] } })).toBe(true);
    expect(stockAllowed({ identity: { capabilities: ["sell_goods"] }, vendor: { has_stock: false } })).toBe(true);

    // Nobody's existing shelf is deleted by a model change.
    expect(stockAllowed({ identity: { capabilities: [] }, vendor: { has_stock: true } })).toBe(true);
    expect(stockAllowed({ identity: { capabilities: [] }, vendor: { total_stock_moved: 40 } })).toBe(true);
    expect(canSellGoods({ capabilities: ["sell_goods"] })).toBe(true);
    expect(canSellGoods(undefined)).toBe(false);
  });

  it("keeps representation a claim until a third party answers", () => {
    expect(AFFILIATION_METHODS.map((m) => m.value)).toEqual(["domain_email", "call_back", "letter"]);
    // Any one method is enough; the app records which one was used.
    expect(AFFILIATION_METHODS.length).toBe(3);
  });

  it("uses a page address, never a handle as identity", () => {
    expect(pagePath("achieng")).toBe("/p/achieng");
    expect(pagePath()).toBe("/you");
  });
});

describe("rank is exposure, never a purchase", () => {
  const page = { business_name: "Achieng", vendor_handle: "achieng", intent: "offer", physical_location: "Kisumu" };

  it("runs five rungs from visitor to institution-confirmed", () => {
    expect(RANKS.map((r) => r.level)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(RANKS.map((r) => r.label)).toEqual([
      "Visitor", "Present", "Reachable", "Trading", "Trusted", "Confirmed",
    ]);
  });

  it("starts a person who just looks around at visitor, with something to do next", () => {
    const rank = rankFor({ identity: { capabilities: [], intent: "explore" } });
    expect(rank.level).toBe(0);
    expect(rank.progress).toBe(0);
    expect(rank.next.key).toBe("present");
    expect(rank.nextAction.to).toBe("/you/page");
    expect(rank.items).toHaveLength(8);
    expect(rank.items.filter((i) => i.done)).toHaveLength(0);
  });

  it("reaches Present on a page, then Reachable on a published contact route", () => {
    const present = rankFor({ vendor: { ...page, business_description: "Fresh produce" }, identity: { capabilities: [] } });
    expect(present.level).toBe(1);
    expect(present.next.key).toBe("reachable");
    // Verification is not required at this rung: exposure is the measure.
    expect(present.nextAction.key).toBe("contact");

    const reachable = rankFor({
      vendor: page,
      identity: { capabilities: [], contact: { phone: "+254700000000" } },
    });
    expect(reachable.level).toBe(2);
    expect(reachable.next.key).toBe("trading");
  });

  it("reaches Trading on one movement, Trusted only on a real record", () => {
    const trading = rankFor({
      vendor: { ...page, movements_completed: 1 },
      identity: { contact: { phone: "+254700000000" } },
    });
    expect(trading.level).toBe(3);
    expect(trading.next.key).toBe("trusted");

    const nearly = rankFor({
      vendor: { ...page, movements_completed: 4, fulfillment_rate: 0.95 },
      identity: { contact: { phone: "+254700000000" } },
    });
    expect(nearly.level).toBe(3);

    const trusted = rankFor({
      vendor: { ...page, movements_completed: 5, fulfillment_rate: 0.95 },
      identity: { contact: { phone: "+254700000000" } },
    });
    expect(trusted.level).toBe(4);
    expect(trusted.next.key).toBe("institution");
  });

  it("reserves the last rung for a claim somebody else confirmed", () => {
    const pending = rankFor({
      vendor: { ...page, movements_completed: 5, fulfillment_rate: 0.95 },
      identity: {
        contact: { phone: "+254700000000" },
        affiliation: { name: "Kisumu Clinic", status: CLAIM_STATUS.PENDING },
      },
    });
    // A pending claim is worth nothing yet, and must not read as verified.
    expect(pending.level).toBe(4);

    const confirmed = rankFor({
      vendor: { ...page, movements_completed: 5, fulfillment_rate: 0.95 },
      identity: {
        contact: { phone: "+254700000000" },
        affiliation: { name: "Kisumu Clinic", role: "Nurse", status: CLAIM_STATUS.VERIFIED },
      },
    });
    expect(confirmed.level).toBe(5);
    expect(confirmed.progress).toBe(100);
    expect(confirmed.nextAction).toBeNull();
  });

  it("prefers the checked claim in the identity line", () => {
    expect(identityLine({
      vendor: page,
      identity: { capabilities: ["sell_goods"], affiliation: { name: "Kisumu Clinic", role: "Nurse", status: "verified" } },
    })).toBe("Nurse · Kisumu Clinic");
    expect(identityLine({
      vendor: page,
      identity: { capabilities: ["offer_services"] },
    })).toBe("Services · Kisumu");
    expect(identityLine({ identity: {} })).toBe("");
  });
});
