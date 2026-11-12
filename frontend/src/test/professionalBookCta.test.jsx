import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/config/flags", async (orig) => ({
  ...(await orig()),
  SERVICE_PROFILES_ENABLED: true,
}));

const service = (id, name) => ({
  id, name, duration_minutes: 30, price_kes: null, price_mode: null, price_unit: null,
  delivery: ["home"], domain: "healthcare_care", domain_label: "Healthcare & Care",
});

const card = (services) => ({
  handle: "nurse-achieng", location: "Kisumu", services, hours: [], registrations: [],
  completed_appointments: 0,
});

describe("Book Service CTA on the professional card", () => {
  it("links one bookable service straight to the booking page", async () => {
    const { default: ProfessionalCard } = await import("@/components/professional/ProfessionalCard");
    render(
      <MemoryRouter>
        <ProfessionalCard card={card([service("svc-1", "Home nursing visit")])} vendorId="v-9" canBook />
      </MemoryRouter>
    );
    const link = screen.getByRole("link", { name: /book service/i });
    expect(link).toHaveAttribute("href", "/book/v-9?service=svc-1");
  });

  it("opens the booking page without a service when there are several", async () => {
    const { default: ProfessionalCard } = await import("@/components/professional/ProfessionalCard");
    render(
      <MemoryRouter>
        <ProfessionalCard card={card([service("svc-1", "A"), service("svc-2", "B")])} vendorId="v-9" canBook />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: /book service/i })).toHaveAttribute("href", "/book/v-9");
  });

  it("shows no button on the owner's own profile, or with no services", async () => {
    const { default: ProfessionalCard } = await import("@/components/professional/ProfessionalCard");
    const { unmount } = render(
      <MemoryRouter>
        <ProfessionalCard card={card([service("svc-1", "A")])} vendorId="v-9" canBook={false} />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: /book service/i })).toBeNull();
    unmount();
    render(
      <MemoryRouter>
        <ProfessionalCard card={card([])} vendorId="v-9" canBook />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: /book service/i })).toBeNull();
  });
});

describe("bookingHref", () => {
  it("returns null without a vendor id", async () => {
    const { bookingHref } = await import("@/components/professional/ProfessionalCard");
    expect(bookingHref({ vendorId: undefined, services: [service("s", "x")] })).toBeNull();
  });
});

describe("BookPage opens on the service named in ?service=", () => {
  it("preselects the service from the link", async () => {
    vi.resetModules();
    vi.doMock("@/lib/api", () => ({
      scheduleAPI: {
        vendorServices: vi.fn(async () => ({ data: { services: [service("svc-1", "Home nursing visit"), service("svc-2", "Clinic check")] } })),
        slots: vi.fn(async () => ({ data: { slots: [] } })),
      },
      apiError: (_e, fallback) => fallback,
    }));
    vi.doMock("@/stores/authStore", () => ({ useAuthStore: (sel) => sel({ vendor: null }) }));
    const { default: BookPage } = await import("@/pages/calendar/BookPage");
    render(
      <MemoryRouter initialEntries={["/book/v-9?service=svc-2"]}>
        <Routes>
          <Route path="/book/:vendorId" element={<BookPage />} />
        </Routes>
      </MemoryRouter>
    );
    // The chosen service's slots request fires with its id.
    const { scheduleAPI } = await import("@/lib/api");
    await vi.waitFor(() => expect(scheduleAPI.slots).toHaveBeenCalledWith("v-9", "svc-2", expect.any(String)));
    vi.doUnmock("@/lib/api");
  });
});
