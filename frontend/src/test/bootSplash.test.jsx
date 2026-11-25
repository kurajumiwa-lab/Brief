/**
 * THE COLD-START SCREEN.
 *
 * The old screen was a timer: five seconds, always, with a percentage that
 * measured the clock. These tests pin the four things that replaced it, and
 * they are the four things that matter:
 *
 *   · it leaves when the application is ready, and never on a timer
 *   · it never shows 100% before the work is done
 *   · it says "I cannot measure" instead of counting something it did not
 *   · it can be replayed in place, without a second mark or a stale callback
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import BootSplash, {
  SPLASH_MIN_MS,
  SPLASH_STAGE_MIN_MS,
  SPLASH_SETTLE_MS,
  SPLASH_EXIT_MS,
  SPLASH_MAX_BEFORE_READY,
  SPLASH_STAGES,
} from "@/components/system/BootSplash";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** The screen is handed over this long after the application says it is ready. */
const HANDOVER_MS = SPLASH_STAGE_MIN_MS * 2 + SPLASH_SETTLE_MS + SPLASH_EXIT_MS + 200;

describe("BootSplash", () => {
  it("writes the copy the application has earned, and no more", () => {
    const { rerender } = render(<BootSplash enabled onDone={() => {}} milestone="shelf" />);
    expect(screen.getByTestId("boot-splash-status")).toHaveTextContent("Opening your shelf…");

    rerender(<BootSplash enabled onDone={() => {}} milestone="network" />);
    act(() => vi.advanceTimersByTime(SPLASH_STAGE_MIN_MS + 100));
    expect(screen.getByTestId("boot-splash-status")).toHaveTextContent("Discovering your network…");

    rerender(<BootSplash enabled onDone={() => {}} milestone="curate" />);
    act(() => vi.advanceTimersByTime(SPLASH_STAGE_MIN_MS + 100));
    expect(screen.getByTestId("boot-splash-status")).toHaveTextContent(
      "Curating meaningful connections…",
    );
  });

  it("holds every line long enough for it to be read", () => {
    const { rerender } = render(<BootSplash enabled onDone={() => {}} milestone="shelf" />);
    rerender(<BootSplash enabled onDone={() => {}} milestone="network" />);

    // Too soon: the line changes when the last one has had its moment.
    act(() => vi.advanceTimersByTime(SPLASH_STAGE_MIN_MS - 100));
    expect(screen.getByTestId("boot-splash-status")).toHaveTextContent("Opening your shelf…");

    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByTestId("boot-splash-status")).toHaveTextContent("Discovering your network…");
  });

  it("fills the shelf one block per milestone the application reported", () => {
    const { rerender } = render(<BootSplash enabled onDone={() => {}} milestone="shelf" />);
    expect(document.querySelectorAll('.wasta-splash__block[data-active="true"]')).toHaveLength(1);

    rerender(<BootSplash enabled onDone={() => {}} milestone="network" />);
    act(() => vi.advanceTimersByTime(SPLASH_STAGE_MIN_MS + 100));
    expect(document.querySelectorAll('.wasta-splash__block[data-active="true"]')).toHaveLength(2);
  });

  it("waits for a slow application rather than leaving on a timer", () => {
    const onDone = vi.fn();
    render(<BootSplash enabled onDone={onDone} ready={false} />);

    act(() => vi.advanceTimersByTime(30000));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId("boot-splash")).toHaveAttribute("data-phase", "loading");
  });

  it("leaves when the application is ready", () => {
    const onDone = vi.fn();
    const { rerender } = render(<BootSplash enabled onDone={onDone} ready={false} />);

    act(() => vi.advanceTimersByTime(2000));
    expect(onDone).not.toHaveBeenCalled();

    rerender(<BootSplash enabled onDone={onDone} ready />);
    act(() => vi.advanceTimersByTime(HANDOVER_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("settles: it reads the last line, and then it lifts", () => {
    const onDone = vi.fn();
    render(<BootSplash enabled onDone={onDone} ready />);

    // The floor holds it, whatever else is true.
    act(() => vi.advanceTimersByTime(SPLASH_MIN_MS - 100));
    expect(onDone).not.toHaveBeenCalled();

    // The last line is on the screen and is being read.
    act(() => vi.advanceTimersByTime(SPLASH_STAGE_MIN_MS * 2 + 100));
    expect(screen.getByTestId("boot-splash-status")).toHaveTextContent("Your shelf is ready.");

    // Then it lifts, and the lift is an animation rather than a cut.
    act(() => vi.advanceTimersByTime(SPLASH_SETTLE_MS));
    expect(screen.getByTestId("boot-splash")).toHaveAttribute("data-phase", "leaving");
    act(() => vi.advanceTimersByTime(SPLASH_EXIT_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("never shows 100% before the application is ready", () => {
    render(<BootSplash enabled onDone={() => {}} ready={false} progress={1} />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", String(SPLASH_MAX_BEFORE_READY));
    expect(screen.getByTestId("boot-splash-percent")).toHaveTextContent("99%");
  });

  it("reaches 100% only once the work is done", () => {
    const { rerender } = render(<BootSplash enabled onDone={() => {}} ready={false} progress={0.5} />);
    expect(screen.getByTestId("boot-splash-percent")).toHaveTextContent("50%");

    rerender(<BootSplash enabled onDone={() => {}} ready progress={0.5} />);
    expect(screen.getByTestId("boot-splash-percent")).toHaveTextContent("100%");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("says nothing it cannot measure when the application cannot measure it", () => {
    render(<BootSplash enabled onDone={() => {}} />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("data-mode", "indeterminate");
    // An indeterminate progressbar carries no value — see the ARIA authoring
    // practices on range properties.
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.queryByTestId("boot-splash-percent")).toBeNull();
  });

  it("announces the copy once, politely", () => {
    render(<BootSplash enabled onDone={() => {}} />);

    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(document.querySelectorAll('[aria-live="assertive"]')).toHaveLength(0);
    expect(screen.getByTestId("boot-splash-status")).toHaveAttribute("role", "status");
  });

  it("draws the mark once, and keeps one live region while it does", () => {
    const { rerender } = render(<BootSplash enabled onDone={() => {}} milestone="shelf" />);
    expect(document.querySelectorAll('[data-testid="boot-splash-mark"]')).toHaveLength(1);

    rerender(<BootSplash enabled onDone={() => {}} milestone="curate" />);
    act(() => vi.advanceTimersByTime(SPLASH_STAGE_MIN_MS + 100));

    expect(document.querySelectorAll('[data-testid="boot-splash-mark"]')).toHaveLength(1);
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("replays in place, without a second mark and without a stale completion", () => {
    const onDone = vi.fn();
    const { rerender } = render(<BootSplash enabled onDone={onDone} ready={false} showReplay />);

    rerender(<BootSplash enabled onDone={onDone} ready showReplay />);
    act(() => vi.advanceTimersByTime(1600));
    expect(screen.getByTestId("boot-splash")).toHaveAttribute("data-phase", "leaving");
    expect(onDone).not.toHaveBeenCalled();

    // The exit was in flight. A replay must not inherit it.
    fireEvent.click(screen.getByTestId("boot-splash-replay"));
    act(() => vi.advanceTimersByTime(400));
    expect(onDone).not.toHaveBeenCalled();

    // The replay is the same screen, rewound: one mark, one live region, and
    // the copy back at the beginning.
    expect(document.querySelectorAll('[data-testid="boot-splash-mark"]')).toHaveLength(1);
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(screen.getByTestId("boot-splash-status")).toHaveTextContent("Opening your shelf…");
    expect(screen.getByTestId("boot-splash")).toHaveAttribute("data-phase", "loading");

    // And it still finishes.
    act(() => vi.advanceTimersByTime(HANDOVER_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("replays when the caller asks for it, without a second copy of the screen", () => {
    const onDone = vi.fn();
    const { rerender } = render(<BootSplash enabled onDone={onDone} replayKey={0} />);
    rerender(<BootSplash enabled onDone={onDone} replayKey={1} />);

    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryAllByTestId("boot-splash")).toHaveLength(1);
    expect(screen.getByTestId("boot-splash-status")).toHaveTextContent("Opening your shelf…");
  });

  it("clears its timers when it unmounts, so a fast sign-out leaves no stray callback", () => {
    const onDone = vi.fn();
    const { unmount } = render(<BootSplash enabled onDone={onDone} ready />);
    unmount();
    act(() => vi.advanceTimersByTime(10000));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("does not wait for a fade the person asked not to see", () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const onDone = vi.fn();
    render(<BootSplash enabled onDone={onDone} ready />);

    act(() => vi.advanceTimersByTime(SPLASH_STAGE_MIN_MS * 2 + SPLASH_SETTLE_MS + 100));
    expect(onDone).toHaveBeenCalledTimes(1);

    matchMedia.mockRestore();
  });

  it("is skipped in the test environment so the suite is not slower per spec", () => {
    const onDone = vi.fn();
    render(<BootSplash onDone={onDone} />);
    // The default reads import.meta.env.MODE, which is "test" here.
    expect(onDone).toHaveBeenCalled();
    expect(screen.queryByTestId("boot-splash")).toBeNull();
  });

  it("paints the document in the screen's colour, and takes the paint away", () => {
    const { unmount } = render(<BootSplash enabled onDone={() => {}} />);

    const paint = document.getElementById("wasta-boot-paint");
    expect(paint).not.toBeNull();
    expect(paint.textContent).toContain("#0D2B24");

    unmount();
    expect(document.getElementById("wasta-boot-paint")).toBeNull();
  });

  it("asks the browser's own chrome to match the screen while it is up", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#f5f7f6");
    document.head.appendChild(meta);

    const { unmount } = render(<BootSplash enabled onDone={() => {}} />);
    expect(meta.getAttribute("content")).toBe("#0D2B24");

    unmount();
    expect(meta.getAttribute("content")).toBe("#f5f7f6");
    meta.remove();
  });

  it("has a line for every milestone the application may report", () => {
    expect(SPLASH_STAGES.map((stage) => stage.key)).toEqual([
      "shelf",
      "network",
      "curate",
      "prepare",
      "ready",
    ]);
    // The last line is the screen's to say, and it is the only one that
    // claims the work is finished.
    expect(SPLASH_STAGES[SPLASH_STAGES.length - 1].label).toBe("Your shelf is ready.");
  });
});

/**
 * THE LOADER'S OWN PALETTE, ASSERTED.
 *
 * The loading screen wears forest and gold rather than the product's teal,
 * so it cannot be checked by the product's contrast test. These are the
 * ratios that make that safe, read out of the token file rather than from a
 * copy of it.
 */
describe("the cold-start screen's palette", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(resolve(here, "../styles/tokens.css"), "utf8");
  const light = (() => {
    const block = css.slice(css.indexOf(":root"), css.indexOf("\n.dark {"));
    const tokens = {};
    const re = /--([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g;
    let m;
    while ((m = re.exec(block))) tokens[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
    return tokens;
  })();

  const luminance = ([r, g, b]) => {
    const channel = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const AA = 4.5;

  it("keeps every word on the forest canvas readable", () => {
    const pairs = [
      ["wasta-ivory", "wasta-forest", "the wordmark and the status line"],
      ["wasta-gold", "wasta-forest", "the number and the accent rule"],
      ["wasta-gold-soft", "wasta-forest", "the far end of the bar"],
    ];
    for (const [fg, bg, what] of pairs) {
      const r = ratio(light[fg], light[bg]);
      expect(r, `${what} (${fg} on ${bg}) is ${r.toFixed(2)}:1, needs ${AA}:1`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("keeps the monogram readable on the ivory badge", () => {
    const r = ratio(light["wasta-forest"], light["wasta-ivory"]);
    expect(r, `the monogram on the badge is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);

    const weave = ratio(light["wasta-green"], light["wasta-ivory"]);
    expect(weave, `the woven stroke on the badge is ${weave.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
  });

  it("keeps the quiet lines readable too", () => {
    // The tagline is ivory at 62% on the forest; the note is ivory at 55%.
    const over = (alpha) => [248, 247, 244].map((c, i) => Math.round(c * alpha + [13, 43, 36][i] * (1 - alpha)));
    for (const alpha of [0.62, 0.55]) {
      const r = ratio(over(alpha), light["wasta-forest"]);
      expect(r, `ivory at ${alpha * 100}% on the forest is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    }
  });
});
