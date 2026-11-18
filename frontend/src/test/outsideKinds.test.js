/** Category scoping starts at the request: FastAPI needs `kinds=a,b`. */
import { describe, it, expect } from "vitest";
import { outsideParams } from "@/lib/api";

describe("outside feed params", () => {
  it("serialises the kinds array instead of sending kinds[]=…", () => {
    expect(outsideParams({ kinds: ["service", "available"], limit: 12 }))
      .toEqual({ kinds: "service,available", limit: 12 });
  });

  it("keeps a single kind and drops blanks rather than sending an empty filter", () => {
    expect(outsideParams({ kinds: ["listing"] })).toEqual({ kinds: "listing" });
    expect(outsideParams({ kinds: [] })).toEqual({});
    expect(outsideParams({ kinds: "rental", radius_km: 0 })).toEqual({ kinds: "rental", radius_km: 0 });
  });
});
