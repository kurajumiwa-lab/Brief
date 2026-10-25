/**
 * THE FEED, THE VERDICT AND THE TWO BUTTONS.
 *
 * The product's claims, exercised through the interface rather than the
 * functions: the feed is ordered by the published score, both reactions are
 * equal citizens, a downvote changes reach and nothing else, and the panel that
 * explains a ranking is showing the numbers that produced it.
 */
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "@/App.jsx";
import { useApp } from "@/store/appStore.js";
import { feedEntries } from "@/lib/selectors.js";
import { postBy, resetStore } from "./helpers.js";

const open = (route = "/") =>
  render(
    <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </MemoryRouter>
  );

const card = (id) => screen.getByTestId(`post-${id}`);

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the brand line", () => {
  it("says Caesar is the crowd, not an emperor", () => {
    open("/");
    expect(screen.getByText(/No emperors here\. Caesar is the crowd\./)).toBeInTheDocument();
  });
});

describe("the home feed", () => {
  it("orders posts by the published score, not by arrival", () => {
    open();
    const order = screen.getAllByTestId(/^post-/).map((node) => node.getAttribute("data-testid"));
    // The tomato-price post is 2 h old with 34 supports; the brand-new question
    // has 2 reactions and sits near the bottom on purpose.
    expect(order[0]).toBe("post-p-tomato");
    expect(order.indexOf("post-p-seed")).toBeGreaterThan(order.indexOf("post-p-tomato"));
    // The coordinated dogpile is still in the feed, and last.
    expect(order).toContain("post-p-packaging");
    expect(order[order.length - 1]).toBe("post-p-packaging");
  });

  it("shows both reactions as peers, with counts and accessible names", () => {
    open();
    const tomato = card("p-tomato");
    const up = within(tomato).getByRole("button", { name: /support — 34 so far/i });
    const down = within(tomato).getByRole("button", { name: /disagree — 3 so far/i });
    expect(up).toHaveAttribute("aria-pressed", "false");
    expect(down).toHaveAttribute("aria-pressed", "false");
  });

  it("records support and shows the new count immediately", () => {
    open();
    const tomato = card("p-tomato");
    fireEvent.click(within(tomato).getByRole("button", { name: /support/i }));

    expect(within(card("p-tomato")).getByRole("button", { name: /support — 35 so far/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(postBy("p-tomato").reactions.filter((r) => r.userId === useApp.getState().viewerId)).toHaveLength(1);
  });

  it("lets a person take a reaction back by pressing it again", () => {
    open();
    fireEvent.click(within(card("p-tomato")).getByRole("button", { name: /support/i }));
    fireEvent.click(within(card("p-tomato")).getByRole("button", { name: /support/i }));

    expect(within(card("p-tomato")).getByRole("button", { name: /support — 34 so far/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(postBy("p-tomato").reactions.filter((r) => r.userId === useApp.getState().viewerId)).toHaveLength(0);
  });

  it("swaps one reaction for the other rather than stacking both", () => {
    open();
    fireEvent.click(within(card("p-tomato")).getByRole("button", { name: /support/i }));
    fireEvent.click(within(card("p-tomato")).getByRole("button", { name: /disagree/i }));

    const mine = postBy("p-tomato").reactions.filter((r) => r.userId === useApp.getState().viewerId);
    expect(mine).toHaveLength(1);
    expect(mine[0].value).toBe("down");
  });

  it("says, on every card, why it is where it is", () => {
    open();
    expect(within(card("p-tomato")).getByText(/confidence from 37 reactions/i)).toBeInTheDocument();
    expect(within(card("p-seed")).getByText(/small sample does not decide anything/i)).toBeInTheDocument();
    expect(within(card("p-packaging")).getByText(/dissent never hides a post/i)).toBeInTheDocument();
  });
});

describe("the verdict panel", () => {
  it("opens from the card's reasoning and prints the four weighted parts", () => {
    open();
    fireEvent.click(within(card("p-tomato")).getByText(/confidence from 37 reactions/i));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/why this post sits where it does/i)).toBeInTheDocument();
    for (const part of ["Confidence", "Participation", "Recency", "Circle fit"]) {
      expect(within(dialog).getAllByText(new RegExp(part, "i")).length).toBeGreaterThan(0);
    }
    expect(within(dialog).getByText(/0\.50 × confidence/)).toBeInTheDocument();
  });

  it("shows exactly the score the feed sorted by", () => {
    // A frozen clock, so "now" in the assertion is the "now" the feed used.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 25, 9, 0, 0)));
      resetStore();
      const expected = feedEntries(useApp.getState()).find((entry) => entry.post.id === "p-tomato").score;

      open();
      fireEvent.click(within(card("p-tomato")).getByText(/confidence from \d+ reactions/i));

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(expected.toFixed(3))).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("explains a contested post without ever offering to delete it", () => {
    open();
    fireEvent.click(within(card("p-bypass")).getByText(/dissent never hides a post/i));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/^Contested\.$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/disagreement is not a reason to remove/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("names coordinated activity and says nobody is banned", () => {
    open();
    const entryText = within(card("p-packaging")).getByText(/reactions · .*% disagree/i);
    fireEvent.click(entryText);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/^Coordinated activity\.$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Nobody is banned and nothing is deleted/i)).toBeInTheDocument();
  });

  it("states that a downvote lowers reach and nothing else", () => {
    open();
    fireEvent.click(within(card("p-tomato")).getByText(/confidence from 37 reactions/i));
    expect(
      within(screen.getByRole("dialog")).getByText(/never reports, hides or deletes anything/i)
    ).toBeInTheDocument();
  });
});
