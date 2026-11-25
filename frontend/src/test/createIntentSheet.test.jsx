import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  outsideCreate: vi.fn(() => Promise.resolve({ data: { content_type: "available", id: "a-1", to: "/activities/a-1" } })),
  upload: vi.fn(() => Promise.resolve({ data: { url: "/uploads/1.jpg" } })),
  corridorPrice: vi.fn(() => Promise.resolve({ data: null })),
}));

vi.mock("@/lib/api", () => ({
  outsideAPI: {
    create: mocks.outsideCreate,
    location: vi.fn(() => Promise.resolve({ data: { label: "Nyanchwa, Kisii" } })),
  },
  fileAPI: { upload: mocks.upload },
  corridorAPI: { priceHint: mocks.corridorPrice },
  apiError: (e, fallback) => e?.response?.data?.detail || fallback,
}));

vi.mock("@/stores/outsideStore", () => ({
  useOutsideStore: (selector) =>
    selector({
      location: { label: "Nyanchwa, Kisii", radius_km: 15, layer: "town", source: "manual" },
      loadLocation: vi.fn(),
    }),
  locationLabel: (loc) => loc?.label || "Choose your area",
}));

import CreateIntentSheet from "@/components/create/CreateIntentSheet";
import { CREATE_INTENTS, intentForDraft } from "@/config/createIntents";
import { TYPE_FIELDS, useCreateStore } from "@/stores/createStore";

const renderAt = (path, element) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  // The create store is a module singleton, so a draft written by one test
  // would otherwise be the draft the next test opens.
  useCreateStore.getState().discard();
});

describe("The Create purpose sheet", () => {
  it("offers six purposes in the words a person would use", () => {
    render(
      <MemoryRouter>
        <CreateIntentSheet value={null} onSelect={() => {}} />
      </MemoryRouter>,
    );
    const group = screen.getByTestId("create-intent-sheet");
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(6);
    const said = radios.map((r) => r.textContent.replace(/\s+/g, " ").trim());
    expect(said[0]).toMatch(/^Sell goods/);
    expect(said[1]).toMatch(/^Offer a service/);
    expect(said[2]).toMatch(/^Post a rental/);
    expect(said[3]).toMatch(/^Publish an event/);
    expect(said[4]).toMatch(/^Create a local request/);
    expect(said[5]).toMatch(/^Start a community meetup/);
    // Every purpose explains itself in one line, so the choice needs no help.
    for (const text of said) expect(text.length).toBeGreaterThan(20);
  });

  it("is a radiogroup, so a keyboard can move through the purposes", () => {
    render(
      <MemoryRouter>
        <CreateIntentSheet value="goods" onSelect={() => {}} />
      </MemoryRouter>,
    );
    const group = screen.getByRole("radiogroup", { name: /what do you want to publish/i });
    const radios = within(group).getAllByRole("radio");
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);
    expect(screen.getByTestId("create-intent-goods")).toHaveAttribute("aria-checked", "true");
  });

  it("every purpose is a publishing path the server already understands", () => {
    for (const intent of CREATE_INTENTS) {
      expect(TYPE_FIELDS[intent.content_type], intent.id).toBeTruthy();
      expect(intent.to, intent.id).toContain(`type=${intent.content_type}`);
    }
  });

  it("the three trade purposes are one offer with three anchors", () => {
    const trade = CREATE_INTENTS.filter((i) => i.primary_category);
    expect(trade.map((i) => i.primary_category)).toEqual(["goods", "service", "rental"]);
    // One record type, three anchors — which is how the browse side reads them.
    expect(new Set(trade.map((i) => i.content_type)).size).toBe(1);
  });

  it("reads the purpose back out of a draft", () => {
    expect(intentForDraft({ content_type: "available", primary_category: "rental" })?.id).toBe("rental");
    expect(intentForDraft({ content_type: "wanted" })?.id).toBe("request");
    expect(intentForDraft({ content_type: "scheduled" })?.id).toBe("meetup");
    expect(intentForDraft({ content_type: "event" })?.id).toBe("event");
    // An offer with no anchor yet belongs to no purpose.
    expect(intentForDraft({ content_type: "available", primary_category: "" })).toBeNull();
  });
});

describe("Create opens on a purpose, not on a form", () => {
  it("shows the purpose sheet before anything else", async () => {
    const CreatePage = (await import("@/pages/create/CreatePage")).default;
    renderAt("/create", <CreatePage />);
    expect(screen.getByTestId("create-intent-sheet")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /what do you want to do/i }),
    ).toBeInTheDocument();
  });

  it("choosing a purpose sets the record type, the anchor and the address", async () => {
    const CreatePage = (await import("@/pages/create/CreatePage")).default;
    renderAt("/create", <CreatePage />);

    fireEvent.click(screen.getByTestId("create-intent-service"));

    // The offer now hangs off a service, and the form says so.
    const anchor = await screen.findByTestId("create-primary-category");
    await waitFor(() => expect(anchor).toHaveValue("service"));
    expect(screen.getByTestId("create-intent-service")).toHaveAttribute("aria-checked", "true");
    // And the person is told what they are making.
    expect(screen.getByTestId("create-intent-confirmation")).toHaveTextContent(
      /publishing a service/i,
    );
  });

  it("opens cold on a shared purpose link", async () => {
    const CreatePage = (await import("@/pages/create/CreatePage")).default;
    renderAt("/create?type=available&ledger=1&primary=rental", <CreatePage />);

    const anchor = await screen.findByTestId("create-primary-category");
    await waitFor(() => expect(anchor).toHaveValue("rental"));
    expect(screen.getByTestId("create-intent-rental")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("create-intent-confirmation")).toHaveTextContent(/publishing a rental/i);
  });

  it("offers one filled action from the purpose to the form", async () => {
    const CreatePage = (await import("@/pages/create/CreatePage")).default;
    renderAt("/create", <CreatePage />);

    // No purpose yet, so there is nothing to move to.
    expect(screen.queryByTestId("create-go-to-details")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("create-intent-goods"));
    const cta = await screen.findByTestId("create-go-to-details");
    expect(cta).toHaveTextContent(/go to the details/i);
    // Exactly one filled action on the page.
    expect(cta.className).toContain("ds-cta");
    // And it is safe to press in an environment with no scrolling.
    fireEvent.click(cta);
  });

  it("keeps the raw type pickers and the trade proof reachable", async () => {
    const CreatePage = (await import("@/pages/create/CreatePage")).default;
    renderAt("/create", <CreatePage />);

    // One disclosure holds the older doors. Nothing is deleted.
    const more = screen.getByTestId("create-more-formats");
    expect(more).toBeInTheDocument();
    expect(screen.getByTestId("create-verify-trade")).toBeInTheDocument();
    expect(screen.getByTestId("posting-type-wanted")).toBeInTheDocument();
    expect(screen.getByTestId("create-type-event")).toBeInTheDocument();
  });
});
