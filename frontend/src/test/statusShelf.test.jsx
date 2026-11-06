import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { statusesAPI, fileAPI } from "@/lib/api";
import StatusShelf from "@/components/statuses/StatusShelf";
import StatusViewer from "@/components/statuses/StatusViewer";
import StatusComposer from "@/components/statuses/StatusComposer";
import RadarStrip from "@/components/statuses/RadarStrip";
import { ringClass, initialOf, errorText, agoText, leftText } from "@/components/statuses/statusCore";
import HomeHub from "@/pages/home/HomeHub";
import { vendorAPI, routineAPI, ordersAPI } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal()),
  statusesAPI: {
    feed: vi.fn(), mine: vi.fn(), radar: vi.fn(), suggestions: vi.fn(), following: vi.fn(),
    post: vi.fn(), remove: vi.fn(), view: vi.fn(), viewers: vi.fn(),
    followState: vi.fn(), follow: vi.fn(), unfollow: vi.fn(),
  },
  fileAPI: { upload: vi.fn() },
  vendorAPI: { profile: vi.fn(), connections: vi.fn(), update: vi.fn(), updateProfile: vi.fn() },
  routineAPI: { today: vi.fn() },
  ordersAPI: { records: vi.fn() },
}));

const auth = { vendor: null };
vi.mock("@/stores/authStore", () => ({ useAuthStore: (sel) => sel({ vendor: auth.vendor }) }));

const stock = { mine: [], movements: [], mineLoaded: true, fetchMine: vi.fn() };
vi.mock("@/stores/stockStore", () => ({ useStockStore: (sel) => sel(stock) }));

const ME = { id: "me-1", vendor_handle: "amina", business_name: "Amina Stores", business_categories: ["shop"] };
const SHOP = { id: "sh-1", handle: "maize", business_name: "Maize Hub" };
const TEA = { id: "tea-1", handle: "tea", business_name: "Tea Corner" };

const status = (over = {}) => ({
  id: "s1", kind: "text", body: "Fresh maize in", media_url: null,
  created_at: new Date(Date.now() - 3600_000).toISOString(),
  expires_at: new Date(Date.now() + 23 * 3600_000).toISOString(),
  viewed: false, ...over,
});

function mockShelf({ groups = [], mine = [], suggestions = [], radar = {} } = {}) {
  statusesAPI.feed.mockResolvedValue({ data: { groups } });
  statusesAPI.mine.mockResolvedValue({ data: { statuses: mine } });
  statusesAPI.suggestions.mockResolvedValue({ data: { businesses: suggestions } });
  statusesAPI.radar.mockResolvedValue({
    data: { unseen_statuses: 0, unseen_businesses: 0, unread_trade: 0, unread_follows: 0, unread_total: 0, ...radar },
  });
  statusesAPI.view.mockResolvedValue({ data: { viewed: true, new: true } });
  statusesAPI.viewers.mockResolvedValue({ data: { viewers: [] } });
  statusesAPI.follow.mockResolvedValue({ data: { following: true, created: true } });
  statusesAPI.unfollow.mockResolvedValue({ data: { following: false, removed: true } });
  statusesAPI.post.mockResolvedValue({ data: { id: "new", expires_at: "x" } });
  statusesAPI.remove.mockResolvedValue({ data: { removed: true } });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.vendor = { ...ME };
  stock.mine = [];
  stock.movements = [];
});

// ---------- the rules shown to people --------------------------------------------------

describe("rings and small helpers", () => {
  it("unseen statuses get a coloured ring; seen statuses get a muted ring", () => {
    expect(ringClass({ unseen: true })).toContain("ring-brand-500");
    expect(ringClass({ unseen: false })).toContain("ring-edge-2");
    expect(ringClass({ unseen: false })).not.toContain("brand");
  });

  it("initials and plain-language times", () => {
    expect(initialOf("maize hub")).toBe("M");
    expect(initialOf("")).toBe("?");
    const now = Date.parse("2026-11-06T12:00:00Z");
    expect(agoText("2026-11-06T11:00:00Z", now)).toBe("1 h ago");
    expect(agoText("2026-11-06T11:30:00Z", now)).toBe("30 min ago");
    expect(agoText("2026-11-06T11:59:50Z", now)).toBe("just now");
    expect(leftText("2026-11-07T10:00:00Z", now)).toBe("22 h left");
    expect(leftText("2026-11-06T12:30:00Z", now)).toBe("30 min left");
  });

  it("uses the backend's reason when there is one", () => {
    const err = { response: { data: { detail: "Video statuses are not switched on yet." } } };
    expect(errorText(err)).toBe("Video statuses are not switched on yet.");
    expect(errorText(new Error("network"), "Try again.")).toBe("Try again.");
  });
});

// ---------- the shelf ---------------------------------------------------------------------

describe("status shelf", () => {
  it("renders nothing when there is nothing to show and nothing to suggest", async () => {
    mockShelf();
    render(<StatusShelf />);
    await waitFor(() => expect(statusesAPI.feed).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Status shelf" })).toBeNull();
    expect(screen.queryByText(/Follow a business to see its updates/)).toBeNull();
  });

  it("shows followed businesses, unseen before seen, each with its ring", async () => {
    mockShelf({
      groups: [
        { vendor: TEA, statuses: [status({ id: "t1" })], latest_at: "x", unseen: false },
        { vendor: SHOP, statuses: [status({ id: "m1" })], latest_at: "y", unseen: true },
      ],
    });
    render(<StatusShelf />);
    const unseen = await screen.findByRole("button", { name: "Maize Hub, new statuses" });
    const seen = screen.getByRole("button", { name: "Tea Corner, seen statuses" });
    expect(unseen.querySelector("span.rounded-full").className).toContain("ring-brand-500");
    expect(seen.querySelector("span.rounded-full").className).toContain("ring-edge-2");
  });

  it("empty state: suggests businesses to follow, and following removes the suggestion", async () => {
    mockShelf({ suggestions: [{ ...SHOP, vendor_id: SHOP.id, categories: [], live_statuses: 2 }] });
    // like the backend: once followed, the business is no longer suggested
    statusesAPI.follow.mockImplementation(async () => {
      statusesAPI.suggestions.mockResolvedValue({ data: { businesses: [] } });
      return { data: { following: true, created: true } };
    });
    render(<StatusShelf />);
    expect(await screen.findByText("Follow a business to see its updates here")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Follow Maize Hub" }));
    await waitFor(() => expect(statusesAPI.follow).toHaveBeenCalledWith(SHOP.id));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Follow Maize Hub" })).toBeNull());
  });

  it("the 'Your status' tile always opens the composer", async () => {
    mockShelf({ groups: [{ vendor: TEA, statuses: [status()], latest_at: "x", unseen: true }] });
    render(<StatusShelf />);
    fireEvent.click(await screen.findByRole("button", { name: "Add your status" }));
    expect(screen.getByRole("dialog", { name: "Post a status" })).toBeTruthy();
  });

  it("does not render for a signed-out visitor", () => {
    auth.vendor = null;
    const { container } = render(<StatusShelf />);
    expect(container.innerHTML).toBe("");
    expect(statusesAPI.feed).not.toHaveBeenCalled();
  });
});

// ---------- the viewer -----------------------------------------------------------------------

describe("status viewer", () => {
  const group = { vendor: SHOP, statuses: [status({ id: "a" }), status({ id: "b", body: "Second" })], unseen: true };

  it("records a view once per status, for someone else's status", async () => {
    mockShelf();
    render(<StatusViewer group={group} own={false} onClose={() => {}} onUnfollow={() => {}} />);
    await waitFor(() => expect(statusesAPI.view).toHaveBeenCalledWith("a"));
    expect(statusesAPI.view).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Next status" }));
    await waitFor(() => expect(statusesAPI.view).toHaveBeenCalledWith("b"));
    expect(statusesAPI.viewers).not.toHaveBeenCalled();
  });

  it("owner sees who viewed, and never records a view of their own status", async () => {
    mockShelf();
    statusesAPI.viewers.mockResolvedValue({ data: { viewers: [{ vendor_id: "x", business_name: "Maize Hub", handle: "maize", viewed_at: "t" }] } });
    render(<StatusViewer group={{ vendor: ME, statuses: [status({ id: "own" })], unseen: false }} own onClose={() => {}} onDeleted={() => {}} />);
    expect(await screen.findByText(/Viewed by 1: Maize Hub/)).toBeTruthy();
    expect(statusesAPI.view).not.toHaveBeenCalled();
  });

  it("owner can delete a status; the viewer sees no delete button", async () => {
    mockShelf();
    const onDeleted = vi.fn();
    const { unmount } = render(<StatusViewer group={{ vendor: ME, statuses: [status({ id: "own" })], unseen: false }} own onClose={() => {}} onDeleted={onDeleted} />);
    fireEvent.click(await screen.findByRole("button", { name: /Delete this status/ }));
    await waitFor(() => expect(statusesAPI.remove).toHaveBeenCalledWith("own"));
    expect(onDeleted).toHaveBeenCalled();
    unmount();

    render(<StatusViewer group={group} own={false} onClose={() => {}} onUnfollow={() => {}} />);
    expect(screen.queryByRole("button", { name: /Delete this status/ })).toBeNull();
  });

  it("a viewer can unfollow the business from the viewer", async () => {
    mockShelf();
    const onUnfollow = vi.fn();
    render(<StatusViewer group={group} own={false} onClose={() => {}} onUnfollow={onUnfollow} />);
    fireEvent.click(screen.getByRole("button", { name: /Unfollow Maize Hub/ }));
    expect(onUnfollow).toHaveBeenCalled();
  });

  it("closes with Escape", () => {
    mockShelf();
    const onClose = vi.fn();
    render(<StatusViewer group={group} own={false} onClose={onClose} onUnfollow={() => {}} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

// ---------- the composer ---------------------------------------------------------------------

describe("status composer", () => {
  it("posts text as the business, with no media", async () => {
    mockShelf();
    const onPosted = vi.fn();
    render(<StatusComposer onClose={() => {}} onPosted={onPosted} />);
    fireEvent.change(screen.getByLabelText("Status text"), { target: { value: "  Fresh maize  " } });
    fireEvent.click(screen.getByRole("button", { name: "Post status" }));
    await waitFor(() => expect(statusesAPI.post).toHaveBeenCalledWith({ kind: "text", body: "Fresh maize", media_url: null }));
    expect(onPosted).toHaveBeenCalled();
  });

  it("will not post an empty text status", () => {
    mockShelf();
    render(<StatusComposer onClose={() => {}} onPosted={() => {}} />);
    expect(screen.getByRole("button", { name: "Post status" }).disabled).toBe(true);
  });

  it("uploads a photo through the normal upload and posts its URL", async () => {
    mockShelf();
    fileAPI.upload.mockResolvedValue({ data: { url: "/static/status/shop.jpg" } });
    render(<StatusComposer onClose={() => {}} onPosted={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Photo/ }));
    const file = new File(["x"], "shop.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Choose a photo"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("Chosen: shop.jpg")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Post status" }));
    await waitFor(() => expect(statusesAPI.post).toHaveBeenCalledWith({ kind: "photo", body: null, media_url: "/static/status/shop.jpg" }));
  });

  it("video is not offered while the video flag is off", () => {
    mockShelf();
    render(<StatusComposer onClose={() => {}} onPosted={() => {}} />);
    expect(screen.queryByRole("radio", { name: /Video/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Text/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Photo/ })).toBeTruthy();
  });

  it("shows the backend's plain reason when posting fails", async () => {
    mockShelf();
    statusesAPI.post.mockRejectedValue({ response: { data: { detail: "A text status cannot carry a picture or video." } } });
    render(<StatusComposer onClose={() => {}} onPosted={() => {}} />);
    fireEvent.change(screen.getByLabelText("Status text"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Post status" }));
    expect((await screen.findByRole("alert")).textContent).toContain("cannot carry a picture");
  });

  it("caps text at 500 characters and shows the count", () => {
    mockShelf();
    render(<StatusComposer onClose={() => {}} onPosted={() => {}} />);
    const box = screen.getByLabelText("Status text");
    expect(box.getAttribute("maxlength")).toBe("500");
    fireEvent.change(box, { target: { value: "abc" } });
    expect(screen.getByText("3/500")).toBeTruthy();
  });
});

// ---------- the radar -------------------------------------------------------------------------

describe("radar", () => {
  it("is hidden when everything is zero", async () => {
    mockShelf();
    const { container } = render(<MemoryRouter><RadarStrip /></MemoryRouter>);
    await waitFor(() => expect(statusesAPI.radar).toHaveBeenCalled());
    expect(container.querySelector("nav[aria-label='Radar']")).toBeNull();
  });

  it("counts new updates, trades and followers, and links the trade and follow counts", async () => {
    mockShelf({ radar: { unseen_statuses: 3, unseen_businesses: 2, unread_trade: 1, unread_follows: 2 } });
    render(<MemoryRouter><RadarStrip /></MemoryRouter>);
    expect(await screen.findByText("3 new updates from 2 businesses")).toBeTruthy();
    expect(screen.getByRole("link", { name: "1 trade needs you" }).getAttribute("href")).toBe("/orders?needs=me");
    expect(screen.getByRole("link", { name: "2 new followers" }).getAttribute("href")).toBe("/activity");
  });

  it("reading the radar never marks anything seen", async () => {
    mockShelf({ radar: { unseen_statuses: 1, unseen_businesses: 1 } });
    render(<MemoryRouter><RadarStrip /></MemoryRouter>);
    await screen.findByText("1 new update from 1 business");
    expect(statusesAPI.view).not.toHaveBeenCalled();
  });
});

// ---------- Home ------------------------------------------------------------------------------

describe("Home with statuses", () => {
  beforeEach(() => {
    vendorAPI.profile.mockResolvedValue({ data: { portfolio_images: [] } });
    vendorAPI.connections.mockResolvedValue({ data: [] });
    routineAPI.today.mockResolvedValue({ data: { date: "2026-11-06", dots: 0, items: [] } });
    ordersAPI.records.mockResolvedValue({ data: { summary: { recorded: 0, needs_action: 0 }, items: [] } });
  });

  it("puts the shelf and radar in the header section and keeps the existing sections", async () => {
    mockShelf({
      groups: [{ vendor: SHOP, statuses: [status()], latest_at: "x", unseen: true }],
      radar: { unseen_statuses: 1, unseen_businesses: 1 },
    });
    render(<MemoryRouter><HomeHub /></MemoryRouter>);
    expect(await screen.findByRole("region", { name: "Status shelf" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Radar" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Find suppliers, goods and offers in Discovery/ })).toBeTruthy();
    // no fifth section appeared: the status shelf is not a heading of its own
    expect(screen.queryByRole("heading", { name: /status/i })).toBeNull();
  });

  it("a shop with no follows and no statuses shows no shelf and no radar", async () => {
    mockShelf();
    render(<MemoryRouter><HomeHub /></MemoryRouter>);
    await screen.findByRole("heading", { name: /Welcome, Amina Stores/ });
    await waitFor(() => expect(statusesAPI.suggestions).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Status shelf" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Radar" })).toBeNull();
  });
});
