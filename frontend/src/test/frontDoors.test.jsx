import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FrontDoorsPage from "@/pages/nearby/FrontDoorsPage";
import { nearbyAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  nearbyAPI: { frontDoors: vi.fn(), list: vi.fn() },
  apiError: (_error, fallback) => fallback,
}));

const door = (over = {}) => ({
  id: "d1", name: "Achieng Stores", handle: "achieng_o", distance_km: 0.4,
  offers: { goods: 2, service: 1 }, titles: ["Tomatoes", "Haircut"], lat: 0, lng: 0, ...over,
});
const payload = (over = {}) => ({
  anchor: "you", reason: null, radius_km: 3, total: 1, front_doors: [door()], ...over,
});

const renderPage = () => render(<MemoryRouter><FrontDoorsPage /></MemoryRouter>);

describe("Open front doors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists nearby people with what they offer, linked to their profile", async () => {
    nearbyAPI.frontDoors.mockResolvedValue({ data: payload() });
    renderPage();
    expect(await screen.findByText("Achieng Stores")).toBeInTheDocument();
    expect(screen.getByText("0.4 km")).toBeInTheDocument();
    expect(screen.getByText("2 goods · 1 services")).toBeInTheDocument();
    expect(screen.getByText("Tomatoes, Haircut")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Achieng Stores/ })).toHaveAttribute("href", "/@achieng_o");
  });

  it("never shows a phone number", async () => {
    nearbyAPI.frontDoors.mockResolvedValue({ data: payload({ front_doors: [door({ phone: "+254700000123" })] }) });
    renderPage();
    await screen.findByText("Achieng Stores");
    expect(screen.queryByText(/254700000123/)).toBeNull();
  });

  it("filters by what is offered and asks the server for that kind", async () => {
    nearbyAPI.frontDoors.mockResolvedValue({ data: payload() });
    renderPage();
    await screen.findByText("Achieng Stores");
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    await waitFor(() =>
      expect(nearbyAPI.frontDoors).toHaveBeenLastCalledWith({ kind: "service", radius_km: 3 })
    );
    expect(screen.getByRole("button", { name: "Services" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says when nobody is open nearby", async () => {
    nearbyAPI.frontDoors.mockResolvedValue({ data: payload({ front_doors: [], total: 0 }) });
    renderPage();
    expect(await screen.findByText("No open front doors nearby")).toBeInTheDocument();
  });

  it("asks for a location instead of pretending when there is none", async () => {
    nearbyAPI.frontDoors.mockResolvedValue({ data: payload({ anchor: null, reason: "no_location", front_doors: [], total: 0 }) });
    renderPage();
    expect(await screen.findByText("Set your location first")).toBeInTheDocument();
  });

  it("reports a failed load and can retry", async () => {
    nearbyAPI.frontDoors.mockRejectedValueOnce(new Error("down"));
    nearbyAPI.frontDoors.mockResolvedValueOnce({ data: payload() });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load nearby front doors");
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("Achieng Stores")).toBeInTheDocument();
  });
});
