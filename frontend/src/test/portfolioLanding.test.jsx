/**
 * THE PAGE AS A LANDING PAGE.
 *
 * A stranger arrives from a WhatsApp forward. In one screen they should learn
 * who this is, what they do, that there is evidence behind it, and how to make
 * contact — without hunting through a storefront. The address should look like
 * a place (`ogallo.vendorworld.ke`), not an internal route, and the page should
 * carry the links people actually forward: WhatsApp first, then the rest.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PortfolioView from "@/components/you/PortfolioView";
import { rankFor } from "@/config/identity";
import { pageAddress } from "@/lib/pageShare";
import { receiptsAPI } from "@/lib/receiptsApi";

const VENDOR = {
  id: "v1",
  business_name: "Ogallo",
  vendor_handle: "ogallo",
  physical_location: "Kisumu, Nyanza",
  business_description:
    "I run a virtual kitchen in Kisumu. Ready meals for offices and small events — cooked to order, delivered within town.",
  allow_direct_calls: true,
  phone: "+254712000111",
  movements_completed: 7,
  created_at: "2026-08-02T09:00:00",
  is_verified: false,
};

const IDENTITY = {
  capabilities: ["sell_goods", "offer_services"],
  contact: { phone: "+254712000111", email: "ogallo@example.com", show_phone: true, show_email: true },
  affiliation: null,
  licence: null,
};

const PROFILE = {
  work_items: [
    {
      title: "Office lunch run, 40 covers",
      summary: "A weekly Friday lunch for a logistics office. Fourteen weeks without a missed delivery.",
      year: "2026",
    },
    { title: "Wedding reception, 120 guests", summary: "Three courses, two servers, one kitchen.", year: "2026" },
  ],
};

function mount(props = {}) {
  const rank = rankFor({ vendor: VENDOR, profile: PROFILE, identity: IDENTITY });
  return render(
    <MemoryRouter>
      <PortfolioView
        vendor={VENDOR}
        profile={PROFILE}
        identity={IDENTITY}
        rank={rank}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("a landing page, not a card", () => {
  it("leads with the person, the work and a visitable address", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "Ogallo" })).toBeInTheDocument();
    expect(screen.getByTestId("page-address")).toHaveTextContent(pageAddress("ogallo"));
    // No dot: with no owned domain, the address is the /p/ route that answers
    // rather than a subdomain of a host that does not exist.
    expect(screen.getByTestId("page-address")).toHaveTextContent("/p/ogallo");
    expect(screen.getByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(screen.getByTestId("selected-work")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Selected work" })).toBeInTheDocument();
  });

  it("makes contact one tap from the hero", () => {
    mount();
    const actions = screen.getByTestId("page-actions");
    expect(within(actions).getByRole("link", { name: /whatsapp/i }))
      .toHaveAttribute("href", "https://wa.me/254712000111");
    expect(within(actions).getByRole("link", { name: /^call$/i }))
      .toHaveAttribute("href", "tel:254712000111");
    expect(within(actions).getByRole("link", { name: /email/i }))
      .toHaveAttribute("href", "mailto:ogallo@example.com");
    expect(within(actions).getByRole("link", { name: /message/i })).toHaveAttribute("href", "/inbox");
  });

  it("offers quick links in the page, the sidebar and the footer", () => {
    mount();
    const quick = screen.getByTestId("quick-links");
    for (const label of ["Home", "Portfolio", "About", "Offers", "Contact", "All regions"]) {
      expect(within(quick).getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("navigation", { name: "Page sections" })).toBeInTheDocument();
    const footerNav = screen.getByRole("navigation", { name: "Quick links" });
    expect(within(footerNav).getByRole("link", { name: "Portfolio" })).toHaveAttribute("href", "#gallery");
  });

  it("passes the page on through WhatsApp and the other networks", () => {
    mount();
    const share = screen.getByTestId("page-share");
    const href = (name) => within(share).getByRole("link", { name }).getAttribute("href");
    // A recipient number makes WhatsApp a conversation, not just a forward.
    expect(href("WhatsApp")).toMatch(/^https:\/\/wa\.me\/254712000111/);
    expect(href("Telegram")).toContain("t.me/share/url");
    expect(href("Facebook")).toContain("facebook.com/sharer");
    expect(href("X")).toContain("twitter.com/intent");
    expect(href("Email")).toMatch(/^mailto:/);
    expect(within(share).getByRole("button", { name: /copy link/i })).toBeInTheDocument();
  });

  it("keeps the owner's tools and the visitor's path apart", () => {
    mount({ isOwner: true });
    expect(screen.getByRole("link", { name: /^edit$/i })).toHaveAttribute("href", "/you/page");
    expect(screen.queryByRole("link", { name: /^message$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open your inbox/i })).toBeInTheDocument();
  });

  it("does not invent contact routes that were not published", () => {
    mount({
      identity: { capabilities: ["offer_services"] },
      vendor: { ...VENDOR, allow_direct_calls: false, phone: null },
    });
    const actions = screen.getByTestId("page-actions");
    expect(within(actions).queryByRole("link", { name: /^whatsapp$/i })).not.toBeInTheDocument();
    expect(within(actions).queryByRole("link", { name: /^call$/i })).not.toBeInTheDocument();
    expect(within(actions).getByText(/contact routes are not published yet/i)).toBeInTheDocument();
    // Sharing the page itself still works; only the direct routes are absent.
    expect(within(screen.getByTestId("page-share")).getByRole("link", { name: /whatsapp/i }).getAttribute("href"))
      .toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it("lets a visitor contest a claimed shop on /p/handle and freeze it into contested status", async () => {
    const spy = vi.spyOn(receiptsAPI, "contestClaim").mockResolvedValue({
      data: {
        merchant: {
          pin: "P051234567X",
          name: "Kisumu Fresh Mart",
          claim_status: "contested",
          claim_status_label: "Ownership contested",
          contested: true,
          probationary: false,
          verified: false,
        },
      },
    });
    mount({
      isOwner: false,
      vendor: {
        ...VENDOR,
        claimed_merchants: [
          {
            pin: "P051234567X",
            name: "Kisumu Fresh Mart",
            claim_status: "probationary",
            claim_status_label: "Probationary owner",
            probationary: true,
            contested: false,
            verified: false,
          },
        ],
      },
    });

    expect(screen.getByTestId("page-claimed-shop")).toHaveTextContent("Kisumu Fresh Mart");
    expect(screen.getByTestId("page-claimed-shop-status")).toHaveTextContent("Probationary owner");
    fireEvent.click(screen.getByTestId("page-contest-open"));
    fireEvent.change(screen.getByTestId("page-contest-reason"), {
      target: { value: "This is my shop in Kisumu and I hold the ETR." },
    });
    fireEvent.click(screen.getByTestId("page-contest-submit"));

    await waitFor(() => expect(spy).toHaveBeenCalledWith(
      "P051234567X",
      expect.objectContaining({ reason: expect.stringContaining("This is my shop") }),
    ));
    expect(await screen.findByTestId("page-claimed-shop-status")).toHaveTextContent("Ownership contested");
    spy.mockRestore();
  });
});

/**
 * THE BOARD AND THE LISTINGS — the two things a visitor looks at before reading.
 *
 * A page is judged in pictures and prices: has this person done the work, and
 * what does it cost? Both were missing from the first version of the page — the
 * work list was text-only and the offers were two buttons pointing at a region
 * feed. These tests hold the board to its rules: real photos only, the owner's
 * controls kept apart from the visitor's, and a removal that actually saves.
 */
describe("the gallery board and the page's own offers", () => {
  const BOARD = [
    { image_url: "/static/uploads/a.jpg", caption: "Deep clean, Milimani", tag: "work" },
    { image_url: "/static/uploads/b.jpg", caption: "The team", tag: "team" },
    { image_url: "/static/uploads/c.jpg", caption: "Before the clean", tag: "before-after" },
  ];

  const OFFERS = [
    { kind: "service", id: "o1", title: "Deep clean — 3-bedroom", price: 3500, price_unit: "per visit", price_mode: "fixed", available: true, duration_minutes: 180, photos: [] },
    { kind: "goods", id: "o2", title: "Cleaning starter pack", price: 1450, price_unit: "per pack", price_mode: "fixed", available: true, quantity: 24, photos: [] },
    { kind: "service", id: "o3", title: "Move-out clean", price: null, price_mode: "ask_me", available: true, photos: [] },
  ];

  it("shows the photos as a board with working chips", () => {
    mount({ profile: { ...PROFILE, gallery_items: BOARD } });
    const board = screen.getByTestId("page-gallery");
    expect(within(board).getByRole("heading", { name: "Portfolio" })).toBeInTheDocument();
    expect(within(board).getAllByRole("img")).toHaveLength(3);
    // Counts come from the photos actually on the page, never from a promise.
    const teamChip = within(board).getByRole("button", { name: /^the team 1$/i });
    expect(teamChip).toHaveTextContent("1");
    fireEvent.click(teamChip);
    expect(within(screen.getByTestId("gallery-grid")).getAllByRole("img")).toHaveLength(1);
  });

  it("opens a photo at full size and closes it with Escape", () => {
    mount({ profile: { ...PROFILE, gallery_items: BOARD } });
    const grid = screen.getByTestId("gallery-grid");
    fireEvent.click(within(grid).getByRole("button", { name: /deep clean/i }));
    expect(screen.getByTestId("gallery-lightbox")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("gallery-lightbox")).not.toBeInTheDocument();
  });

  it("shows a visitor nothing when the board is empty", () => {
    mount();
    expect(screen.queryByTestId("page-gallery")).not.toBeInTheDocument();
  });

  it("lets the owner add and remove, and saves the whole list", async () => {
    const onSaveGallery = vi.fn().mockResolvedValue(undefined);
    mount({ profile: { ...PROFILE, gallery_items: BOARD }, isOwner: true, onSaveGallery });
    expect(screen.getByTestId("gallery-add")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove photo: before the clean/i }));
    await waitFor(() => expect(onSaveGallery).toHaveBeenCalledTimes(1));
    expect(onSaveGallery.mock.calls[0][0].map((item) => item.caption)).toEqual([
      "Deep clean, Milimani",
      "The team",
    ]);
  });

  it("puts the page's own listings and prices on the page", () => {
    mount({ offers: OFFERS });
    const section = screen.getByTestId("page-offers");
    expect(within(section).getByText("Deep clean — 3-bedroom")).toBeInTheDocument();
    expect(within(section).getByText(/KSh 3,500/)).toBeInTheDocument();
    expect(within(section).getByText(/KSh 1,450/)).toBeInTheDocument();
    // An "ask me" price says so; it is never shown as zero.
    expect(within(section).getByText(/ask for a price/i)).toBeInTheDocument();
  });

  it("gives the owner a way to publish an offer and a visitor nothing to edit", () => {
    mount({ offers: [], isOwner: true });
    expect(within(screen.getByTestId("page-offers-empty")).getByRole("link", { name: /add an offer/i })).toHaveAttribute("href", "/you/page");
    unmountAll();
    mount({ offers: OFFERS, isOwner: false });
    expect(within(screen.getByTestId("page-offers")).queryByRole("link", { name: /add or edit/i })).not.toBeInTheDocument();
  });
});

function unmountAll() {
  document.body.innerHTML = "";
}
