import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

// jsdom gaps used by the UI
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || vi.fn();
window.URL.createObjectURL = window.URL.createObjectURL || vi.fn(() => "blob:mock");
window.URL.revokeObjectURL = window.URL.revokeObjectURL || vi.fn();
