/**
 * CAESAR THE GUIDE, AND THE PARK.
 *
 * The guide's whole claim is that it is honest: it says whether a suggestion was
 * learned or read off the shelf map, and it says nothing at all when it has
 * nothing to say. The park's whole claim is that the leash decides the name —
 * and that the boundary is visible before you knock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const api = vi.hoisted(() => ({
  next: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  feed: vi.fn(),
  join: vi.fn(),
  setLeash: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  guideAPI: { next: api.next },
  parksAPI: {
    list: api.list,
    get: api.get,
    feed: api.feed,
    join: api.join,
    setLeash: api.setLeash,
    post: api.post,
  },
}));

const { default: CaesarGuide } = await import("@/components/guide/CaesarGuide");
const { ParksPage, ParkDetailPage } = await import("@/pages/parks/ParksPage");

beforeEach(() => {
  vi.clearAllMocks();
});

const DECLARED = {
  data: {
    from: "stock",
    basis: "declared",
    why: "Not enough navigation data yet to learn this, so this is the shelf map.",
    suggestions: [
      { shelf: "markets", label: "Markets", blurb: "Physical markets", to: "/browse?type=markets" },
      { shelf: "people", label: "People", blurb: "Who to work with", to: "/browse?type=people" },
    ],
  },
};

const OBSERVED = {
  data: {
    from: "stock",
    basis: "observed",
    why: "From 25 visits in the last 60 days.",
    suggestions: [{ shelf: "notices", label: "Notices", blurb: "25 of 25 next taps from here", to: "/browse?type=notices" }],
  },
};

describe("Caesar the guide", () => {
  it("says where the idea came from when it is the shelf map", async () => {
    api.next.mockResolvedValue(DECLARED);
    render(
      <MemoryRouter>
        <CaesarGuide from="stock" />
      </MemoryRouter>
    );
    const nav = await screen.findByTestId("caesar-guide");
    expect(nav).toHaveAttribute("data-basis", "declared");
    expect(screen.getByText("the shelf map")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /markets/i })).toHaveAttribute("href", "/browse?type=markets");
  });

  it("says how many next taps produced a learned suggestion", async () => {
    api.next.mockResolvedValue(OBSERVED);
    render(
      <MemoryRouter>
        <CaesarGuide from="stock" />
      </MemoryRouter>
    );
    expect(await screen.findByTestId("caesar-guide")).toHaveAttribute("data-basis", "observed");
    expect(screen.getByText(/learned from 25 visits/)).toBeInTheDocument();
  });

  it("renders nothing rather than an error when the guide cannot answer", async () => {
    api.next.mockRejectedValue(new Error("offline"));
    const { container } = render(
      <MemoryRouter>
        <CaesarGuide from="stock" />
      </MemoryRouter>
    );
    await waitFor(() => expect(api.next).toHaveBeenCalled());
    expect(screen.queryByTestId("caesar-guide")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no suggestion, which is a legitimate answer", async () => {
    api.next.mockResolvedValue({ data: { basis: "none", suggestions: [] } });
    const { container } = render(
      <MemoryRouter>
        <CaesarGuide from="stock" />
      </MemoryRouter>
    );
    await waitFor(() => expect(api.next).toHaveBeenCalledWith("stock"));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Caesar Park", () => {
  const PARK = {
    id: "p1",
    slug: "kondele",
    name: "Kondele",
    kind: "place",
    bounded_by: "Kondele",
    radius_km: 2,
    entry_rule: "open",
    description: "The estate park.",
    rules: ["Disagreement is not misconduct."],
    members: 12,
    my_membership: null,
  };

  it("shows the boundary, the gate and the rules before you knock", async () => {
    api.list.mockResolvedValue({ data: { parks: [PARK], count: 1 } });
    render(
      <MemoryRouter>
        <ParksPage />
      </MemoryRouter>
    );

    const card = await screen.findByTestId("park-card");
    expect(card).toHaveTextContent("Kondele");
    expect(card).toHaveTextContent("2 km");
    expect(card).toHaveTextContent(/walk in/i);
    expect(card).toHaveTextContent("Disagreement is not misconduct.");
    expect(screen.getByRole("button", { name: /walk in/i })).toBeInTheDocument();
  });

  it("says 'Knock' for a park that has to let you in", async () => {
    api.list.mockResolvedValue({
      data: { parks: [{ ...PARK, entry_rule: "ask", slug: "nyalenda", name: "Nyalenda" }] },
    });
    render(
      <MemoryRouter>
        <ParksPage />
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: /knock/i })).toBeInTheDocument();
    expect(screen.getByTestId("park-card")).toHaveTextContent(/knock — the warden/i);
  });

  it("joins off-leash by default and says so", async () => {
    api.list.mockResolvedValue({ data: { parks: [PARK] } });
    api.join.mockResolvedValue({ data: { status: "member" } });
    render(
      <MemoryRouter>
        <ParksPage />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole("button", { name: /walk in/i }));
    await waitFor(() => expect(api.join).toHaveBeenCalledWith("kondele", "off"));
  });

  it("shows the name you are wearing, and lets you change it", async () => {
    api.get.mockResolvedValue({ data: { ...PARK, my_membership: { status: "member", leash: "off" } } });
    api.feed.mockResolvedValue({ data: { posts: [] } });
    api.setLeash.mockResolvedValue({ data: { leash: "on" } });

    render(
      <MemoryRouter initialEntries={["/parks/kondele"]}>
        <Routes>
          <Route path="/parks/:slug" element={<ParkDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/here as a neighbour/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /put my shop name on/i }));
    await waitFor(() => expect(api.setLeash).toHaveBeenCalledWith("kondele", "on"));
  });

  it("attributes an off-leash post to the handle and an on-leash post to the shop", async () => {
    api.get.mockResolvedValue({ data: { ...PARK, my_membership: { status: "member", leash: "off" } } });
    api.feed.mockResolvedValue({
      data: {
        posts: [
          {
            id: "1",
            body: "Water is off again.",
            leash: "off",
            author: { handle: "achieng", display_name: "Achieng", business: null, vendor_handle: null },
          },
          {
            id: "2",
            body: "Taking orders.",
            leash: "on",
            author: { handle: "achieng", display_name: "Achieng", business: "Achieng Tailors", vendor_handle: "achieng" },
          },
        ],
      },
    });

    render(
      <MemoryRouter initialEntries={["/parks/kondele"]}>
        <Routes>
          <Route path="/parks/:slug" element={<ParkDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("Water is off again.");
    // Post 1 is off-leash: only the handle. Post 2 is on-leash: shop name plus
    // the handle beside it — so the handle appears twice, the shop name once.
    expect(screen.getAllByText("@achieng")).toHaveLength(2);
    expect(screen.getByText("Achieng Tailors")).toBeInTheDocument();
    expect(screen.getByText("off-leash")).toBeInTheDocument();
  });
});
