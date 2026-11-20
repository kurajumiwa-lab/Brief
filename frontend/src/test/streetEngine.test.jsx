import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ now: vi.fn(), join: vi.fn(), create: vi.fn(), leave: vi.fn(), close: vi.fn() }));

vi.mock("@/lib/api", () => ({
  streetAPI: {
    now: mocks.now,
    join: mocks.join,
    create: mocks.create,
    leave: mocks.leave,
    close: mocks.close,
  },
  apiError: (_error, fallback) => fallback,
}));

vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) => selector({ vendor: { physical_location: "Kondele, Kisumu" } }),
}));

import StreetPage from "@/pages/street/StreetPage";

const HOST = { handle: "amina", business: "Amina Stores", verified: true, account_kind: "business" };

function lobby(over = {}) {
  return {
    id: "lobby-1", title: "Two bags of maize flour before noon", intent: "co_buy",
    intent_label: "Co-buy", details: "Split a 50 kg bag at the stage.", zone: "Kondele, Kisumu",
    tags: ["food"], seats: 3, joined_count: 1, remaining: 2, status: "open",
    minutes_left: 55, host: HOST, is_mine: false, joined: false, can_join: true,
    match_score: 73, match_reasons: ["Same zone"], contact_hidden: true,
    verification_code: null, ...over,
  };
}

function payload(lobbies = [lobby()]) {
  return {
    calendar: {
      season: {
        key: "festive_push", chapter: "Season 4", label: "Festive Market Push", week: 9,
        days_left: 41, focus: "End-year gifting and event tables.", prompt: "Name the item.",
        accent: "#E8552F", progress_pct: 68,
      },
      today: {
        key: "wednesday_match", zone_label: "Wednesday · 12:00", state: "live",
        title: "Two people need the same thing.", detail: "Open a two-hour table.",
        cta: "Open a table", href: "/street?open=1", official: true,
        broadcast_at: "2026-11-25T12:00:00+03:00",
      },
      upcoming: [{
        key: "thursday_pool", at: "2026-11-26T16:00:00+03:00", title: "Pool tomorrow's run.",
        zone_label: "Thursday · 16:00", label: "Pool the run", cta: "Find a run", href: "/logistics",
      }],
      timetable: [], pulse: { active: null },
    },
    guide: {
      persona: { name: "Mtaa", role: "Your street guide", line: "Afternoon. One table." },
      level: 2, completed: 2, total: 5, progress_pct: 40, season_points: 55,
      next_chapter: { title: "Set a weekly rhythm", body: "Repeat one slot.", cta: "Set a routine", href: "/routines" },
      next_actions: [{ kind: "table", eyebrow: "Live now", title: "2 tables open now", detail: "See the zone.", cta: "See open tables", href: "/street" }],
    },
    lobbies: {
      lobbies,
      counts: { open: lobbies.length, matching: lobbies.length, joined: 0 },
      note: "A table is an introduction with an expiry.",
    },
  };
}

function renderStreet() {
  return render(<MemoryRouter initialEntries={["/street"]}><StreetPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.now.mockResolvedValue({ data: payload() });
  mocks.join.mockResolvedValue({
    data: {
      joined: true,
      already: false,
      handoff: {
        channel: "whatsapp", label: "Open WhatsApp", code: "A1B2C3",
        url: "https://wa.me/254712345678?text=A1B2C3",
        share_text: "Brief table A1B2C3",
        note: "Brief does not send this message or hold any payment.",
      },
    },
  });
  mocks.create.mockResolvedValue({ data: {} });
  mocks.leave.mockResolvedValue({ data: {} });
  mocks.close.mockResolvedValue({ data: {} });
});

describe("the street engine", () => {
  it("opens with the season, today's script and the live tables", async () => {
    renderStreet();
    expect(await screen.findByTestId("street-page")).toBeInTheDocument();
    expect(screen.getByTestId("street-season")).toHaveTextContent("Festive Market Push");
    expect(screen.getByTestId("street-today")).toHaveTextContent("Two people need the same thing");
    expect(screen.getByTestId("street-today")).toHaveTextContent("Official broadcast");
    expect(screen.getByTestId("street-lobby-lobby-1")).toHaveTextContent("Two bags of maize flour");
    expect(screen.getByTestId("street-guide")).toHaveTextContent("2 of 5 chapters");
    expect(screen.getByTestId("street-guide")).toHaveTextContent("Mtaa");
  });

  it("joins a table and shows the verification code and WhatsApp handoff", async () => {
    renderStreet();
    fireEvent.click(await screen.findByRole("button", { name: /take a seat/i }));
    await waitFor(() => expect(mocks.join).toHaveBeenCalledWith("lobby-1"));
    expect(await screen.findByTestId("street-handoff")).toHaveTextContent("A1B2C3");
    expect(screen.getByRole("link", { name: /open whatsapp/i })).toHaveAttribute(
      "href", "https://wa.me/254712345678?text=A1B2C3",
    );
  });

  it("filters the rail without hiding the table language", async () => {
    const delivery = lobby({
      id: "lobby-2", title: "Rider for one afternoon", intent: "delivery", intent_label: "Delivery",
      match_reasons: ["Almost full"], remaining: 1,
    });
    mocks.now.mockResolvedValue({ data: payload([lobby(), delivery]) });
    renderStreet();
    expect(await screen.findByTestId("street-lobby-lobby-2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delivery" }));
    expect(screen.queryByTestId("street-lobby-lobby-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("street-lobby-lobby-2")).toBeInTheDocument();
  });

  it("opens the table form with the person's zone already filled", async () => {
    renderStreet();
    fireEvent.click((await screen.findAllByRole("button", { name: /open a table/i }))[0]);
    expect(await screen.findByTestId("street-lobby-form")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kondele, Kisumu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open the table/i })).toBeInTheDocument();
  });
});
