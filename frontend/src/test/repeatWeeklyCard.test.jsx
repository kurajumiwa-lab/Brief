import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ data: {} }) }));

vi.mock("@/lib/api", () => ({
  recurringRoutineAPI: { create: mocks.create },
  apiError: (_error, fallback) => fallback,
}));

vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import RepeatWeeklyCard from "@/components/routines/RepeatWeeklyCard";

const draft = {
  title: "Nairobi → Kisumu Saturday deliveries",
  body: "Pickup at Kencom, delivery to Kisumu bus park by 2pm.",
  location: "Kisumu",
  price_kes: 500,
  capacity: 12,
  content_type: "scheduled",
};

describe("Create screen Repeat Weekly", () => {
  it("reveals Mon–Sun, then saves the draft as a routine for the chosen day", async () => {
    render(<MemoryRouter><RepeatWeeklyCard draft={draft} /></MemoryRouter>);
    const toggle = screen.getByRole("switch", { name: /repeat weekly/i });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Sat" })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Sat" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Sun" }));

    fireEvent.click(screen.getByRole("button", { name: /save as weekly routine/i }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      title: draft.title,
      town: "Kisumu",
      region_slug: "nyanza",
      day_of_week: 0,
      start_time_local: "08:00",
      publish_lead_hours: 48,
    });
    expect(await screen.findByRole("button", { name: /saved as a routine/i })).toBeDisabled();
  });

  it("keeps the honest line: a schedule is not a reliability guarantee", () => {
    render(<MemoryRouter><RepeatWeeklyCard draft={draft} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("switch", { name: /repeat weekly/i }));
    expect(screen.getByText(/not a reliability guarantee, and it awards no standing credit/i)).toBeInTheDocument();
  });
});
