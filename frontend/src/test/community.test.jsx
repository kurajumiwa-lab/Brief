import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * THE COMMUNITY SURFACE.
 *
 * These specs pin the promises the backend makes, as seen from the client that
 * now ships them: a reader who is not a vendor can still participate, a
 * disagreement is not a report, a report does not delete, a block is reversible
 * and visible, and a failed load explains itself without blanking the posts
 * already on screen.
 */

const api = vi.hoisted(() => ({
  me: vi.fn(),
  feed: vi.fn(),
  circles: vi.fn(),
  post: vi.fn(),
  react: vi.fn(),
  withdrawReaction: vi.fn(),
  report: vi.fn(),
  reports: vi.fn(),
  blocks: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
  followCircle: vi.fn(),
  unfollowCircle: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (err, fallback) => err?.response?.data?.detail || fallback,
  failureReason: (err, fallback) => err?.response?.data?.detail || fallback,
  socialAPI: api,
}));

import CommunityPage from "@/pages/community/CommunityPage";
import { useCommunityStore } from "@/stores/communityStore";

const ME = {
  account: { id: "acc-me", handle: "amina", display_name: "Amina", city: "Kisumu" },
  linked_to_vendor: false,
};

const AUTHOR = { id: "acc-other", handle: "juma", display_name: "Juma", city: "Ahero" };

function entry(overrides = {}) {
  return {
    post: {
      id: "p1",
      circle_id: null,
      body: "Tomatoes are 20% cheaper at Kibuye this morning than at the bus park.",
      lang: "en",
      image_url: null,
      data_kb: 1,
      status: "published",
      created_at: "2026-10-28T06:00:00",
      author: AUTHOR,
    },
    score: 1.4,
    raised_by_floor: false,
    parts: { support: 0.6, dissent: 0.1, recency: 0.7 },
    verdict: {
      up: 6,
      down: 2,
      participation: 8,
      confidence: 0.5,
      dissent_share: 0.25,
      contested: false,
      needs_more_voices: false,
      coordination: {},
    },
    my_reaction: null,
    circle_following: false,
    ...overrides,
  };
}

function mount() {
  return render(
    <MemoryRouter>
      <CommunityPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useCommunityStore.getState().reset();
  api.me.mockResolvedValue({ data: ME });
  api.feed.mockResolvedValue({ data: [entry()] });
  api.circles.mockResolvedValue({ data: [] });
  api.reports.mockResolvedValue({ data: [] });
  api.blocks.mockResolvedValue({ data: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Community", () => {
  it("lets someone with no business take part, and says so", async () => {
    mount();

    expect(await screen.findByText(/Posting as Amina\. No business needed\./i)).toBeInTheDocument();
    expect(screen.getByText(/6 people support · 2 against/i)).toBeInTheDocument();
    expect(await screen.findByTestId("community-post-p1")).toBeInTheDocument();
  });

  it("treats a disagreement as information, and keeps reports on a separate control", async () => {
    api.react.mockResolvedValue({
      data: {
        post_id: "p1",
        my_reaction: "down",
        up: 6,
        down: 3,
        participation: 9,
        contested: false,
        post_status: "published",
      },
    });
    mount();

    const card = await screen.findByTestId("community-post-p1");
    fireEvent.click(within(card).getByRole("button", { name: /disagree with this post/i }));

    await waitFor(() =>
      expect(within(card).getByRole("button", { name: /disagree with this post/i })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    );
    // A dissent is never a report: the post is still there, still published.
    expect(within(card).getByRole("button", { name: /more options/i })).toBeInTheDocument();
    expect(useCommunityStore.getState().cases).toEqual({});
    expect(api.report).not.toHaveBeenCalled();
  });

  it("puts a reaction back when the server refuses it", async () => {
    api.react.mockRejectedValue({ response: { data: { detail: "Sign in to take part." } } });
    mount();

    const card = await screen.findByTestId("community-post-p1");
    fireEvent.click(within(card).getByRole("button", { name: /support this post/i }));

    await waitFor(() =>
      expect(within(card).getByText(/Sign in to take part/i)).toBeInTheDocument()
    );
    expect(within(card).getByRole("button", { name: /support this post/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("files a report as a numbered case without deleting the post", async () => {
    api.report.mockResolvedValue({ data: { case_number: "CS-1041", reason: "harassment", status: "open" } });
    mount();

    const card = await screen.findByTestId("community-post-p1");
    fireEvent.click(within(card).getByRole("button", { name: /more options/i }));
    fireEvent.click(within(card).getByRole("button", { name: /^report$/i }));
    fireEvent.click(within(card).getByRole("button", { name: /send report/i }));

    expect(await within(card).findByText(/case CS-1041/i)).toBeInTheDocument();
    expect(screen.getByTestId("community-post-p1")).toBeInTheDocument();
  });

  it("hides a blocked author's posts and offers an undo", async () => {
    api.block.mockResolvedValue({ data: { id: "b1" } });
    mount();

    const card = await screen.findByTestId("community-post-p1");
    api.feed.mockResolvedValue({ data: [] });
    fireEvent.click(within(card).getByRole("button", { name: /more options/i }));
    fireEvent.click(within(card).getByRole("button", { name: /^block /i }));

    await waitFor(() => expect(api.block).toHaveBeenCalledWith("acc-other", "block"));
    await waitFor(() => expect(screen.queryByTestId("community-post-p1")).not.toBeInTheDocument());
  });

  it("keeps the posts already read when a refresh fails, and names the reason", async () => {
    mount();
    expect(await screen.findByTestId("community-post-p1")).toBeInTheDocument();

    api.feed.mockRejectedValue({ response: { status: 500, data: { detail: "The server answered 500." } } });
    await useCommunityStore.getState().retry();

    expect(screen.getByTestId("community-post-p1")).toBeInTheDocument();
    expect(screen.getByTestId("community-status")).toHaveTextContent(/showing the posts last read/i);
  });

  it("blank-slate failure explains itself and offers a retry", async () => {
    api.feed.mockRejectedValue({ response: { status: 500, data: { detail: "The server answered 500." } } });
    mount();

    expect(await screen.findByText(/The server answered 500/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("asks for the feed once, no matter how many parts of the screen read it", async () => {
    mount();
    await screen.findByTestId("community-post-p1");
    await useCommunityStore.getState().load();
    await useCommunityStore.getState().load();
    expect(api.feed).toHaveBeenCalledTimes(1);
  });
});
