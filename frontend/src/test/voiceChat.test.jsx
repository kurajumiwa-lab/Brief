import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VoiceNote from "@/components/chat/VoiceNote";
import { chatAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  chatAPI: { voice: vi.fn() },
  apiError: (_error, fallback) => fallback,
}));

const message = {
  id: "message-1",
  room_id: "room-1",
  message_type: "voice",
  attachments: [{ kind: "voice", duration_seconds: 8, size_bytes: 24500 }],
};

describe("voice notes in chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatAPI.voice.mockResolvedValue({ data: new Blob(["audio"], { type: "audio/webm" }) });
  });

  it("does not fetch audio until the vendor taps to load it", async () => {
    const { container } = render(<VoiceNote message={message} mine={false} />);
    expect(chatAPI.voice).not.toHaveBeenCalled();
    expect(screen.getByText("Load voice note")).toBeInTheDocument();
    expect(screen.getByText("8s · 24 KB · tap to download")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Load voice note/ }));
    await waitFor(() => expect(chatAPI.voice).toHaveBeenCalledWith("room-1", "message-1"));
    await waitFor(() => expect(container.querySelector("audio")).toHaveAttribute("src", "blob:mock"));
  });
});
