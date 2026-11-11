import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DeskPage from "@/pages/desk/DeskPage";
import { validateOffering, buildPayload, emptyForm, photoLinks } from "@/components/desk/offeringRules";
import { offeringsAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  offeringsAPI: { mine: vi.fn(), of: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn() },
  workersAPI: { mine: vi.fn(() => Promise.resolve({ data: { items: [] } })), assignments: vi.fn(() => Promise.resolve({ data: { items: [] } })), assign: vi.fn(), start: vi.fn(), complete: vi.fn(), cancel: vi.fn(), reassign: vi.fn() },
  officeAPI: { mine: vi.fn(() => Promise.resolve({ data: { offices: [] } })) },
  apiError: (_e, fallback) => fallback,
}));
vi.mock("@/components/ui/Toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const item = (over = {}) => ({
  kind: "service", id: "s1", title: "Hair braiding", category: null, price: 800, price_unit: "per visit",
  available: true, status: "active", price_mode: "fixed", description: null, service_radius_km: 5,
  photos: [], quantity: null, ...over,
});
const body = (items = []) => ({ items, counts: { goods: 0, service: 0, tool: 0 } });
const renderDesk = () => render(<MemoryRouter><DeskPage /></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); window.confirm = vi.fn(() => true); });

describe("offering rules (mirror the backend)", () => {
  it("a fixed price needs an amount", () => {
    const errs = validateOffering({ ...emptyForm(), title: "Tea", price_mode: "fixed", price: "" }, "goods");
    expect(errs.price).toMatch(/fixed price needs an amount/);
  });
  it("ask me sends no price and needs none", () => {
    const f = { ...emptyForm(), title: "Tea", price_mode: "ask_me", price: "99" };
    expect(validateOffering(f, "goods")).toEqual({});
    expect(buildPayload(f, "goods")).not.toHaveProperty("price");
  });
  it("radius is 1 to 500 and not allowed on goods", () => {
    expect(validateOffering({ ...emptyForm(), title: "Tea", price: "5", service_radius_km: "0" }, "service").service_radius_km)
      .toBeTruthy();
    expect(validateOffering({ ...emptyForm(), title: "Tea", price: "5", service_radius_km: "600" }, "tool").service_radius_km)
      .toBeTruthy();
    expect(buildPayload({ ...emptyForm(), title: "Tea", price: "5" }, "goods")).not.toHaveProperty("service_radius_km");
  });
  it("photos must be https links, at most 8", () => {
    expect(validateOffering({ ...emptyForm(), title: "Tea", price: "5", photos: "http://a/b.jpg" }, "goods").photos)
      .toMatch(/https/);
    const nine = Array.from({ length: 9 }, (_, i) => `https://x/${i}.jpg`).join("\n");
    expect(validateOffering({ ...emptyForm(), title: "Tea", price: "5", photos: nine }, "goods").photos).toMatch(/At most 8/);
    expect(photoLinks("  https://a/1.jpg \n\n https://a/2.jpg ")).toEqual(["https://a/1.jpg", "https://a/2.jpg"]);
  });
  it("a tool needs a category", () => {
    expect(validateOffering({ ...emptyForm(), title: "Stall", price: "5" }, "tool").category).toBeTruthy();
  });
});

describe("my desk lifecycle", () => {
  it("shows the price mode: ask me instead of a number", async () => {
    offeringsAPI.mine.mockResolvedValue({ data: body([item({ kind: "goods", id: "g", title: "Mangoes", price: null, price_mode: "ask_me", quantity: 0, available: false })]) });
    renderDesk();
    expect(await screen.findByText(/Ask me for the price/)).toBeInTheDocument();
  });

  it("pause calls the backend and reloads", async () => {
    offeringsAPI.mine.mockResolvedValue({ data: body([item()]) });
    offeringsAPI.setStatus.mockResolvedValue({ data: item({ status: "paused" }) });
    renderDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(offeringsAPI.setStatus).toHaveBeenCalledWith("service", "s1", "pause"));
    await waitFor(() => expect(offeringsAPI.mine).toHaveBeenCalledTimes(2));
  });

  it("a paused offer shows Resume, and archive asks first", async () => {
    offeringsAPI.mine.mockResolvedValue({ data: body([item({ status: "paused" })]) });
    offeringsAPI.setStatus.mockResolvedValue({ data: item({ status: "archived" }) });
    renderDesk();
    expect(await screen.findByText("Paused")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(offeringsAPI.setStatus).toHaveBeenCalledWith("service", "s1", "resume"));
    offeringsAPI.setStatus.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(offeringsAPI.setStatus).toHaveBeenCalledWith("service", "s1", "archive"));
    expect(window.confirm).toHaveBeenCalled();
  });

  it("archive does nothing when the person cancels", async () => {
    offeringsAPI.mine.mockResolvedValue({ data: body([item()]) });
    window.confirm = vi.fn(() => false);
    renderDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    expect(offeringsAPI.setStatus).not.toHaveBeenCalled();
  });

  it("the add form sends a create request with the chosen kind", async () => {
    offeringsAPI.mine.mockResolvedValue({ data: body() });
    offeringsAPI.create.mockResolvedValue({ data: item() });
    renderDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Add an offering" }));
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Mango crate" } });
    fireEvent.change(screen.getByLabelText(/Price \(KES\)/), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to my desk" }));
    await waitFor(() => expect(offeringsAPI.create).toHaveBeenCalledTimes(1));
    const [sent] = offeringsAPI.create.mock.calls[0];
    expect(sent).toMatchObject({ kind: "goods", title: "Mango crate", price: 1200, price_mode: "fixed" });
  });

  it("the form blocks a fixed price with no amount and sends nothing", async () => {
    offeringsAPI.mine.mockResolvedValue({ data: body() });
    renderDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Add an offering" }));
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Mango crate" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to my desk" }));
    expect(await screen.findByText(/fixed price needs an amount/)).toBeInTheDocument();
    expect(offeringsAPI.create).not.toHaveBeenCalled();
  });

  it("show archived asks the backend for archived items", async () => {
    offeringsAPI.mine.mockResolvedValue({ data: body() });
    renderDesk();
    await screen.findByText("Nothing offered yet");
    fireEvent.click(screen.getByLabelText("Show archived"));
    await waitFor(() => expect(offeringsAPI.mine).toHaveBeenLastCalledWith({ include_archived: true }));
  });
});
