import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const ok = (data) => Promise.resolve({ data });

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  outsideCreate: vi.fn(),
  upload: vi.fn(),
  authState: {
    token: null,
    vendor: null,
    ready: true,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    fetchVendor: vi.fn(),
  },
  outsideState: {
    location: {
      lat: -0.6817,
      lng: 34.7668,
      label: "Nyanchwa, Kisii",
      radius_km: 15,
      layer: "town",
      source: "manual",
      interests: [],
      share_location: false,
    },
    loadLocation: vi.fn(),
    activity: null,
    activityStatus: "ready",
    loadActivity: vi.fn(),
    items: [],
    status: "ready",
    cursor: null,
    error: "",
    loadFeed: vi.fn(),
    loadMore: vi.fn(),
    toggleReaction: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({
  default: {
    get: mocks.apiGet,
    post: mocks.apiPost,
    put: mocks.apiPut,
    delete: mocks.apiDelete,
  },
  outsideAPI: {
    create: mocks.outsideCreate,
    location: vi.fn(() => ok(mocks.outsideState.location)),
    activity: vi.fn(() => ok(mocks.outsideState.activity)),
  },
  fileAPI: { upload: mocks.upload },
  apiError: (e, fallback) => e?.response?.data?.detail || fallback,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(
    (selector) => (selector ? selector(mocks.authState) : mocks.authState),
    { getState: () => mocks.authState },
  ),
}));

vi.mock("@/stores/outsideStore", () => ({
  useOutsideStore: (selector) => selector(mocks.outsideState),
  locationLabel: (loc) => loc?.label || "Choose your area",
  locationExplain: () => "Using the area you chose.",
}));

vi.mock("@/stores/stockStore", () => ({
  useStockStore: (selector) =>
    selector({
      mine: [],
      movements: [],
      fetchMine: mocks.stockFetchMine,
      fetchMovements: mocks.stockFetchMovements,
    }),
}));

const ME = {
  id: "v-org",
  business_name: "Moraa Household",
  display_name: "Moraa Household",
  vendor_handle: "moraa_home",
  account_kind: "household",
  hide_exact_location: true,
  current_role: "both",
  physical_location: "Nyanchwa, Kisii",
};

const BACKEND_ACTIVITY = {
  id: "act-1",
  posting_type: "wanted",
  inferred_template: "repair_artisan",
  category: "repairs",
  title: "Fence repair needed on Saturday",
  body: "Approximately 20 metres of broken timber fence. Please quote.",
  area_name: "Nyanchwa, Kisii",
  schedule_label: "Saturday 8am–2pm",
  price_kes: null,
  price_basis: "quote_requested",
  lifecycle_status: "completed",
  has_private_directions: true,
  private_directions: null,
  private_directions_unlocked: false,
  permission_rules: {},
  template_fields: {},
  organizer: { id: "v-org", handle: "moraa_home", name: "Moraa Household", account_kind: "household" },
  lifecycle_stages: [
    { step: 1, key: "published", label: "Published", done: true },
    { step: 2, key: "notified", label: "Relevant people notified", done: true },
    { step: 3, key: "responses_received", label: "Responses received", done: true },
    { step: 4, key: "booking_agreed", label: "Booking agreed", done: true },
    { step: 5, key: "completed", label: "Work completed", done: true },
    { step: 6, key: "reusable_record", label: "Reusable record", done: true },
  ],
  responses: [
    {
      id: "resp-1",
      responder: { id: "v-juma", handle: "juma_fencing", name: "Juma Fencing Fundi", account_kind: "artisan" },
      response_type: "quote",
      quoted_price_kes: 8500,
      quantity: null,
      unit: null,
      availability_window: "Saturday 8:00am",
      note: "Includes treated posts realignment and wire tensioning.",
      private_stop_directions: null,
      guardian_consent_status: "not_required",
      status: "accepted",
      created_at: "2026-10-20T08:00:00",
    },
  ],
  bookings: [
    {
      id: "bk-1",
      organizer: { id: "v-org", handle: "moraa_home", name: "Moraa Household", account_kind: "household" },
      participant: { id: "v-juma", handle: "juma_fencing", name: "Juma Fencing Fundi", account_kind: "artisan" },
      agreed_scope: "Repair 20m fence",
      agreed_price_kes: 9200,
      settlement_method: "direct_mpesa",
      slot_label: "Saturday 8:00am",
      stop_sequence: null,
      status: "completed",
      organizer_confirmed_at: "2026-10-20T15:00:00",
      participant_confirmed_at: "2026-10-20T15:05:00",
      completed_at: "2026-10-20T15:05:00",
      agreed_changes: [{ summary: "Added gate latch (+KSh 700)" }],
      feedback: [],
      created_at: "2026-10-20T07:00:00",
    },
  ],
  ledger_events: [
    { id: 1, event_type: "activity_completed", summary: "Both parties confirmed completion", created_at: "2026-10-20T15:05:00" },
  ],
  created_at: "2026-10-19T09:00:00",
  updated_at: "2026-10-20T15:05:00",
};

const ALT_ACTIVITY = {
  ...BACKEND_ACTIVITY,
  id: "act-alt",
  title: "Timber fence repairs across Kisii",
  lifecycle_status: "responses_received",
  organizer: { id: "v-peter", handle: "peter_timber", name: "Peter Timber & Fence", account_kind: "artisan" },
  lifecycle_stages: BACKEND_ACTIVITY.lifecycle_stages.slice(0, 3),
  responses: [],
  bookings: [],
  ledger_events: [],
};

function routeApiGet(url) {
  if (url === `/ledger/activities/${BACKEND_ACTIVITY.id}`) return ok(BACKEND_ACTIVITY);
  if (url === "/ledger/alternatives") return ok({ alternatives: [], open_activities: [ALT_ACTIVITY] });
  if (url === "/ledger/watches") return ok({ items: [] });
  if (url === "/ledger/bookings/mine") return ok({ items: [] });
  if (url === "/ledger/metrics/summary") {
    return ok({
      metric_philosophy: "outcomes_not_time_spent",
      network: {
        successful_matches: 12,
        requests_fulfilled: 9,
        repeat_bookings: 4,
        notifications_acted_upon: 7,
        active_local_providers_30d: 6,
      },
      mine: { active_bookings: 1, completed_records: 3 },
    });
  }
  if (url === "/ledger/records") {
    return ok({
      items: [
        {
          booking_id: "bk-1",
          activity_id: "act-1",
          title: "Fence repair needed on Saturday",
          posting_type: "wanted",
          inferred_template: "repair_artisan",
          category: "repairs",
          area_name: "Nyanchwa, Kisii",
          agreed_scope: "Repair 20m fence",
          agreed_price_kes: 9200,
          settlement_method: "direct_mpesa",
          completed_at: "2026-10-20T15:05:00",
          counterparty: { id: "v-juma", handle: "juma_fencing", name: "Juma Fencing Fundi", account_kind: "artisan" },
        },
      ],
    });
  }
  if (url === "/ledger/relationships") {
    return ok({
      items: [
        {
          id: "rel-1",
          relationship_kind: "artisan",
          label: "Trusted fencing fundi",
          categories: ["repairs"],
          completed_together_count: 1,
          target: { id: "v-juma", handle: "juma_fencing", name: "Juma Fencing Fundi", account_kind: "artisan" },
        },
      ],
    });
  }
  if (url === "/ledger/home-storefront") {
    return ok({
      config: {
        enabled: true,
        title: "Kiamunyi Orchard Shelf",
        visiting_hours: "Sat 4pm–6pm",
        audience: "saved_contacts",
        share_directions_only_when_booked: true,
      },
      available_activities: [],
    });
  }
  return ok({});
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.authState.token = null;
  mocks.authState.vendor = null;
  mocks.outsideState.activity = null;
  mocks.apiGet.mockImplementation((url) => routeApiGet(url));
  mocks.apiPost.mockImplementation(() => ok({}));
  mocks.apiPut.mockImplementation(() => ok({ config: {} }));
  mocks.apiDelete.mockImplementation(() => ok({ deleted: true }));
  mocks.outsideCreate.mockImplementation(() =>
    ok({ record: "local_activity", id: "act-new", to: "/activities/act-new", posting_type: "wanted" }),
  );
  mocks.upload.mockImplementation(() => ok({ url: "/files/a.jpg" }));
  const { useCreateStore } = await import("@/stores/createStore");
  useCreateStore.getState().discard();
});

const renderAt = (path, element) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );

describe("Local Activity Ledger — inference & API contract", () => {
  it("infers repair, fodder, cobbler-round and youth templates deterministically", async () => {
    const { inferActivityTemplate } = await import("@/lib/inference");
    expect(
      inferActivityTemplate({ posting_type: "wanted", title: "Fence repair", body: "Broken gate posts" }).inferred_template,
    ).toBe("repair_artisan");
    expect(
      inferActivityTemplate({ posting_type: "available", title: "Napier grass", body: "12.5 bales fresh" }).inferred_template,
    ).toBe("agricultural_produce_fodder");
    expect(
      inferActivityTemplate({ posting_type: "scheduled", title: "Cobbler round", body: "Household stops in Muthaiga" }).inferred_template,
    ).toBe("travelling_round");
    expect(
      inferActivityTemplate({ posting_type: "opportunity", title: "Youth holiday task", body: "Teenagers supervised nursery" }).inferred_template,
    ).toBe("supervised_youth_task");
  });

  it("normalizes backend organizer/stage/privacy fields and maps response + watch payloads", async () => {
    const { ledgerAPI, normalizeActivity } = await import("@/lib/ledgerApi");
    const normalized = normalizeActivity(BACKEND_ACTIVITY);
    expect(normalized.owner.handle).toBe("moraa_home");
    expect(normalized.ledger_stage).toBe("reusable_record");
    expect(normalized.private_directions_locked).toBe(true);
    expect(normalized.responses[0].offered_price_kes).toBe(8500);
    expect(normalized.bookings[0].provider.handle).toBe("juma_fencing");
    expect(normalized.bookings[0].initiator_confirmed_at).toBeTruthy();

    await ledgerAPI.respond("act-1", {
      response_kind: "stop_request",
      message: "Please stop at our home",
      offered_price_kes: 500,
      quantity_requested: 2.5,
      private_stop_directions: "Gate 4",
    });
    expect(mocks.apiPost).toHaveBeenCalledWith(
      "/ledger/activities/act-1/responses",
      expect.objectContaining({
        response_type: "round_stop_request",
        note: "Please stop at our home",
        quoted_price_kes: 500,
        quantity: 2.5,
        private_stop_directions: "Gate 4",
      }),
    );

    await ledgerAPI.createWatch({
      posting_type: "wanted",
      inferred_template: "repair_artisan",
      keyword: "fence",
      area_name: "Kisii",
      radius_km: "15",
    });
    expect(mocks.apiPost).toHaveBeenCalledWith(
      "/ledger/watches",
      expect.objectContaining({
        posting_types: ["wanted"],
        categories: ["repairs"],
        keywords: "fence",
        area_name: "Kisii",
        radius_km: 15,
      }),
    );
  });
});

describe("Inclusive signup", () => {
  it("defaults to a person/household with exact location hidden and no compulsory business", async () => {
    const AuthPage = (await import("@/pages/auth/AuthPage")).default;
    renderAt("/auth?mode=register", <AuthPage />);

    expect(
      await screen.findByRole("heading", {
        name: /Join as a neighbour, household, artisan/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("account-kind-person")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("auth-hide-exact-location")).toBeChecked();
    expect(screen.getByLabelText(/Your name, household, or business name/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("account-kind-household"));
    expect(screen.getByTestId("account-kind-household")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("account-kind-hint")).toHaveTextContent(/Homestead or family compound/i);
  });
});

describe("Four-type publishing", () => {
  it("makes Available/Wanted/Scheduled/Opportunity primary, infers fence repair, and publishes a Wanted ledger payload", async () => {
    const CreatePage = (await import("@/pages/create/CreatePage")).default;
    renderAt("/create", <CreatePage />);

    for (const type of ["available", "wanted", "scheduled", "opportunity"]) {
      expect(screen.getByTestId(`posting-type-${type}`)).toBeInTheDocument();
    }
    // Classic types remain reachable for backward compatibility.
    expect(screen.getByTestId("create-type-event")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("posting-type-wanted"));
    fireEvent.change(screen.getByTestId("create-title"), {
      target: { value: "Fence repair needed on Saturday" },
    });
    fireEvent.change(screen.getByTestId("create-body"), {
      target: { value: "Broken timber fence along the compound edge, about 20 metres. Please quote." },
    });

    await waitFor(() =>
      expect(screen.getByTestId("inferred-template-label")).toHaveTextContent(/Repair/i),
    );
    expect(screen.getByTestId("template-fields-repair_artisan")).toBeInTheDocument();
    expect(screen.getByTestId("create-private-directions")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("create-private-directions"), {
      target: { value: "Green hedge gate behind the primary school" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Publish wanted/i }));

    await waitFor(() => expect(mocks.outsideCreate).toHaveBeenCalledTimes(1));
    const payload = mocks.outsideCreate.mock.calls[0][0];
    expect(payload).toMatchObject({
      content_type: "wanted",
      posting_type: "wanted",
      use_ledger: true,
      title: "Fence repair needed on Saturday",
      private_directions: "Green hedge gate behind the primary school",
    });
  });

  it("shows mandatory youth supervision fields with server-valid age/domain defaults", async () => {
    const CreatePage = (await import("@/pages/create/CreatePage")).default;
    renderAt("/create?type=opportunity&ledger=1", <CreatePage />);

    fireEvent.change(screen.getByTestId("create-body"), {
      target: { value: "Supervised holiday youth task for teenagers potting indigenous seedlings in the morning." },
    });

    expect(await screen.findByTestId("template-fields-supervised_youth_task")).toBeInTheDocument();
    expect(screen.getByTestId("youth-age-band")).toHaveValue("16_17_supervised");
    expect(screen.getByTestId("youth-permitted-domain")).toHaveValue("garden_help");
    expect(screen.getByTestId("youth-supervisor-name")).toBeInTheDocument();
    expect(screen.getByText(/Server-enforced safety rules/i)).toBeInTheDocument();
  });
});

describe("Activity detail ledger", () => {
  it("renders all six stages, locked household directions, completed booking and local alternatives", async () => {
    mocks.authState.vendor = ME;
    mocks.authState.token = "tok";
    const ActivityDetailPage = (await import("@/pages/activities/ActivityDetailPage")).default;
    render(
      <MemoryRouter initialEntries={["/activities/act-1"]}>
        <Routes>
          <Route path="/activities/:id" element={<ActivityDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /Fence repair needed/i })).toBeInTheDocument();
    for (const stage of ["published", "notified", "responses_received", "booking_agreed", "completed", "reusable_record"]) {
      expect(screen.getByTestId(`stage-${stage}`)).toHaveAttribute("data-reached", "true");
    }
    expect(screen.getByTestId("current-ledger-stage")).toHaveTextContent(/Stage 6 of 6/i);
    expect(screen.getByTestId("locked-private-directions-msg")).toHaveTextContent(/Exact gate directions unlock/i);
    expect(screen.getByText(/Added gate latch/i)).toBeInTheDocument();
    expect(await screen.findByTestId("local-alternatives-panel")).toHaveTextContent(/Peter Timber/i);
    expect(screen.getByTestId("ledger-events-timeline")).toHaveTextContent(/Both parties confirmed completion/i);

    fireEvent.click(screen.getByTestId("repeat-booking-bk-1"));
    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith(
        "/ledger/bookings/bk-1/repeat",
        expect.any(Object),
      ),
    );
  });
});

describe("Activity watches and Profile utility", () => {
  it("creates a neighbourhood watch from user-chosen preferences", async () => {
    mocks.outsideState.activity = {
      groups: [],
      counts: { unread_notifications: 0, rooms: 0, rooms_active_today: 0, attending: 0 },
    };
    const ActivityPage = (await import("@/pages/activity/ActivityPage")).default;
    renderAt("/activity", <ActivityPage />);

    expect(await screen.findByTestId("activity-watches-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-add-watch-btn"));
    fireEvent.change(screen.getByTestId("watch-keyword-input"), { target: { value: "fence" } });
    fireEvent.click(screen.getByTestId("save-watch-btn"));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith(
        "/ledger/watches",
        expect.objectContaining({ keywords: "fence", posting_types: ["wanted"], categories: ["repairs"] }),
      ),
    );
  });

  it("shows outcome metrics, reusable records with alternatives, and Home Storefront controls", async () => {
    mocks.authState.vendor = ME;
    mocks.authState.token = "tok";
    const MePage = (await import("@/pages/me/MePage")).default;
    renderAt("/me", <MePage />);

    expect(await screen.findByTestId("utility-metrics-panel")).toHaveTextContent(/Requests fulfilled/i);
    expect(screen.getByTestId("utility-metrics-panel")).toHaveTextContent(/Active local providers/i);
    expect(screen.getByTestId("reusable-records-panel")).toHaveTextContent(/Fence repair needed/i);
    expect(screen.getByTestId("saved-relationships-panel")).toHaveTextContent(/Juma Fencing Fundi/i);
    expect(screen.getByTestId("home-storefront-title")).toHaveValue("Kiamunyi Orchard Shelf");
    expect(screen.getByTestId("home-storefront-audience")).toHaveValue("saved_contacts");

    fireEvent.click(screen.getByTestId("me-alternatives-bk-1"));
    await waitFor(() =>
      expect(mocks.apiGet).toHaveBeenCalledWith(
        "/ledger/alternatives",
        { params: expect.objectContaining({ category: "repairs", exclude_vendor_id: "v-juma" }) },
      ),
    );

    fireEvent.click(screen.getByTestId("save-home-storefront-btn"));
    await waitFor(() =>
      expect(mocks.apiPut).toHaveBeenCalledWith(
        "/ledger/home-storefront",
        expect.objectContaining({ enabled: true, audience: "saved_contacts" }),
      ),
    );
  });
});
