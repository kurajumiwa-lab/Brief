import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ConversationOutcome from "@/components/market/ConversationOutcome";

const api = vi.hoisted(() => ({ conversation: vi.fn(), confirmSale: vi.fn(), withdrawSale: vi.fn() }));
vi.mock("@/lib/api", () => ({ marketOpportunitiesAPI: api, apiError: (_e, fallback) => fallback }));
const record = { title: "Beans", my_role: "buyer", has_enquiry: true, buyer_confirmed: false, seller_confirmed: false };
beforeEach(() => { vi.clearAllMocks(); api.conversation.mockResolvedValue({ data: record }); });
it("requires an explicit sale report and lets the user withdraw it", async () => {
  api.confirmSale.mockResolvedValue({ data: { ...record, buyer_confirmed: true } });
  api.withdrawSale.mockResolvedValue({ data: record });
  render(<ConversationOutcome roomId="room-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Report a completed sale" }));
  expect(await screen.findByText(/waiting for the other participant/)).toBeInTheDocument();
  expect(api.confirmSale).toHaveBeenCalledWith("room-1");
  fireEvent.click(screen.getByRole("button", { name: "Withdraw my sale report" }));
  await waitFor(() => expect(api.withdrawSale).toHaveBeenCalledWith("room-1"));
  expect(await screen.findByText(/No sale reported/)).toBeInTheDocument();
});
it("shows mutual reports without calling them proof of payment", async () => {
  api.conversation.mockResolvedValue({ data: { ...record, buyer_confirmed: true, seller_confirmed: true } });
  render(<ConversationOutcome roomId="room-1" />);
  expect(await screen.findByText(/Both participants reported a sale/)).toHaveTextContent("not proof of payment or delivery");
});
