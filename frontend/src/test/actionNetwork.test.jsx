import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ─────────────────────────────────────────────────────────────────────────────
// The business action network, asserted from the client side:
//   · Browse is organised around the four jobs, not around our databases
//   · ONE reusable request flow backs every "the directory can't answer" moment
//   · Work aggregates what is in flight and owns the offer loop
// ─────────────────────────────────────────────────────────────────────────────

const fixtures = vi.hoisted(() => ({
  requests: [
    {
      id: "r-1", request_type: "stock", description: "20 bags of maize flour, wholesale",
      location: "Kisumu market", needed_by: "tomorrow", budget_kes: 48000,
      status: "open", offers_count: 0, offers: [], my_offer: null, is_mine: false,
      distance_km: 2.1, created_at: new Date().toISOString(),
    },
    {
      id: "r-2", request_type: "rental", description: "concrete mixer for two days",
      location: "Kondele", needed_by: "this_week", budget_kes: null,
      status: "open", offers_count: 0, offers: [], my_offer: null, is_mine: false,
      distance_km: 5.4, created_at: new Date().toISOString(),
    },
  ],
  mine: [
    {
      id: "m-1", request_type: "worker", description: "three loaders for tomorrow morning",
      location: "Kibuye market", needed_by: "tomorrow", budget_kes: 3000,
      status: "open", offers_count: 1, is_mine: true, distance_km: 0,
      created_at: new Date().toISOString(),
      offers: [{
        id: "o-1", price_kes: 2800, note: "I have three loaders ready",
        lead_time: "ready now", status: "offered", is_mine: false,
        created_at: new Date().toISOString(),
      }],
    },
  ],
  calls: { calls: [] },
  tools: [],
  posted: [],
}));

vi.mock("@/lib/api", () => {
  const apiError = (e, f = "Something went wrong") => e?.message || f;
  return {
    apiError,
    stockAPI: {
      network: vi.fn(() => Promise.resolve({ data: [] })),
      patronVerify: vi.fn(),
    },
    toolAPI: { browse: vi.fn(() => Promise.resolve({ data: fixtures.tools })) },
    squadAPI: {
      calls: vi.fn(() => Promise.resolve({ data: fixtures.calls })),
      accept: vi.fn(),
    },
    requestsAPI: {
      list: vi.fn((params) => Promise.resolve({
        data: params?.scope === "mine" ? fixtures.mine : fixtures.requests,
      })),
      create: vi.fn((body) => {
        fixtures.posted.push(body);
        return Promise.resolve({ data: { id: "new-1", ...body, status: "open", offers: [], offers_count: 0, is_mine: true } });
      }),
      offer: vi.fn(() => Promise.resolve({ data: {} })),
      accept: vi.fn(() => Promise.resolve({ data: {} })),
      cancel: vi.fn(),
    },
    chatAPI: { rooms: vi.fn(() => Promise.resolve({ data: { rooms: [] } })) },
  };
});

const storeFns = vi.hoisted(() => ({
  fetchNetwork: vi.fn(() => Promise.resolve()),
  fetchCategories: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/stores/stockStore", async () => {
  const actual = await vi.importActual("@/stores/stockStore");
  const state = {
    network: [], networkLoading: false, categories: [], movements: [],
    fetchNetwork: storeFns.fetchNetwork,
    fetchCategories: storeFns.fetchCategories,
    replaceItem: vi.fn(),
  };
  return {
    ...actual,
    useStockStore: (selector) => (selector ? selector(state) : state),
    needsMyAction: actual.needsMyAction,
  };
});

const VENDOR = {
  id: "v-me", business_name: "Kamau Traders", vendor_handle: "kamau",
  physical_location: "Industrial Area, Kisumu", is_patron: false,
  business_categories: ["groceries"],
};
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) => selector({ vendor: VENDOR, token: "t" }),
}));

vi.mock("@/stores/chatStore", () => ({
  useChatStore: (selector) => selector({ openDeal: vi.fn(), rooms: [] }),
}));

// jsdom canvas for the shared UI (avatars etc.)
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => new Proxy({}, {
    get: (target, key) => (key === "canvas" ? {} : () => {}),
    set: () => true,
  }));
  fixtures.posted.length = 0;
});

const mount = (node) => render(<MemoryRouter>{node}</MemoryRouter>);

describe("Browse action center", () => {
  it("greets the business with the four jobs and one post-request door", async () => {
    const { default: BrowsePage } = await import("@/pages/browse/BrowsePage");
    mount(<BrowsePage />);
    expect(await screen.findByText(/What does your business need today\?/)).toBeInTheDocument();
    expect(screen.getByText(/INDUSTRIAL AREA, KISUMU/i)).toBeInTheDocument();
    for (const label of ["Find stock", "Find people", "Move goods", "Get equipment"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/Post a business request/)).toBeInTheDocument();
    // The network's live needs, ready to be answered.
    expect(await screen.findByText(/20 bags of maize flour/)).toBeInTheDocument();
    expect(screen.getByText(/concrete mixer for two days/)).toBeInTheDocument();
  });

  it("switches to one results system per job, one URL contract", async () => {
    const { default: BrowsePage } = await import("@/pages/browse/BrowsePage");
    const { squadAPI, toolAPI } = await import("@/lib/api");
    const people = renderHookInto(<BrowsePage />, { initialEntry: "?type=people" });
    expect(await people.findByText(/People ready to work/)).toBeInTheDocument();
    expect(squadAPI.calls).toHaveBeenCalled();
    people.unmount();

    // Same page, same contract — only the view changed.
    const equipment = renderHookInto(<BrowsePage />, { initialEntry: "?type=equipment" });
    expect(await equipment.findByText(/Equipment for hire/)).toBeInTheDocument();
    expect(toolAPI.browse).toHaveBeenCalledWith(expect.objectContaining({ category: "equipment" }));
    equipment.unmount();
  });

  it("keeps the goods pipeline intact on the goods view", async () => {
    const { default: BrowsePage } = await import("@/pages/browse/BrowsePage");
    renderHookInto(<BrowsePage />, { initialEntry: "?type=goods&search=rice" });
    expect(await screen.findByText(/“rice”/)).toBeInTheDocument();
    // The pipeline runs through the stock store, which owns the real call.
    expect(storeFns.fetchNetwork).toHaveBeenCalledWith(expect.objectContaining({ search: "rice" }));
  });

  it("opens the composer from the action center and posts the request", async () => {
    const { default: BrowsePage } = await import("@/pages/browse/BrowsePage");
    const { requestsAPI } = await import("@/lib/api");
    mount(<BrowsePage />);
    fireEvent.click(await screen.findByText(/Post a business request/));
    const dialog = await screen.findByRole("dialog", { name: /Post a business request/ });
    expect(dialog).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/20 bags of maize flour/), {
      target: { value: "2 crates of soda for a funeral this weekend" },
    });
    fireEvent.change(screen.getByPlaceholderText(/20 bags of maize flour/), {
      target: { value: "2 crates of soda for a funeral this weekend" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Post my request/ }));
    await waitFor(() => expect(requestsAPI.create).toHaveBeenCalled());
    const body = fixtures.posted[0];
    expect(body.request_type).toBe("stock");
    expect(body.location).toBe("Industrial Area, Kisumu");   // pre-filled from the profile
    expect(body.needed_by).toBe("flexible");
  });
});

describe("Work", () => {
  it("aggregates the in-flight flows and owns the offer loop", async () => {
    const { default: WorkPage } = await import("@/pages/work/WorkPage");
    const { requestsAPI } = await import("@/lib/api");
    mount(<WorkPage />);
    expect(await screen.findByText(/three loaders for tomorrow morning/)).toBeInTheDocument();
    // My open request shows its offer, with accept on the spot.
    expect(screen.getByText(/1 offer waiting/)).toBeInTheDocument();
    expect(screen.getByText(/I have three loaders ready/)).toBeInTheDocument();
    expect(requestsAPI.list).toHaveBeenCalledWith(expect.objectContaining({ scope: "mine" }));
    // And the flows it does not own are one tap away, not duplicated.
    for (const label of ["Orders & movements", "Tasks & jobs", "Market locks", "Rentals & delivery"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

// tiny helper: render with router at a given entry
import { render as rtlRender } from "@testing-library/react";
function renderHookInto(ui, { initialEntry = "/" } = {}) {
  return rtlRender(<MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>);
}
