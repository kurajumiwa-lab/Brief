/**
 * THE PAGE AS THE SERVER ACTUALLY RETURNS IT.
 *
 * `page-showcase.json` is a **captured** payload: the output of
 * `seed_showcase.py` read back through `GET /api/vendors/{handle}` and
 * `GET /api/offerings/of/{handle}`. Fixtures written by hand drift from the API
 * they claim to represent; this one cannot, because nothing in it was typed.
 *
 * The tests below are about the *seam*: the shape the server sends has to be the
 * shape the page reads, or a business with photos and prices looks empty. A
 * gallery is the one surface where that failure is invisible — a wrong key
 * renders as "no photos yet", which reads as "this person has none".
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/receiptsApi", () => ({ receiptsAPI: { contestClaim: vi.fn() }, default: {} }));

import PortfolioView from "@/components/you/PortfolioView";
import { rankFor } from "@/config/identity";
import captured from "./fixtures/page-showcase.json";

const { vendor, offers } = captured;

function mount(props = {}) {
  const rank = rankFor({ vendor, identity: {} });
  return render(
    <MemoryRouter>
      <PortfolioView
        vendor={vendor}
        profile={{
          about: vendor.business_description,
          work_items: vendor.work_items,
          gallery_items: vendor.gallery_items,
        }}
        offers={offers}
        identity={{}}
        rank={rank}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("a seeded page really shows its photos and prices", () => {
  it("renders every captured photo, with the chips the server counted", () => {
    mount();
    const board = screen.getByTestId("page-gallery");
    expect(within(board).getAllByRole("img")).toHaveLength(vendor.gallery_items.length);

    // Every chip count on screen must match the server's own count.
    for (const [tag, count] of Object.entries(vendor.gallery_tags)) {
      if (!count) continue;
      const label = {
        work: /^our work/i,
        "before-after": /^before & after/i,
        premises: /^premises/i,
        team: /^the team/i,
        product: /^products/i,
        event: /^events/i,
        other: /^other/i,
      }[tag];
      expect(within(board).getByRole("button", { name: new RegExp(`${label.source} ${count}$`, "i") }))
        .toBeInTheDocument();
    }
  });

  it("shows a listing for every live offer, with the price the API returned", () => {
    mount();
    const section = screen.getByTestId("page-offers");
    for (const offer of offers) {
      expect(within(section).getByText(offer.title)).toBeInTheDocument();
      if (offer.price_mode !== "ask_me" && offer.price != null) {
        expect(within(section).getByText(new RegExp(`KSh ${Number(offer.price).toLocaleString("en-KE")}`))).toBeInTheDocument();
      }
    }
    // The 'ask me' listing is never rendered as a number.
    expect(within(section).getByText(/ask for a price/i)).toBeInTheDocument();
  });

  it("puts the hero strip above the board, and names the same count", () => {
    mount();
    const strip = screen.getByTestId("page-hero-strip");
    expect(within(strip).getByText(new RegExp(`^${vendor.gallery_items.length} photos$`))).toBeInTheDocument();
    expect(within(strip).getByRole("link", { name: /see the board/i })).toHaveAttribute("href", "#gallery");
  });

  it("keeps the work cards separate from the photographs", () => {
    mount();
    const work = screen.getByTestId("selected-work");
    for (const card of vendor.work_items) {
      expect(within(work).getByText(card.title)).toBeInTheDocument();
    }
    // The board holds the photos; the work list holds the proof. Neither leaks.
    const board = screen.getByTestId("page-gallery");
    for (const card of vendor.work_items) {
      expect(within(board).queryByText(card.title)).not.toBeInTheDocument();
    }
  });
});
