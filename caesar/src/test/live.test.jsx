/**
 * THE DOOR TO THE NETWORK.
 *
 * Caesar can run against the seeded network in this browser or against the
 * Brief backend. This file exercises the second mode the only way that counts:
 * through the interface, with `fetch` stubbed at the edge, so what is being
 * tested is the wiring and the honesty around it rather than a mock of it.
 *
 * The behaviours here are the ones that fail quietly in a real client:
 *
 *   · the server's sentence is shown, not a generic "something went wrong";
 *   · a dead token signs the person out instead of leaving every screen broken;
 *   · a network that never answered is not reported as a refusal;
 *   · the pressed button comes from the server's `my_reaction`, so a reload does
 *     not lose what you did;
 *   · and demo mode never calls `fetch` at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "@/App.jsx";
import { useApp } from "@/store/appStore.js";
import { useSession } from "@/store/session.js";
import { useLive, api } from "@/store/live.js";
import { createApi, ApiError } from "@/lib/api.js";
import { toEntry, toEntries } from "@/lib/liveFeed.js";
import { resetStore } from "./helpers.js";

const ACCOUNT = {
  id: "b0000000-0000-4000-8000-000000000001",
  handle: "asha",
  display_name: "Asha Otieno",
  city: "Kisumu",
  locale: "en",
  vendor_id: null,
  created_at: "2026-10-01T08:00:00Z",
};

const POST = {
  id: "p0000000-0000-4000-8000-000000000001",
  circle_id: "c0000000-0000-4000-8000-000000000001",
  body: "Tomatoes at Kondele are 80 shillings this morning, not 120.",
  lang: "en",
  image_url: null,
  data_kb: 2,
  status: "published",
  created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  author: { id: "b0000000-0000-4000-8000-000000000002", handle: "juma", display_name: "Juma Odhiambo", city: "Kisumu" },
};

const FEED_ROW = {
  post: POST,
  score: 0.742,
  raised_by_floor: false,
  parts: { confidence: 0.61, participation: 0.43, recency: 0.89, circle: 1 },
  verdict: {
    up: 34,
    down: 3,
    participation: 37,
    confidence: 0.61,
    dissent_share: 0.08,
    contested: false,
    needs_more_voices: false,
    coordination: { suspected: false, count: 0, total: 37, share: 0 },
  },
  my_reaction: "up",
  circle_following: true,
};

/** A fetch that answers from a table of routes and records what was asked. */
function stubFetch(routes = {}) {
  const calls = [];
  const impl = vi.fn(async (url, init = {}) => {
    const method = init.method || "GET";
    const path = String(url);
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const key = `${method} ${path}`;
    const handler = routes[key] ?? routes[path] ?? routes["*"];
    if (!handler) return json({ detail: `No stub for ${key}` }, 500);
    return typeof handler === "function" ? handler(init) : json(handler);
  });
  globalThis.fetch = impl;
  return { impl, calls };
}

function json(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

/** Let any in-flight reload land inside act(), so the run stays quiet. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function mount(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </MemoryRouter>
  );
}

/** Put the app in live mode with a feed already in hand. */
function enterLive({ entries = [toEntry(FEED_ROW)], circles = [] } = {}) {
  useSession.setState({ mode: "live", token: "token-abc", account: ACCOUNT, notice: null });
  useLive.setState({ entries, circles, status: "ready", error: null, notice: null });
}

beforeEach(() => {
  resetStore();
  useSession.setState({ mode: "local", token: null, account: null, notice: null });
  useLive.setState({
    entries: [],
    circles: [],
    blocks: [],
    mutes: [],
    people: {},
    reports: [],
    status: "idle",
    error: null,
    notice: null,
    lastLoadedAt: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe("the API client", () => {
  it("keeps the server's sentence when a request is refused", async () => {
    stubFetch({ "POST /api/social/posts/x/reactions": () => json({ detail: "You cannot react to your own post." }, 400) });
    const client = createApi({ getToken: () => "t" });
    await expect(client.react("x", "up")).rejects.toMatchObject({
      status: 400,
      message: "You cannot react to your own post.",
    });
  });

  it("tells a dead connection apart from a refusal", async () => {
    const client = createApi({
      getToken: () => "t",
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const error = await client.feed().catch((thrown) => thrown);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.offline).toBe(true);
  });

  it("turns a validation error into something a person can read", async () => {
    stubFetch({
      "POST /api/social/accounts": () => json({ detail: [{ msg: "String should have at least 3 characters" }] }, 422),
    });
    const client = createApi({ getToken: () => null });
    await expect(client.register({ handle: "ab", display_name: "A" })).rejects.toThrow(/at least 3 characters/);
  });

  it("sends the bearer token only on the routes that need one", async () => {
    const { calls } = stubFetch({ "POST /api/social/accounts": { account: ACCOUNT, access_token: "new" } });
    const client = createApi({ getToken: () => "token-abc" });
    await client.register({ handle: "asha", display_name: "Asha" });
    expect(calls[0].headers.Authorization).toBeUndefined();

    const { calls: authed } = stubFetch({ "GET /api/social/me": { account: ACCOUNT, linked_to_vendor: false } });
    await createApi({ getToken: () => "token-abc" }).me();
    expect(authed[0].headers.Authorization).toBe("Bearer token-abc");
  });
});

describe("the adapter", () => {
  it("keeps every number the server sent and invents none", () => {
    const entry = toEntry(FEED_ROW);
    expect(entry.score).toBe(0.742);
    expect(entry.parts).toEqual(FEED_ROW.parts);
    expect(entry.verdict.up).toBe(34);
    expect(entry.verdict.confidence).toBe(0.61);
    expect(entry.post.authorId).toBe(POST.author.id);
  });

  it("carries this reader's own reaction, so a reload does not lose it", () => {
    expect(toEntry(FEED_ROW).viewerReaction).toBe("up");
    expect(toEntry({ ...FEED_ROW, my_reaction: null }).viewerReaction).toBeNull();
  });

  it("explains a contested post in the same words the demo uses", () => {
    const contested = toEntry({
      ...FEED_ROW,
      verdict: { ...FEED_ROW.verdict, down: 20, participation: 40, contested: true, dissent_share: 0.5, confidence: 0.31 },
    });
    expect(contested.why.tone).toBe("terra");
    expect(contested.why.text).toMatch(/dissent never hides a post/i);
  });

  it("drops a malformed row instead of rendering an empty card", () => {
    expect(toEntries([FEED_ROW, { post: POST }, null, { verdict: FEED_ROW.verdict }])).toHaveLength(1);
  });
});

describe("the live feed", () => {
  it("renders the server's rows, its score and its verdict", async () => {
    enterLive();
    stubFetch({ "GET /api/social/circles": [] });
    mount();

    const card = screen.getByTestId(`post-${POST.id}`);
    expect(within(card).getByText(POST.body)).toBeInTheDocument();
    expect(within(card).getByText("Juma Odhiambo")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /support — 34 so far/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getAllByText(/61%/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("feed-source")).toHaveTextContent("Live · @asha");
    await settle();
  });

  it("does not call the network at all in demo mode", async () => {
    const fetchSpy = vi.fn(async () => json({}));
    globalThis.fetch = fetchSpy;
    mount();
    await waitFor(() => expect(screen.getByTestId("feed-source")).toHaveTextContent("Demo network"));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getAllByTestId(/^post-/).length).toBeGreaterThan(0);
  });

  it("sends a reaction and then re-reads the ranked feed", async () => {
    const { calls } = stubFetch({
      "POST /api/social/posts/p0000000-0000-4000-8000-000000000001/reactions": { my_reaction: "down", up: 34, down: 4, participation: 38 },
      "GET /api/social/feed?limit=50": [
        { ...FEED_ROW, my_reaction: "down", verdict: { ...FEED_ROW.verdict, down: 4, participation: 38 } },
      ],
      "GET /api/social/circles": [],
    });
    enterLive();
    mount();

    const card = screen.getByTestId(`post-${POST.id}`);
    fireEvent.click(within(card).getByRole("button", { name: /disagree/i }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.path.endsWith("/reactions"))).toBe(true));
    expect(calls.find((call) => call.method === "POST").body).toEqual({ value: "down" });
    // Authoritative re-read: the score on the card is the one the server recomputed.
    await waitFor(() =>
      expect(within(screen.getByTestId(`post-${POST.id}`)).getByRole("button", { name: /disagree — 4 so far/i })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    );
    await settle();
  });

  it("withdraws instead of doubling a reaction you already gave", async () => {
    const { calls } = stubFetch({
      "DELETE /api/social/posts/p0000000-0000-4000-8000-000000000001/reactions": { my_reaction: null, up: 33, down: 3, participation: 36 },
      "GET /api/social/feed?limit=50": [{ ...FEED_ROW, my_reaction: null }],
      "GET /api/social/circles": [],
    });
    enterLive();
    mount();

    const card = screen.getByTestId(`post-${POST.id}`);
    fireEvent.click(within(card).getByRole("button", { name: /support/i }));

    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
    await settle();
  });

  it("shows the server's refusal instead of pretending the reaction landed", async () => {
    stubFetch({
      "POST /api/social/posts/p0000000-0000-4000-8000-000000000001/reactions": () =>
        json({ detail: "You cannot react to your own post. Ask someone else." }, 400),
      "GET /api/social/circles": [],
    });
    enterLive();
    mount();

    // A *new* value, so this is a POST rather than a withdrawal.
    fireEvent.click(within(screen.getByTestId(`post-${POST.id}`)).getByRole("button", { name: /disagree/i }));

    // The server's sentence is what the person reads — as a toast, verbatim.
    await waitFor(() => expect(screen.getByText("You cannot react to your own post. Ask someone else.")).toBeInTheDocument());
    // Optimism rolled back: the button is not left pressed.
    expect(within(screen.getByTestId(`post-${POST.id}`)).getByRole("button", { name: /disagree/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    await settle();
  });

  it("signs a dead session out rather than failing on every screen", async () => {
    stubFetch({ "GET /api/social/feed?limit=50": () => json({ detail: "Sign in to take part." }, 401) });
    useSession.setState({ mode: "live", token: "expired", account: ACCOUNT, notice: null });
    useLive.setState({ entries: [], circles: [], status: "idle" });

    await useLive.getState().load();

    expect(useSession.getState().mode).toBe("local");
    expect(useSession.getState().token).toBeNull();
    expect(useSession.getState().notice).toMatch(/session ended/i);
  });

  it("reports a network that never answered as unreachable, not as a refusal", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    useSession.setState({ mode: "live", token: "t", account: ACCOUNT });
    useLive.setState({ entries: [], circles: [], status: "idle" });

    await useLive.getState().load();
    expect(useLive.getState().error).toBe("offline");
    expect(useSession.getState().mode).toBe("live");
  });
});

describe("the live safety centre", () => {
  it("lists the server's cases and names the accounts you blocked", async () => {
    useSession.setState({ mode: "live", token: "t", account: ACCOUNT, notice: null });
    useLive.setState({
      entries: [],
      circles: [],
      reports: [
        {
          id: "r1",
          post_id: POST.id,
          reason: "spam",
          status: "received",
          case_number: "C-1A2B3C4D",
          created_at: new Date().toISOString(),
        },
      ],
      blocks: ["b0000000-0000-4000-8000-000000000002"],
      mutes: [],
      people: { "b0000000-0000-4000-8000-000000000002": { id: "b0", handle: "juma", display_name: "Juma Odhiambo", city: "Kisumu" } },
      status: "ready",
    });
    stubFetch({
      "GET /api/social/reports": [
        {
          id: "r1",
          post_id: POST.id,
          reason: "spam",
          status: "received",
          case_number: "C-1A2B3C4D",
          created_at: new Date().toISOString(),
        },
      ],
      "GET /api/social/blocks?kind=block": [
        {
          id: "x",
          target_id: "b0000000-0000-4000-8000-000000000002",
          kind: "block",
          created_at: new Date().toISOString(),
          target: { id: "b0000000-0000-4000-8000-000000000002", handle: "juma", display_name: "Juma Odhiambo", city: "Kisumu" },
        },
      ],
      "GET /api/social/blocks?kind=mute": [],
    });

    mount("/safety");

    await waitFor(() => expect(screen.getByText(/C-1A2B3C4D/)).toBeInTheDocument());
    expect(screen.getByText("Juma Odhiambo")).toBeInTheDocument();
    await settle();
  });
});
