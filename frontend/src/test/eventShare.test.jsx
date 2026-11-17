import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import EventShareRedirect from "@/pages/events/EventShareRedirect";

const resolveShare = vi.fn();
vi.mock("@/lib/api", () => ({ eventAPI: { resolveShare: (...args) => resolveShare(...args) } }));
function open() {
  render(<MemoryRouter initialEntries={["/e/trip"]}><Routes>
    <Route path="/e/:slug" element={<EventShareRedirect />} />
    <Route path="/events" element={<div>Event detail opened</div>} />
    <Route path="/activities/:id" element={<div>Bulk buy opened</div>} />
  </Routes></MemoryRouter>);
}
describe("event share links", () => {
  it("opens the event detail", async () => {
    resolveShare.mockResolvedValueOnce({ data: { id: "123", kind: "event" } });
    open(); expect(await screen.findByText("Event detail opened")).toBeInTheDocument();
    expect(resolveShare).toHaveBeenCalledWith("trip");
  });
  it("opens the bulk buy activity", async () => {
    resolveShare.mockResolvedValueOnce({ data: { id: "456", kind: "bulk_buy" } });
    open(); expect(await screen.findByText("Bulk buy opened")).toBeInTheDocument();
  });
  it("shows an error instead of claiming an event exists", async () => {
    resolveShare.mockRejectedValueOnce({ response: { status: 404 } });
    open(); expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
  });
});
