import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mine: vi.fn(),
  publish: vi.fn().mockResolvedValue({ data: {} }),
  markShared: vi.fn().mockResolvedValue({ data: {} }),
  open: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  recurringRoutineAPI: {
    mine: mocks.mine,
    create: vi.fn().mockImplementation((body) => Promise.resolve({ data: { id: "r2", ...body } })),
    update: vi.fn(),
    remove: vi.fn(),
    publish: mocks.publish,
    markShared: mocks.markShared,
  },
  apiError: (_error, fallback) => fallback,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) => selector({ vendor: { vendor_handle: "achieng", physical_location: "Kisumu" } }),
}));

vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import RoutinesPage from "@/pages/routines/RoutinesPage";

function payload() {
  return {
    routines: [
      {
        id: "r1",
        kind: "scheduled",
        title: "Nairobi → Kisumu Saturday deliveries",
        region_slug: "nyanza",
        town: "Kisumu",
        day_of_week: 6,
        day_label: "Saturday",
        recurrence_label: "Weekly • Every Sat",
        start_time_local: "08:00",
        duration_hours: 6,
        publish_lead_hours: 48,
        is_active: true,
        last_generated_for_date: "2026-11-21",
        template: { price_kes: 500, capacity: 12, has_payment_tag: true },
      },
    ],
    share_prompts: [
      {
        instance_id: "i1",
        routine_id: "r1",
        activity_id: "a1",
        occurrence_date: "2026-11-21",
        title: "Nairobi → Kisumu Saturday deliveries",
        share_path: "/activities/a1",
        shared_at: null,
        share_text: "Nairobi → Kisumu Saturday deliveries — Sat 21 Nov in Kisumu. This week's round is live; message me to book.",
      },
    ],
  };
}

describe("recurring routines page", () => {
  it("shows the Weekly • Every Sat pill and a one-tap WhatsApp share", async () => {
    mocks.mine.mockResolvedValue({ data: payload() });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.stubGlobal("open", mocks.open);
    render(<MemoryRouter><RoutinesPage /></MemoryRouter>);

    expect(await screen.findByText("Weekly • Every Sat")).toBeInTheDocument();
    expect(screen.getByText(/Last published for 2026-11-21/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /whatsapp/i }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalled());
    expect(mocks.open.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(mocks.markShared).toHaveBeenCalledWith("i1");
  });

  it("reveals the Mon–Sun selector only while Repeat Weekly is on", async () => {
    mocks.mine.mockResolvedValue({ data: payload() });
    render(<MemoryRouter><RoutinesPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: /^new$/i }));
    const toggle = screen.getByRole("switch", { name: /repeat weekly/i });
    expect(toggle).toBeChecked();
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(screen.getByRole("button", { name: day })).toBeInTheDocument();
    }

    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: "Mon" })).not.toBeInTheDocument();
    expect(screen.getByText(/A one-off is posted from/i)).toBeInTheDocument();
  });

  it("says the weekly badge is a schedule, not a reliability guarantee", async () => {
    mocks.mine.mockResolvedValue({ data: payload() });
    render(<MemoryRouter><RoutinesPage /></MemoryRouter>);
    expect(await screen.findByText(/not a reliability guarantee and awards no standing credit/i)).toBeInTheDocument();
  });
});
