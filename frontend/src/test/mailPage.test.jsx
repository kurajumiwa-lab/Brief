import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MailPage, { groupConversations } from "@/pages/mail/MailPage";
import { chatAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  chatAPI: { rooms: vi.fn() },
  apiError: (_e, fallback) => fallback,
}));

const room = (over = {}) => ({
  id: "r1", name: "Tomatoes", room_type: "direct", topic: null, topic_tags: [],
  participants: [], joined: true, ...over,
});

const renderPage = () => render(<MemoryRouter><MailPage /></MemoryRouter>);

describe("groupConversations (pure)", () => {
  it("groups by room type in display order and drops rooms I have not joined", () => {
    const rooms = [
      room({ id: "a", room_type: "niche", name: "Import rules" }),
      room({ id: "b", room_type: "direct", name: "Amina" }),
      room({ id: "c", room_type: "deal", name: "Deal · Maize" }),
      room({ id: "d", room_type: "direct", name: "Hidden", joined: false }),
    ];
    const out = groupConversations(rooms);
    expect(out.map(([t]) => t)).toEqual(["direct", "deal", "niche"]);
    expect(out[0][1].map((r) => r.id)).toEqual(["b"]);
  });

  it("filters by name, topic and tag, case-insensitively", () => {
    const rooms = [
      room({ id: "a", name: "Amina" }),
      room({ id: "b", name: "Other", topic: "Solar panels", topic_tags: ["energy"] }),
    ];
    expect(groupConversations(rooms, "AMINA").flatMap(([, l]) => l.map((r) => r.id))).toEqual(["a"]);
    expect(groupConversations(rooms, "solar").flatMap(([, l]) => l.map((r) => r.id))).toEqual(["b"]);
    expect(groupConversations(rooms, "energy").flatMap(([, l]) => l.map((r) => r.id))).toEqual(["b"]);
    expect(groupConversations(rooms, "nothing")).toEqual([]);
  });
});

describe("Mail page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks only for the rooms I am in", async () => {
    chatAPI.rooms.mockResolvedValue({ data: [] });
    renderPage();
    await screen.findByText("No conversations yet");
    expect(chatAPI.rooms).toHaveBeenCalledWith({ mine_only: true });
  });

  it("lists conversations under their type headings, each linking to its thread", async () => {
    chatAPI.rooms.mockResolvedValue({
      data: [
        room({ id: "r-direct", name: "Amina", participants: [{ id: "v2", vendor_handle: "amina", business_name: "Amina Stores" }] }),
        room({ id: "r-group", room_type: "group", name: "Kisumu traders" }),
      ],
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: /Direct \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Groups \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Amina/ })).toHaveAttribute("href", "/chat?room=r-direct");
    expect(screen.getByRole("link", { name: /Kisumu traders/ })).toHaveAttribute("href", "/chat?room=r-group");
    expect(screen.getByText(/With Amina Stores/)).toBeInTheDocument();
  });

  it("filters the list as I type", async () => {
    chatAPI.rooms.mockResolvedValue({ data: [room({ id: "a", name: "Amina" }), room({ id: "b", name: "Otieno" })] });
    renderPage();
    await screen.findByRole("link", { name: /Amina/ });
    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "otieno" } });
    expect(screen.queryByRole("link", { name: /Amina/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Otieno/ })).toBeInTheDocument();
  });

  it("says so when the search matches nothing", async () => {
    chatAPI.rooms.mockResolvedValue({ data: [room({ name: "Amina" })] });
    renderPage();
    await screen.findByRole("link", { name: /Amina/ });
    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "zzz" } });
    expect(screen.getByText(/No conversations match/)).toBeInTheDocument();
  });

  it("shows an error with a retry that reloads", async () => {
    chatAPI.rooms.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ data: [room({ name: "Amina" })] });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your conversations.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("link", { name: /Amina/ })).toBeInTheDocument());
  });
});
