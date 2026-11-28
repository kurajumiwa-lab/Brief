import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChatInput from "@/components/chat/ChatInput";

vi.mock("@/lib/api", () => ({ stockAPI: {}, apiError: (_e, fallback) => fallback }));
vi.mock("@/stores/chatStore", () => ({ useChatStore: (selector) => selector({ activeRoom: { id: "r1", participants: [] } }) }));
vi.mock("@/stores/stockStore", () => ({ useStockStore: (selector) => selector({ mine: [], fetchMine: vi.fn() }) }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: (selector) => selector({ vendor: { id: "v1" } }) }));

it("lets the buyer review and edit the draft before explicitly sending", async () => {
  const send = vi.fn().mockResolvedValue({ id: "m1" });
  render(<ChatInput initialText="Is the Busia beans offer still available?" onSend={send} />);
  expect(send).not.toHaveBeenCalled();
  const input = screen.getByRole("textbox", { name: "Message" });
  expect(input).toHaveValue("Is the Busia beans offer still available?");
  fireEvent.change(input, { target: { value: "Can I buy two bags?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(send).toHaveBeenCalledWith({ message_type: "text", content: "Can I buy two bags?" }));
  expect(input).toHaveValue("");
});
