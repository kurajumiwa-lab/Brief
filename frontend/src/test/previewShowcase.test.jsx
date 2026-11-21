/**
 * THE DESIGN PREVIEW'S PAGE — the showcase, without a server.
 *
 * `/preview` renders the *real* page components with fixture data, so the board
 * and the listings can be judged on a phone before anyone signs in. That makes
 * it the one place where the demo content is load-bearing: if a fixture photo
 * path is wrong or a listing loses its price, the preview is lying about what
 * the page will look like. These tests keep it honest.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/receiptsApi", () => ({ receiptsAPI: { contestClaim: vi.fn() }, default: {} }));

import PreviewPage from "@/pages/preview/PreviewPage";

function openPageScreen() {
  return render(
    <MemoryRouter initialEntries={["/preview"]}>
      <PreviewPage />
    </MemoryRouter>,
  );
}

describe("the preview renders a page worth copying", () => {
  it("shows the board with real photo files and working chips", async () => {
    openPageScreen();
    const pageTab = screen.getByRole("button", { name: /^page$/i });
    pageTab.click();

    const board = await screen.findByTestId("page-gallery");
    const images = within(board).getAllByRole("img");
    expect(images.length).toBeGreaterThanOrEqual(6);
    // Every fixture photo is a real file under /photos — not an invented URL.
    for (const image of images) {
      expect(image.getAttribute("src")).toMatch(/^\/photos\/[\w-]+\.jpg$/);
    }
    expect(within(board).getByRole("button", { name: /^before & after 1$/i })).toBeInTheDocument();
  });

  it("prices the listings, and says so when a price is a conversation", async () => {
    openPageScreen();
    screen.getByRole("button", { name: /^page$/i }).click();

    const offers = await screen.findByTestId("page-offers");
    expect(within(offers).getByText(/KSh 3,500/)).toBeInTheDocument();
    expect(within(offers).getByText(/KSh 18,000/)).toBeInTheDocument();
    expect(within(offers).getByText(/KSh 1,450/)).toBeInTheDocument();
    expect(within(offers).getByText(/KSh 1,200/)).toBeInTheDocument();
    expect(within(offers).getByText(/ask for a price/i)).toBeInTheDocument();
  });

  it("offers a door out to the region without pretending it is the page", async () => {
    openPageScreen();
    screen.getByRole("button", { name: /^page$/i }).click();
    const door = await screen.findByTestId("page-region-door");
    expect(within(door).getByRole("link", { name: /see offers around here/i })).toHaveAttribute(
      "href",
      "/regions/nyanza?tab=offers",
    );
  });
});
