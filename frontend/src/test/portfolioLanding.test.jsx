/**
 * THE PAGE AS A LANDING PAGE.
 *
 * A stranger arrives from a WhatsApp forward. In one screen they should learn
 * who this is, what they do, that there is evidence behind it, and how to make
 * contact — without hunting through a storefront. The address should look like
 * a place (`ogallo.vendorworld.ke`), not an internal route, and the page should
 * carry the links people actually forward: WhatsApp first, then the rest.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PortfolioView from "@/components/you/PortfolioView";
import { rankFor } from "@/config/identity";
import { pageAddress } from "@/lib/pageShare";

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
    expect(screen.getByTestId("page-address")).toHaveTextContent(/\./);
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
    for (const label of ["Home", "About", "Selected work", "Offers", "Contact", "All regions"]) {
      expect(within(quick).getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("navigation", { name: "Page sections" })).toBeInTheDocument();
    const footerNav = screen.getByRole("navigation", { name: "Quick links" });
    expect(within(footerNav).getByRole("link", { name: "Selected work" })).toHaveAttribute("href", "#work");
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
});
