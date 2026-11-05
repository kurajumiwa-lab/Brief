import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import BookPage from "@/pages/calendar/BookPage";
import CalendarPage from "@/pages/calendar/CalendarPage";
import { dayKey, mondayOf, timeRange, toDayString, toLocalStamp } from "@/pages/calendar/calendarTime";
import { scheduleAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  scheduleAPI: {
    vendorServices: vi.fn(), slots: vi.fn(), book: vi.fn(),
    week: vi.fn(), addEntry: vi.fn(), updateEntry: vi.fn(), deleteEntry: vi.fn(),
    services: vi.fn(), addService: vi.fn(), updateService: vi.fn(),
    availability: vi.fn(), setAvailability: vi.fn(), appointments: vi.fn(), setAppointmentStatus: vi.fn(),
  },
  apiError: (_e, fallback) => fallback,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (sel) => sel({ vendor: { id: "me-1" } }),
}));

describe("calendar time helpers", () => {
  it("keeps stored wall-clock times exactly as they are", () => {
    expect(timeRange("2026-11-11T09:00:00", "2026-11-11T09:30:00")).toBe("09:00–09:30");
    expect(dayKey("2026-11-11T09:00:00")).toBe("2026-11-11");
    expect(toLocalStamp("2026-11-11", "14:05")).toBe("2026-11-11T14:05:00");
  });

  it("finds the Monday of any week", () => {
    // 2026-11-04 is a Wednesday; its week starts Monday 2026-11-02.
    expect(toDayString(mondayOf(new Date(2026, 10, 4)))).toBe("2026-11-02");
    // A Sunday belongs to the week that started six days earlier.
    expect(toDayString(mondayOf(new Date(2026, 10, 8)))).toBe("2026-11-02");
  });
});

describe("BookPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleAPI.vendorServices.mockResolvedValue({
      data: { services: [{ id: "s1", name: "Hair trim", duration_minutes: 30, price_kes: 500, is_active: true }] },
    });
    scheduleAPI.slots.mockResolvedValue({ data: { slots: ["2026-11-11T09:00:00", "2026-11-11T09:40:00"] } });
    scheduleAPI.book.mockResolvedValue({
      data: { service: "Hair trim", starts_at: "2026-11-11T09:00:00", status: "requested" },
    });
  });

  const renderPage = () => render(
    <MemoryRouter initialEntries={["/book/host-9"]}>
      <Routes><Route path="/book/:vendorId" element={<BookPage />} /></Routes>
    </MemoryRouter>,
  );

  it("shows services, then free times, then asks for the client's name before booking", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Hair trim/ }));
    const slot = await screen.findByRole("button", { name: "09:40" });
    fireEvent.click(slot);
    expect(scheduleAPI.slots).toHaveBeenCalledWith("host-9", "s1", expect.any(String));
    const submit = await screen.findByRole("button", { name: "Request this time" });
    fireEvent.click(submit);
    expect(await screen.findByText(/Your name/)).toBeTruthy();
    expect(scheduleAPI.book).not.toHaveBeenCalled();
  });

  it("books the chosen time and confirms the request was sent", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Hair trim/ }));
    fireEvent.click(await screen.findByRole("button", { name: "09:00" }));
    const name = await screen.findByLabelText(/Your name/);
    fireEvent.change(name, { target: { value: "Amina" } });
    fireEvent.click(screen.getByRole("button", { name: "Request this time" }));
    await waitFor(() => expect(scheduleAPI.book).toHaveBeenCalledWith(expect.objectContaining({
      host_vendor_id: "host-9", service_id: "s1", starts_at: "2026-11-11T09:00:00", client_name: "Amina",
    })));
    expect(await screen.findByText("Request sent")).toBeTruthy();
  });
});

describe("CalendarPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleAPI.week.mockResolvedValue({
      data: {
        start: "2026-11-02T00:00:00", end: "2026-11-09T00:00:00", conflicts: [],
        items: [{ id: "p1", source: "plan", kind: "task", title: "Restock shelves", starts_at: "2026-11-04T09:00:00",
          ends_at: "2026-11-04T10:00:00", status: "planned", location: null, editable: true }],
      },
    });
  });

  it("shows the week, its plans, and the three tabs", async () => {
    render(<MemoryRouter><CalendarPage /></MemoryRouter>);
    expect(await screen.findByText("Restock shelves")).toBeTruthy();
    expect(screen.getByText("Appointments")).toBeTruthy();
    expect(screen.getByText("Booking page")).toBeTruthy();
    expect(scheduleAPI.week).toHaveBeenCalled();
  });
});
