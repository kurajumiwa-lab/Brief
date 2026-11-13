import { describe, expect, it } from "vitest";
import { fallbackText, usableMethods, validateRecord } from "./integrationsRules";

describe("integrations rules", () => {
  it("hides the API rung until an adapter exists", () => {
    expect(usableMethods(["api", "export", "manual"])).toEqual(["export", "manual"]);
  });

  it("names the next rung after a failure, and says when there is none", () => {
    expect(fallbackText("attested_upload")).toContain("attested upload");
    expect(fallbackText(null)).toBe("No further method is available.");
  });

  it("requires a reason for a failed attempt", () => {
    expect(validateRecord({ fact_kind: "etims_status", method: "export", outcome: "failed", note: " " }))
      .toBe("Say what went wrong.");
    expect(validateRecord({ fact_kind: "etims_status", method: "export", outcome: "ok" })).toBeNull();
  });

  it("requires a fact and a method", () => {
    expect(validateRecord({ method: "export" })).toBe("Choose a fact to record.");
    expect(validateRecord({ fact_kind: "brs_cr12" })).toBe("Choose how the fact was obtained.");
  });
});
