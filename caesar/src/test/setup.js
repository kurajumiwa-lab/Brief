import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

// Every spec starts from the seed, not from whatever the last spec stored.
beforeEach(() => {
  window.localStorage.clear();
});

// jsdom gaps the UI relies on.
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
}
// jsdom defines scrollTo but throws "Not implemented"; this app scrolls on navigation.
window.scrollTo = () => {};
