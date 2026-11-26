import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * THE WEEK BAND — the Inbox's former contents, on Home.
 *
 * The brief moved scheduled work out of the Inbox: rounds and RSVPs, the work
 * board and routine prompts belong with the rest of "what is on this week",
 * not above a list of messages. Nothing was deleted, so the things worth
 * pinning are:
 *
 *   · each section still renders from the same props it always did;
 *   · the band is absent when there is genuinely nothing, rather than standing
 *     there as an empty calendar — which is the "everything at once" the
 *     redesign is undoing;
 *   · Home links to the calendar, because the band is a summary and the full
 *     week has its own screen.
 */

vi.mock("@/lib/api", () => ({
  apiError: (_e, fallback) => fallback,
  outsideAPI: { agenda: vi.fn(() => Promise.resolve({ data: { items: [] } })) },
  corridorTaskAPI: { inbox: vi.fn(() => Promise.resolve({ data: { days: [] } })) },
  recurringRoutineAPI: { mine: vi.fn(() => Promise.resolve({ data: {} })), markShared: vi.fn() },
  fileAPI: {},
}));

vi.mock("@/lib/ledgerApi", () => ({
  default: { confirmCompletion: vi.fn() },
  ledgerAPI: { markNotificationActed: vi.fn() },
}));

import WeekBand from "@/components/home/WeekBand";

const base = {
  agenda: [],
  agendaLoading: false,
  agendaError: "",
  onRetryAgenda: () => {},
  onOpenPass: () => {},
  taskData: { days: [], tasks: [], earnings: null },
  sharePrompts: [],
};

const mount = (props = {}) =>
  render(
    <MemoryRouter>
      <WeekBand {...base} {...props} />
    </MemoryRouter>,
  );

describe("WeekBand", () => {
  it("renders nothing at all when the week is empty", () => {
    mount({ taskData: null });
    expect(screen.queryByTestId("week-band")).toBeNull();
    expect(screen.queryByRole("heading", { name: /your week/i })).toBeNull();
  });

  it("draws one heading for the band, not one per section", () => {
    mount();
    expect(screen.getByRole("heading", { name: /your week/i })).toBeInTheDocument();
  });

  it("keeps the work board once it has data", () => {
    mount({ taskData: { days: [{ date: "2026-11-24", available: 2, claimed: 1 }], tasks: [] } });
    expect(screen.getByTestId("corridor-task-board")).toBeInTheDocument();
  });

  it("offers the full calendar as a real destination", () => {
    mount();
    // "Your week" is a summary; /calendar is the screen that shows all of it.
    expect(screen.getByRole("link", { name: /calendar/i })).toHaveAttribute("href", "/calendar");
  });

  it("still renders an agenda that failed to load, with a retry", () => {
    // A failed agenda must not look like a free week.
    mount({ agendaError: "Check your connection and try again." });
    expect(screen.getByTestId("week-band")).toBeInTheDocument();
  });
});
