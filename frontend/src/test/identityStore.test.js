import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn(() => Promise.resolve({ data: {} }));
const me = vi.fn(() => Promise.resolve({ data: {} }));
const claimAffiliation = vi.fn(() => Promise.reject(new Error("no service")));

vi.mock("@/lib/api", () => ({
  default: {},
  identityAPI: {
    me: (...a) => me(...a),
    save: (...a) => save(...a),
    claimAffiliation: (...a) => claimAffiliation(...a),
    confirmAffiliation: vi.fn(),
    claimLicence: vi.fn(() => Promise.reject(new Error("no service"))),
  },
}));

const { useIdentityStore } = await import("@/stores/identityStore");

const initial = useIdentityStore.getState();

beforeEach(() => {
  useIdentityStore.setState({
    ...initial,
    intent: null,
    capabilities: [],
    contact: { phone: "", email: "", show_phone: false, show_email: false },
    affiliation: null,
    licence: null,
    loaded: false,
    status: "idle",
    error: null,
  });
  save.mockClear();
  me.mockClear();
  claimAffiliation.mockClear();
});

describe("identity store", () => {
  it("starts with nothing chosen and nothing assumed", () => {
    const state = useIdentityStore.getState();
    expect(state.intent).toBeNull();
    expect(state.capabilities).toEqual([]);
    expect(state.affiliation).toBeNull();
  });

  it("never ticks a capability when an intent is chosen", async () => {
    await useIdentityStore.getState().setIntent("represent");
    const state = useIdentityStore.getState();
    expect(state.intent).toBe("represent");
    // Representing an institution does not mean you sell or offer services.
    expect(state.capabilities).toEqual([]);
  });

  it("never rewrites 'just looking' into a vendor intent", async () => {
    await useIdentityStore.getState().setIntent("explore");
    await useIdentityStore.getState().toggleCapability("sell_goods");
    const state = useIdentityStore.getState();
    expect(state.intent).toBe("explore");
    expect(state.capabilities).toEqual(["sell_goods"]);
  });

  it("saves one explicit record when onboarding finishes", async () => {
    await useIdentityStore.getState().setAll({
      intent: "offer",
      capabilities: ["offer_services"],
      contact: { phone: "+254700000000", show_phone: true },
    });
    expect(save).toHaveBeenCalledWith({
      intent: "offer",
      capabilities: ["offer_services"],
      contact: { phone: "+254700000000", show_phone: true, email: "", show_email: false },
    });
  });

  it("keeps an affiliation pending when the check service is unreachable", async () => {
    await useIdentityStore.getState().claimAffiliation({
      name: "Kisumu Clinic",
      role: "Nurse",
      method: "domain_email",
    });
    const state = useIdentityStore.getState();
    expect(state.affiliation.status).toBe("pending");
    expect(state.status).toBe("local");
    // A device cannot verify a claim, and the UI is told why.
    expect(state.error).toMatch(/stays pending/i);
  });
});
