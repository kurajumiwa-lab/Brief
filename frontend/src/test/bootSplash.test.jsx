/**
 * THE COLD-START SPLASH.
 *
 * Five seconds, and the last two say "Logging in to the network". What is
 * worth pinning: the sequence is the one that was asked for, the text changes
 * at three seconds and not at random, and it always lets go at five — a splash
 * that holds a working app hostage is worse than the grey rectangle it
 * replaced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

import BootSplash, { SPLASH_TOTAL_MS, SPLASH_HANDSHAKE_AT_MS } from "@/components/system/BootSplash";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("BootSplash", () => {
  it("is five seconds long, with the handshake in the last two", () => {
    expect(SPLASH_TOTAL_MS).toBe(5000);
    expect(SPLASH_HANDSHAKE_AT_MS).toBe(3000);
  });

  it("opens the shelf, then logs in to the network, then lets go at five seconds", () => {
    const onDone = vi.fn();
    render(<BootSplash enabled onDone={onDone} />);

    const splash = screen.getByTestId("boot-splash");
    expect(splash).toHaveAttribute("data-phase", "arriving");
    expect(screen.getByTestId("boot-splash-status")).toHaveTextContent(/opening your shelf/i);

    act(() => vi.advanceTimersByTime(3100));
    expect(screen.getByTestId("boot-splash-status")).toHaveTextContent(/logging in to the network/i);

    // Not finished yet — five seconds means five seconds.
    act(() => vi.advanceTimersByTime(1600));
    expect(onDone).not.toHaveBeenCalled();

    // At five seconds it starts leaving; the 220ms exit animation is the only
    // thing between "done" and the app being visible.
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId("boot-splash")).toHaveAttribute("data-phase", "leaving");
    act(() => vi.advanceTimersByTime(250));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("clears its timers when it unmounts, so a fast sign-out leaves no stray callback", () => {
    const onDone = vi.fn();
    const { unmount } = render(<BootSplash enabled onDone={onDone} />);
    unmount();
    act(() => vi.advanceTimersByTime(6000));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("is skipped in the test environment so the suite is not five seconds slower per spec", () => {
    const onDone = vi.fn();
    render(<BootSplash onDone={onDone} />);
    // The default reads import.meta.env.MODE, which is "test" here.
    expect(onDone).toHaveBeenCalled();
    expect(screen.queryByTestId("boot-splash")).toBeNull();
  });
});
