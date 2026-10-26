/**
 * THE OUTER SHELL — the parts a screenshot cannot show.
 *
 * A single-page app that changes the whole screen without moving focus or
 * changing the document title is, to a screen reader, an app that did nothing.
 * These are the cheapest accessibility features and the easiest to skip, so
 * they are pinned here.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App, { titleFor } from "@/App.jsx";
import { resetStore } from "./helpers.js";

const open = (route = "/") =>
  render(
    <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </MemoryRouter>
  );

beforeEach(() => {
  resetStore();
  document.title = "Caesar — The community decides.";
});

describe("the shell", () => {
  it("starts with a skip link that lands on the main region", () => {
    open();
    const skip = screen.getByRole("link", { name: /skip to content/i });
    expect(skip).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");

    // Nothing else in the document comes before it in tab order.
    const focusable = document.querySelectorAll("a[href], button, select, textarea, input");
    expect(focusable[0]).toBe(skip);
  });

  it("names the screen in the document title", () => {
    open("/circles");
    expect(document.title).toBe("Circles · Caesar");
  });

  it("moves focus to the main region when the screen changes", () => {
    open();
    const main = screen.getByRole("main");
    expect(document.activeElement).not.toBe(main);

    fireEvent.click(within(main.closest(".shell")).getAllByRole("link", { name: /^circles/i })[0]);
    expect(document.activeElement).toBe(main);
  });

  it("does not steal focus on the first render", () => {
    open();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("route titles", () => {
  it.each([
    ["/", "Feed · Caesar"],
    ["/circles", "Circles · Caesar"],
    ["/circles/c-market", "Circle · Caesar"],
    ["/compose", "Write a post · Caesar"],
    ["/profile", "Profile · Caesar"],
    ["/safety", "Safety centre · Caesar"],
    ["/measure", "What this would measure · Caesar"],
    ["/nowhere", "Caesar — The community decides."],
  ])("%s → %s", (route, title) => {
    expect(titleFor(route)).toBe(title);
  });
});

describe("the measurement screen", () => {
  it("is reachable from the rail and prints all six measures", () => {
    open();
    fireEvent.click(screen.getByRole("link", { name: /what this would measure/i }));

    expect(screen.getByRole("heading", { name: /what this would measure/i })).toBeInTheDocument();
    for (const label of [
      "Retention",
      "Data consumption",
      "Content quality",
      "Fairness",
      "Language participation",
      "Moderation outcomes",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Not measurable here")).toBeInTheDocument();
  });

  it("says nothing leaves the browser", () => {
    open("/measure");
    expect(screen.getByText(/nothing leaves this browser/i)).toBeInTheDocument();
  });
});
