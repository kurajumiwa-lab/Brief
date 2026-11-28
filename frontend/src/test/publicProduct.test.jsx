import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PublicProductPage from "@/pages/catalogue/PublicProductPage";
import { offeringsAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({ offeringsAPI: { publicItem: vi.fn() } }));
const open = () => render(<MemoryRouter initialEntries={["/product/mama/abc"]}><Routes><Route path="/product/:handle/:id" element={<PublicProductPage />} /></Routes></MemoryRouter>);

describe("public product", () => {
  it("shows the seller's listing and links to the stock request flow", async () => {
    offeringsAPI.publicItem.mockResolvedValueOnce({ data: { title: "Bags", price: 300, price_mode: "fixed", price_unit: "each", quantity: 3, available: true, photos: [] } });
    open();
    expect(await screen.findByRole("heading", { name: "Bags" })).toBeInTheDocument();
    expect(screen.getByText(/KSh 300/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View and request/ })).toHaveAttribute("href", "/listing/abc");
    expect(offeringsAPI.publicItem).toHaveBeenCalledWith("mama", "goods", "abc");
  });
  it("does not show a request link when the product is unavailable", async () => {
    offeringsAPI.publicItem.mockRejectedValueOnce(new Error("not found"));
    open();
    expect(await screen.findByText("Product unavailable right now")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View and request/ })).not.toBeInTheDocument();
  });
});
