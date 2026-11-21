import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PageEditor from "@/pages/page/PageEditor";

const page = {
  tagline: "Home nursing, booked same day",
  about: "We visit you.",
  show_offers: true,
  show_hours: true,
  show_credentials: true,
  display_name: "Amina Nursing",
  phone: "0700000000",
  town: "Kisumu",
  preset: "service",
  discoverable: true,
  show_whatsapp: false,
  payment_type: "",
  payment_number: "",
  payment_account: "",
};

const mocks = vi.hoisted(() => ({
  myPage: vi.fn(),
  savePage: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  professionalAPI: { myPage: mocks.myPage, savePage: mocks.savePage },
  vendorAPI: { profile: vi.fn().mockResolvedValue({ data: {} }) },
  apiError: (_e, fallback) => fallback,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) =>
    selector
      ? selector({ vendor: { vendor_handle: "amina", id: "v1" }, setVendor: vi.fn() })
      : { vendor: { vendor_handle: "amina", id: "v1" } },
}));

vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/regions/RegionsGrid", () => ({
  RegionCard: () => <div data-testid="region-card" />,
}));

const renderEditor = () =>
  render(
    <MemoryRouter>
      <PageEditor />
    </MemoryRouter>,
  );

describe("the page editor's one save", () => {
  it("puts the save in a bar that is always on screen", async () => {
    mocks.myPage.mockResolvedValue({ data: page });
    renderEditor();
    const bar = await screen.findByTestId("page-save-bar");
    expect(bar.className).toContain("fixed");
    expect(bar.contains(screen.getByTestId("page-save"))).toBe(true);
  });

  it("says plainly when there is nothing to save", async () => {
    mocks.myPage.mockResolvedValue({ data: page });
    renderEditor();
    expect(await screen.findByText("All changes saved")).toBeInTheDocument();
    expect(screen.getByTestId("page-save")).toBeDisabled();
  });

  it("admits the moment a change is unsaved, so nobody hunts for the button", async () => {
    mocks.myPage.mockResolvedValue({ data: page });
    renderEditor();
    const phone = await screen.findByDisplayValue("0700000000");
    fireEvent.change(phone, { target: { value: "0711111111" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByTestId("page-save")).toBeEnabled();
  });

  it("saves from the bar and goes back to clean", async () => {
    mocks.myPage.mockResolvedValue({ data: page });
    mocks.savePage.mockResolvedValue({ data: { ...page, phone: "0711111111" } });
    renderEditor();
    const phone = await screen.findByDisplayValue("0700000000");
    fireEvent.change(phone, { target: { value: "0711111111" } });
    fireEvent.click(screen.getByTestId("page-save"));
    await waitFor(() => expect(mocks.savePage).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("All changes saved")).toBeInTheDocument());
  });

  it("answers 'who can see this' in words before it offers a switch", async () => {
    mocks.myPage.mockResolvedValue({ data: page });
    renderEditor();
    const card = await screen.findByTestId("page-visibility");
    expect(card).toHaveTextContent(/Anyone with the link/i);
    expect(card).toHaveTextContent(/People browsing Regions/i);
    expect(card).toHaveTextContent(/never turns off/i);
  });

  it("says the discovery switch is off in words a person can act on", async () => {
    mocks.myPage.mockResolvedValue({ data: { ...page, discoverable: false } });
    renderEditor();
    const card = await screen.findByTestId("page-visibility");
    expect(card).toHaveTextContent(/Not in Regions/i);
    expect(card).toHaveTextContent(/only the direct link works/i);
  });

  it("marks the discovery toggle as its own immediate save, and keeps the bar clean", async () => {
    mocks.myPage.mockResolvedValue({ data: page });
    mocks.savePage.mockResolvedValue({ data: { ...page, discoverable: false } });
    renderEditor();
    const toggle = await screen.findByTestId("page-discoverable");
    fireEvent.click(toggle);
    expect(screen.getByText(/Saves the moment you tick it/i)).toBeInTheDocument();
    await waitFor(() => expect(mocks.savePage).toHaveBeenCalledWith({ discoverable: false }));
    // an instant save must not leave the bar claiming there is more to save
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });
});
