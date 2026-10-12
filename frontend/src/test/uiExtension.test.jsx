import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({
  vendorAPI: {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
  },
  chatAPI: {
    rooms: vi.fn(),
    messages: vi.fn(),
    send: vi.fn(),
  },
  toolAPI: {
    browse: vi.fn(),
    mine: vi.fn(),
    bookings: vi.fn(),
    calendar: vi.fn(),
    couriers: vi.fn(),
    shipments: vi.fn(),
    book: vi.fn(),
    create: vi.fn(),
  },
  collectiveAPI: {
    list: vi.fn(),
    create: vi.fn(),
    pledge: vi.fn(),
    lock: vi.fn(),
    cancel: vi.fn(),
  },
  squadAPI: {
    me: vi.fn(),
    calls: vi.fn(),
    recent: vi.fn(),
    accept: vi.fn(),
    postCall: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({
  ...api,
  apiError: (e, fb) => e?.response?.data?.detail || fb || "error",
}));

import StockCard from "@/components/stock/StockCard";
import ToolsPage from "@/pages/tools/ToolsPage";
import CollectivePanel from "@/components/groups/CollectivePanel";
import TasksPortal from "@/pages/tasks/TasksPortal";
import ChatPage from "@/pages/chat/ChatPage";
import EmptyState from "@/components/ui/EmptyState";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";

const ME = {
  id: "v-me",
  vendor_handle: "amani",
  business_name: "Amani Wholesale",
  owner_name: "Amani Ouma",
  physical_location: "Gikomba, Nairobi",
  is_verified: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ vendor: ME, token: "t", ready: true });
  useChatStore.setState({
    rooms: [],
    activeId: null,
    messages: [],
    loading: false,
    sending: false,
    live: true,
    openRoomSocket: vi.fn(),
    closeSocket: vi.fn(),
  });
});

describe("Amazon-style Marketplace Cards & Progressive Disclosure", () => {
  it("renders StockCard with available quantity, unit, MOQ, vendor identity, and progressive Details disclosure", async () => {
    const item = {
      id: "st-1",
      name: "Pishori Grade 1 Rice",
      category: "Grains & Cereals",
      quantity_available: 45,
      unit_of_measure: "bag",
      unit_price: 6800,
      minimum_order_quantity: 5,
      quality_status: "patron_verified",
      origin_region: "Mwea, Kirinyaga",
      batch_code: "MWEA-2026-10",
      vendor_handle: "mweamills",
      vendor_business: "Mwea Mills Ltd",
      vendor_trust: 3,
      vendor_fulfillment_rate: 96,
      updated_at: new Date().toISOString(),
    };

    render(
      <MemoryRouter>
        <StockCard item={item} mode="network" onSource={vi.fn()} onCompare={vi.fn()} />
      </MemoryRouter>
    );

    expect(screen.getByText("Pishori Grade 1 Rice")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText(/5 bag/i)).toBeInTheDocument();
    expect(screen.getByText("Mwea Mills Ltd")).toBeInTheDocument();

    // Progressive disclosure: batch code is hidden until Details is clicked
    expect(screen.queryByText(/Lot: MWEA-2026-10/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Details/i }));
    expect(screen.getByText(/Lot: MWEA-2026-10/i)).toBeInTheDocument();
    expect(screen.getByText(/Origin: Mwea, Kirinyaga/i)).toBeInTheDocument();
  });

  it("renders Warehouse & Facility Rental cards with capacity, rate, features, and FacilityDetailsModal", async () => {
    api.toolAPI.browse.mockResolvedValue({
      data: [
        {
          id: "wh-1",
          title: "Cold Storage Bay 4 — Industrial Area",
          category: "storage",
          description: "Palletized cold storage with loading dock and 24-hour guard.",
          location: "Industrial Area, Nairobi",
          price_per_unit: 250,
          price_unit: "per_sqm",
          min_booking: "7 days",
          deposit_required: 5000,
          capacity: { value: 320, unit: "sqm" },
          features: ["Cold room", "Loading bay", "24/7 CCTV"],
          terms: "Forklift operator included during business hours.",
          is_available: true,
          vendor_id: "v-other",
          vendor_handle: "koldhub",
          vendor_business: "KoldHub Warehousing",
        },
      ],
    });
    api.toolAPI.mine.mockResolvedValue({ data: [] });
    api.toolAPI.bookings.mockResolvedValue({ data: { incoming: [], outgoing: [] } });
    api.toolAPI.couriers.mockResolvedValue({ data: [] });
    api.toolAPI.shipments.mockResolvedValue({ data: [] });
    api.toolAPI.calendar.mockResolvedValue({
      data: {
        days: [
          { date: "2026-10-12", state: "free" },
          { date: "2026-10-13", state: "free" },
        ],
      },
    });

    render(
      <MemoryRouter>
        <ToolsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Cold Storage Bay 4 — Industrial Area")).toBeInTheDocument();
    expect(screen.getByText(/320 sqm/i)).toBeInTheDocument();
    expect(screen.getByText("Cold room")).toBeInTheDocument();
    expect(screen.getByText("KoldHub Warehousing")).toBeInTheDocument();

    // Open facility details modal
    fireEvent.click(screen.getByRole("button", { name: /^Details$/i }));
    expect(await screen.findByText(/Forklift operator included during business hours/i)).toBeInTheDocument();
  });

  it("renders Order Consolidation cards with threshold progress bar and participating vendor disclosure", async () => {
    api.collectiveAPI.list.mockResolvedValue({
      data: [
        {
          id: "co-1",
          group_id: "g-1",
          item_name: "Fortified Maize Flour (Bales)",
          item_category: "Grains",
          unit_of_measure: "bale",
          target_quantity: 50,
          current_pledged_quantity: 25,
          progress_pct: 50,
          target_price_per_unit: 1650,
          organizer_handle: "amani",
          deadline: "2026-10-20T12:00:00Z",
          status: "open",
          pledge_count: 2,
          pledges: [
            { id: "p-1", vendor_id: "v-me", vendor_handle: "amani", pledged_quantity: 10, max_price_per_unit: 1650 },
            { id: "p-2", vendor_id: "v-2", vendor_handle: "njeri", pledged_quantity: 15, max_price_per_unit: 1680 },
          ],
          description: "Delivered to Gikomba Gate B on Tuesday morning.",
        },
      ],
    });

    render(
      <MemoryRouter>
        <CollectivePanel group={{ id: "g-1", my_role: "member" }} />
      </MemoryRouter>
    );

    expect(await screen.findByText(/25 \/ 50 pledged/i)).toBeInTheDocument();
    expect(screen.getByText(/2 vendors/i)).toBeInTheDocument();

    // Open Details progressive disclosure
    fireEvent.click(screen.getByRole("button", { name: /Details/i }));
    expect(screen.getByText(/Delivered to Gikomba Gate B on Tuesday morning/i)).toBeInTheDocument();
    expect(screen.getByText("@njeri")).toBeInTheDocument();
  });
});

describe("Temporary-Jobs Landing Page & Portfolio", () => {
  it("renders hero section, visual category cards, image-led job cards, and job details modal", async () => {
    api.squadAPI.me.mockResolvedValue({
      data: {
        xp: 240,
        gold: 85,
        level: "L3",
        division: "Division 9",
        streak: 2,
        energy: { used: 1, limit: 4, rest_today: false },
        cards: [{ skill: "mover", label: "Mover", tier: "rare", completions: 12, avg_rating: 4.8 }],
        active_contract: null,
      },
    });
    api.squadAPI.calls.mockResolvedValue({
      data: {
        calls: [
          {
            id: "job-1",
            title: "Offload 80 sacks of potatoes & stack bay 2",
            skill: "mover",
            task_type: "loading",
            required_tier: "common",
            pay_kes: 650,
            location: "Wakulima Market",
            client: "Wakulima Fresh Traders",
            status: "open",
            mine: false,
          },
          {
            id: "job-2",
            title: "Count and tag 200 cartons in store",
            skill: "digital",
            task_type: "inventory",
            required_tier: "common",
            pay_kes: 500,
            location: "River Road",
            client: "Nairobi Stationers",
            status: "open",
            mine: false,
          },
        ],
      },
    });
    api.squadAPI.recent.mockResolvedValue({ data: { wins: [] } });

    render(
      <MemoryRouter>
        <TasksPortal />
      </MemoryRouter>
    );

    // Hero section headline & actions
    expect(await screen.findByText("Good people. Ready when business needs them.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browse Jobs/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Post a Job/i })).toBeInTheDocument();

    // Both job cards visible initially
    expect(await screen.findByText("Offload 80 sacks of potatoes & stack bay 2")).toBeInTheDocument();
    expect(screen.getByText("Count and tag 200 cartons in store")).toBeInTheDocument();

    // Filter by clicking a visual category card (Loading & Warehouse -> skill 'mover')
    fireEvent.click(screen.getByTestId("job-category-mover"));
    expect(screen.getByText("Offload 80 sacks of potatoes & stack bay 2")).toBeInTheDocument();
    expect(screen.queryByText("Count and tag 200 cartons in store")).not.toBeInTheDocument();

    // Inspect Job Details modal
    fireEvent.click(screen.getByRole("button", { name: /View Job/i }));
    expect(await screen.findByText(/Responsibilities & scope/i)).toBeInTheDocument();
    expect(screen.getByText(/Completion & payment terms/i)).toBeInTheDocument();
  });
});

describe("Chat: Personal Photo and Business Logo", () => {
  it("opens ChatIdentityModal, previews all 4 identity modes, and saves configuration via vendorAPI.updateProfile", async () => {
    api.vendorAPI.getProfile.mockResolvedValue({
      data: {
        logo_url: "https://example.com/biz-logo.png",
        avatar_url: "https://example.com/person.png",
        chat_identity: {
          mode: "combined",
          personal_photo_url: "https://example.com/person.png",
          business_logo_url: "https://example.com/biz-logo.png",
          sender_name: "Amani Ouma",
          sender_role: "Founder",
          show_in: { conversation_list: true, message_header: true, messages: true },
        },
      },
    });
    api.vendorAPI.updateProfile.mockImplementation(async (patch) => ({
      data: {
        logo_url: patch.logo_url,
        avatar_url: patch.avatar_url,
        chat_identity: patch.chat_identity,
      },
    }));

    const room = {
      id: "r-1",
      name: "Mwea Mills",
      room_type: "direct",
      is_member: true,
      participant_count: 2,
      peer_business_name: "Mwea Mills",
    };

    useChatStore.setState({
      rooms: [room],
      activeId: "r-1",
      messages: [
        {
          id: "m-1",
          room_id: "r-1",
          sender_id: "v-me",
          sender_name: "Amani Ouma",
          sender_business_name: "Amani Wholesale",
          sender_role: "Founder",
          content: "Can we lock 20 bags at KSh 6,700?",
          message_type: "text",
          sent_at: new Date().toISOString(),
        },
      ],
      fetchRooms: vi.fn().mockResolvedValue([room]),
    });

    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>
    );

    // Open Chat Identity modal
    const identityButtons = await screen.findAllByRole("button", { name: /Chat identity/i });
    fireEvent.click(identityButtons[0]);

    expect(await screen.findByText("Chat identity & branding")).toBeInTheDocument();
    expect(screen.getByTestId("identity-mode-personal_photo")).toBeInTheDocument();
    expect(screen.getByTestId("identity-mode-business_logo")).toBeInTheDocument();
    expect(screen.getByTestId("identity-mode-combined")).toBeInTheDocument();
    expect(screen.getByTestId("identity-mode-business_with_role")).toBeInTheDocument();

    // Select 'business_with_role' mode and save
    fireEvent.click(screen.getByTestId("identity-mode-business_with_role"));
    fireEvent.click(screen.getByRole("button", { name: /Save identity settings/i }));

    await waitFor(() => {
      expect(api.vendorAPI.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_identity: expect.objectContaining({
            mode: "business_with_role",
          }),
        })
      );
    });
  });
});

describe("EmptyState scenarios & state differentiation", () => {
  it("renders scenario-specific SVG illustrations and distinguishes filter mismatches and restricted states", () => {
    const { rerender } = render(
      <EmptyState
        illustration="warehouse"
        title="No available warehouse spaces"
        description="List your unused cold room or dry bay."
      />
    );
    expect(screen.getByTestId("empty-illustration-warehouse")).toBeInTheDocument();
    expect(screen.getByText("No available warehouse spaces")).toBeInTheDocument();

    rerender(
      <EmptyState
        tone="restricted"
        title="Business owner permission required"
        description="Only authorized owners can modify organization-wide settings."
      />
    );
    expect(screen.getByTestId("empty-illustration-restricted")).toBeInTheDocument();
    expect(screen.getByText("Permission restricted")).toBeInTheDocument();
  });
});
