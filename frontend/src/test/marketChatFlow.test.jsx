import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ChatPage from "@/pages/chat/ChatPage";

const mocks = vi.hoisted(() => {
  const room = { id: "r1", name: "Seller", room_type: "direct", joined: true, participant_count: 2, participants: [] };
  return { room, send: vi.fn().mockResolvedValue({ id: "m1" }), fetchRooms: vi.fn().mockResolvedValue(), leaveRoom: vi.fn(), loadIdentity: vi.fn().mockResolvedValue(), selectRoom: vi.fn() };
});
vi.mock("@/lib/api", () => ({ chatAPI: {}, stockAPI: {}, marketOpportunitiesAPI: { conversation: vi.fn().mockRejectedValue({ response: { status: 404 } }) }, apiError: (_e, fallback) => fallback }));
vi.mock("@/stores/chatStore", () => ({ useChatStore: (selector) => {
  const state = { rooms: [mocks.room], activeRoom: mocks.room, messages: [], loading: false, sending: false, live: false, chatIdentity: {}, ...mocks };
  return selector ? selector(state) : state;
} }));
vi.mock("@/stores/stockStore", () => ({ useStockStore: (selector) => selector({ mine: [], fetchMine: vi.fn() }) }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: (selector) => selector({ vendor: { id: "buyer" } }) }));
vi.mock("@/components/chat/RoomList", () => ({ default: () => null }));
vi.mock("@/components/chat/ChatIdentityModal", () => ({ default: () => null, resolveIdentityDisplay: () => ({}) }));

it("carries a draft through ChatPage into the editable composer without sending it", async () => {
  render(<MemoryRouter initialEntries={[{ pathname: "/chat", search: "?room=r1", state: { opportunityDraft: { roomId: "r1", text: "Is the Busia offer still available?" } } }]}><Routes><Route path="/chat" element={<ChatPage />} /></Routes></MemoryRouter>);
  const input = await screen.findByRole("textbox", { name: "Message" });
  expect(input).toHaveValue("Is the Busia offer still available?");
  expect(mocks.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ message_type: "text", content: "Is the Busia offer still available?" }));
});
