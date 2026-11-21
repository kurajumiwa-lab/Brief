import { describe, expect, it } from "vitest";
import { parsePin } from "@/lib/geoPin";

describe("pasted map pins", () => {
  it("reads the common Google and geo link shapes", () => {
    expect(parsePin("https://maps.google.com/?q=-0.0917,34.7680")).toEqual({ lat: -0.0917, lng: 34.768 });
    expect(parsePin("https://www.google.com/maps/@-0.0917,34.7680,15z")).toEqual({ lat: -0.0917, lng: 34.768 });
    expect(parsePin("https://www.google.com/maps/search/?api=1&query=-0.0917,34.7680")).toEqual({ lat: -0.0917, lng: 34.768 });
    expect(parsePin("geo:-0.0917,34.7680")).toEqual({ lat: -0.0917, lng: 34.768 });
    expect(parsePin("-0.0917, 34.7680")).toEqual({ lat: -0.0917, lng: 34.768 });
  });

  it("does not invent a point for a plain area name or short link", () => {
    expect(parsePin("Kondele, Kisumu")).toBeNull();
    expect(parsePin("https://maps.app.goo.gl/abc123")).toBeNull();
    expect(parsePin("0712 345 678")).toBeNull();
  });

  it("rejects out-of-range pairs and the zero placeholder", () => {
    expect(parsePin("100, 34")).toBeNull();
    expect(parsePin("0,0")).toBeNull();
  });
});
