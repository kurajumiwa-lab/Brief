import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const ws = vi.hoisted(() => ({
  id: "ws-1",
  slug: "Kisumu-retail-traders",
  name: "Kisumu Retail Traders Association",
  region: "Kisumu",
  plan: { key: "pilot", name: "Kisumu Pilot", max_members: 25, max_field_officers: 3, max_devices: 5 },
  my_role: "owner",
  is_public: false,
  android: { enterprise_bound: false, emm_provider: "none", dispatch_enabled: false, note: "Android Enterprise / your EMM manages the phones." },
}));

const apiMocks = vi.hoisted(() => ({
  plans: vi.fn(() => Promise.resolve({
    data: {
      model: "both",
      plans: [
        { key: "pilot", name: "Kisumu Pilot", price_kes_monthly: 0, price_kes_annual: 0, audience: "One association", max_members: 25, max_field_officers: 3, max_devices: 5, features: ["Branded workspace inside Brief_"] },
        { key: "association", name: "Association", price_kes_monthly: 24500, price_kes_annual: 245000, audience: "Trade associations", max_members: 200, max_field_officers: 10, max_devices: 30, features: ["Public workspace listing"] },
        { key: "enterprise", name: "Enterprise / County", price_kes_monthly: 145000, price_kes_annual: 1450000, audience: "County programmes", max_members: 2000, max_field_officers: 100, max_devices: 500, features: ["Android Enterprise binding support"] },
      ],
      android_enterprise: { enrolment_modes: [] },
    },
  })),
  myWorkspaces: vi.fn(() => Promise.resolve({ data: [ws] })),
  discover: vi.fn(() => Promise.resolve({ data: [] })),
  dashboard: vi.fn(() => Promise.resolve({
    data: {
      ...ws,
      usage: { members_used: 2, members_limit: 25, field_officers_used: 1, field_officers_limit: 3, devices_used: 1, devices_limit: 5 },
      dashboard: {
        members_by_role: { owner: 1, field_officer: 1 },
        field_registrations_last_30d: [{ officer_handle: "officer_achieng", registrations: 4 }],
        pending_device_commands: 1,
      },
    },
  })),
  members: vi.fn(() => Promise.resolve({
    data: {
      members: [
        { id: "m-1", business_name: "Achieng Field Services", vendor_handle: "officer_achieng", role: "field_officer", registered_by_handle: "assoc_admin" },
      ],
    },
  })),
  devices: vi.fn(() => Promise.resolve({
    data: {
      devices: [
        { id: "d-1", label: "Field phone 1", enrolment_mode: "work_profile", status: "enrolled", assigned_handle: "officer_achieng", enrolment_note: "Only the work profile can be locked or removed.", allowed_commands: ["lock", "wipe_work_data", "lost_mode"] },
      ],
    },
  })),
  commands: vi.fn(() => Promise.resolve({
    data: [
      { id: "c-1", command_type: "wipe_work_data", dispatched: false, status: "requested", reason: "Officer left the association", enrolment_mode: "work_profile" },
    ],
  })),
  createWorkspace: vi.fn(), updateWorkspace: vi.fn(), addMember: vi.fn(),
  revokeMember: vi.fn(), enrolDevice: vi.fn(), requestCommand: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (e, f = "Error") => e?.message || f,
  enterpriseAPI: apiMocks,

  commercialAPI: {
    feed: vi.fn(() => Promise.resolve({ data: { posts: [] } })),
    shelf: vi.fn(() => Promise.resolve({ data: { shelf: [] } })),
    get: vi.fn(() => Promise.resolve({ data: {} })),
    create: vi.fn(() => Promise.resolve({ data: {} })),
    save: vi.fn(() => Promise.resolve({ data: {} })),
    unsave: vi.fn(() => Promise.resolve({ data: {} })),
    share: vi.fn(() => Promise.resolve({ data: { share_url: "" } })),
    joinInterest: vi.fn(() => Promise.resolve({ data: {} })),
    interests: vi.fn(() => Promise.resolve({ data: { interests: [] } })),
    stats: vi.fn(() => Promise.resolve({ data: {} })),
    categories: vi.fn(() => Promise.resolve({ data: { categories: [] } })),
  },
}));

describe("EnterprisePage", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders the workspace dashboard, honest command state and KSh plans", async () => {
    const { default: EnterprisePage } = await import("@/pages/enterprise/EnterprisePage");
    render(
      <MemoryRouter>
        <EnterprisePage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /enterprise workspaces/i })).toBeInTheDocument();
    expect(await screen.findByText("Kisumu Retail Traders Association")).toBeInTheDocument();
    expect(screen.getByText("Achieng Field Services")).toBeInTheDocument();
    expect(screen.getByText("Field phone 1")).toBeInTheDocument();
    // A work-profile phone never offers a whole-device wipe…
    expect(screen.queryByRole("button", { name: /wipe device/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /wipe work data/i })).toBeInTheDocument();
    // …and an undispatched command says so instead of claiming a wipe happened.
    expect(screen.getByText("requested — not sent")).toBeInTheDocument();
    expect(screen.getByText(/No EMM bound — commands are audit-only/)).toBeInTheDocument();
    expect(screen.getByText(/@officer_achieng — 4/)).toBeInTheDocument();
    expect(screen.getByText("KSh 24,500/mo")).toBeInTheDocument();
    expect(screen.getByText("KSh 145,000/mo")).toBeInTheDocument();
  });
});
