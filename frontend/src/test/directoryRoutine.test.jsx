import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import OffersBrowsePage from "@/pages/offers/OffersBrowsePage";
import TodayPage from "@/pages/today/TodayPage";
import BlueprintDetailPage from "@/pages/templates/BlueprintDetailPage";
import { blueprintsAPI, offersPublicAPI, routineAPI } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal()),
  offersPublicAPI: { browse: vi.fn() },
  routineAPI: { today: vi.fn(), catalogue: vi.fn(), setChecks: vi.fn(), done: vi.fn(), undo: vi.fn() },
  blueprintsAPI: { library: vi.fn(), one: vi.fn(), mine: vi.fn(), start: vi.fn(), tick: vi.fn(), untick: vi.fn() },
}));

let signedIn = false;
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (sel) => sel({ vendor: signedIn ? { id: "me" } : null }),
}));

const offer = (over = {}) => ({
  id: "o1", name: "Olive oil", category: "food", unit_price: 900, wholesale_price: 850, unit: "litre",
  quantity_available: 20, min_order_quantity: 1, images: [],
  trust: { level: "new", label: "New on the network" },
  seller: { handle: "oil_co", name: "Oil Co", verified: true }, ...over,
});

describe("open offers page", () => {
  beforeEach(() => { vi.clearAllMocks(); signedIn = false; });

  it("opens with no account and shows each item's trust label", async () => {
    offersPublicAPI.browse.mockResolvedValue({ data: { offers: [
      offer(),
      offer({ id: "o2", name: "Tested soap", trust: { level: "confirmed", label: "Confirmed: traded with another business" } }),
    ] } });
    render(<MemoryRouter><OffersBrowsePage /></MemoryRouter>);
    expect(await screen.findByText("Olive oil")).toBeTruthy();
    expect(screen.getByText("New on the network")).toBeTruthy();
    expect(screen.getByText("Confirmed: traded with another business")).toBeTruthy();
    expect(screen.getByText(/Sign in/)).toBeTruthy();
  });

  it("shows a plain message when nothing matches", async () => {
    offersPublicAPI.browse.mockResolvedValue({ data: { offers: [] } });
    render(<MemoryRouter><OffersBrowsePage /></MemoryRouter>);
    expect(await screen.findByText("Nothing matches yet.")).toBeTruthy();
  });
});

describe("Today window", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const today = {
    date: "2026-11-06", dots: 1,
    items: [
      { key: "stock_out", label: "Sold-out stock", why: "Items with nothing left stop showing.", link: "/stock",
        count: 2, done: false, dot: true, kind: "check" },
      { key: "appointments", label: "Booking requests", why: "Clients are waiting.", link: "/calendar",
        count: 0, done: false, dot: false, kind: "check" },
    ],
  };
  const catalogue = { data: { checks: [
    { key: "stock_out", label: "Sold-out stock", why: "Items with nothing left.", enabled: true },
    { key: "sessions", label: "Sessions coming up", why: "Sessions you signed up for.", enabled: false },
  ] } };

  it("shows a dot only for what is waiting, and marks it done", async () => {
    routineAPI.today.mockResolvedValue({ data: today });
    routineAPI.catalogue.mockResolvedValue(catalogue);
    routineAPI.done.mockResolvedValue({ data: { done: true } });
    render(<MemoryRouter><TodayPage /></MemoryRouter>);
    expect((await screen.findAllByText("Sold-out stock")).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Waiting")).toHaveLength(1);
    expect(screen.getAllByLabelText("Clear")).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Done" })[0]);
    await waitFor(() => expect(routineAPI.done).toHaveBeenCalledWith("stock_out"));
  });

  it("explains a check when asked, and lets the user switch checks on or off", async () => {
    routineAPI.today.mockResolvedValue({ data: today });
    routineAPI.catalogue.mockResolvedValue(catalogue);
    routineAPI.setChecks.mockResolvedValue({ data: catalogue.data });
    render(<MemoryRouter><TodayPage /></MemoryRouter>);
    await screen.findAllByText("Sold-out stock");
    fireEvent.click(screen.getAllByText("Why is this here?")[0]);
    expect(screen.getByText("Items with nothing left stop showing.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Show Sessions coming up in Today"));
    await waitFor(() => expect(routineAPI.setChecks).toHaveBeenCalledWith({ sessions: true }));
  });
});

describe("free template", () => {
  beforeEach(() => { vi.clearAllMocks(); signedIn = false; });

  const bp = {
    key: "home-soap", title: "Home soap maker", sector: "manufacturing", summary: "Make soap.", cost: "Free",
    steps: [{ key: "ingredients", title: "List ingredients", detail: "Write each one." },
            { key: "label", title: "Label each bar", detail: "Name and weight." }],
  };

  const renderAt = () => render(
    <MemoryRouter initialEntries={["/templates/home-soap"]}>
      <Routes><Route path="/templates/:key" element={<BlueprintDetailPage />} /></Routes>
    </MemoryRouter>,
  );

  it("is readable with no account, and offers sign-in instead of start", async () => {
    blueprintsAPI.one.mockResolvedValue({ data: bp });
    renderAt();
    expect(await screen.findByText("Home soap maker")).toBeTruthy();
    expect(screen.getByText("List ingredients")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start this template/ })).toBeNull();
    expect(screen.getByText(/to start and track it/)).toBeTruthy();
  });

  it("starts for a signed-in business and ticks a step", async () => {
    signedIn = true;
    blueprintsAPI.one.mockResolvedValue({ data: bp });
    blueprintsAPI.mine.mockResolvedValue({ data: { started: [] } });
    blueprintsAPI.start.mockResolvedValue({ data: { started: true } });
    renderAt();
    fireEvent.click(await screen.findByRole("button", { name: /Start this template/ }));
    await waitFor(() => expect(blueprintsAPI.start).toHaveBeenCalledWith("home-soap"));
  });
});
