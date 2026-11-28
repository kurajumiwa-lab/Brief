import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PhotoCataloguePage from "@/pages/catalogue/PhotoCataloguePage";
import { offeringsAPI, photoCatalogueAPI } from "@/lib/api";
import { readGalleryPhoto } from "@/lib/images";

vi.mock("@/lib/api", () => ({ offeringsAPI: { create: vi.fn() }, photoCatalogueAPI: { analyse: vi.fn() }, apiError: (_e, fallback) => fallback }));
vi.mock("@/stores/authStore", () => ({ useAuthStore: (selector) => selector({ vendor: { vendor_handle: "mama" } }) }));
vi.mock("@/lib/images", () => ({ readGalleryPhoto: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); readGalleryPhoto.mockResolvedValue("/static/uploads/photo.jpg"); });
const open = () => render(<MemoryRouter><PhotoCataloguePage /></MemoryRouter>);
const fill = (name, qty) => {
  fireEvent.change(screen.getByLabelText(/What is the product/), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/How many/), { target: { value: qty } });
};

describe("photo product entry", () => {
  it("asks for consent, reviews multiple suggestions and saves answers with each real offering", async () => {
    offeringsAPI.create.mockResolvedValue({ data: { id: "1" } });
    photoCatalogueAPI.analyse.mockResolvedValue({ data: { items: [{ name: "Tomatoes", questions: ["Which variety?"] }, { name: "Onions", questions: [] }] } });
    open();
    const file = new File(["image"], "shelf.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Choose photos"), { target: { files: [file] } });
    expect(await screen.findByText("shelf.jpg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggest products" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Suggest products" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tomatoes" }));
    expect(screen.getByLabelText(/What is the product/)).toHaveValue("Tomatoes");
    fireEvent.change(screen.getByLabelText(/Which variety/), { target: { value: "Plum" } });
    fireEvent.change(screen.getByLabelText(/How many/), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/Price \(KES/), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));
    await waitFor(() => expect(offeringsAPI.create).toHaveBeenCalledWith({ kind: "goods", title: "Tomatoes", quantity: 4, price_mode: "fixed", price: 120, description: "Which variety? Plum", photos: ["/static/uploads/photo.jpg"] }));
    fireEvent.click(screen.getByRole("button", { name: "Onions" }));
    fireEvent.change(screen.getByLabelText(/How many/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));
    await waitFor(() => expect(offeringsAPI.create).toHaveBeenLastCalledWith({ kind: "goods", title: "Onions", quantity: 2, price_mode: "ask_me", photos: ["/static/uploads/photo.jpg"] }));
    expect(photoCatalogueAPI.analyse).toHaveBeenCalledWith([file], "en", "", "openai");
  });
  it("accepts a text prompt and gives a public share link only after saving", async () => {
    photoCatalogueAPI.analyse.mockResolvedValue({ data: { items: [{ name: "Bags", questions: [] }] } });
    offeringsAPI.create.mockResolvedValue({ data: { id: "item-123" } });
    open();
    fireEvent.change(screen.getByLabelText(/What would you like to list/), { target: { value: "I sell bags" } });
    expect(screen.queryByRole("link", { name: "Share on WhatsApp" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Suggest products" }));
    fireEvent.click(await screen.findByRole("button", { name: "Bags" }));
    fireEvent.change(screen.getByLabelText(/How many/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));
    const share = await screen.findByRole("link", { name: "Share on WhatsApp" });
    expect(decodeURIComponent(share.href)).toContain("/product/mama/item-123");
    expect(photoCatalogueAPI.analyse).toHaveBeenCalledWith([], "en", "I sell bags", "openai");
  });

  it("requires fresh consent after choosing Gemini", async () => {
    photoCatalogueAPI.analyse.mockResolvedValue({ data: { items: [] } });
    open();
    fireEvent.change(screen.getByLabelText(/What would you like to list/), { target: { value: "bags" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("AI provider"), { target: { value: "gemini" } });
    expect(screen.getByText(/send this description and any photos to Google Gemini/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Suggest products" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Suggest products" }));
    await waitFor(() => expect(photoCatalogueAPI.analyse).toHaveBeenCalledWith([], "en", "bags", "gemini"));
  });

  it("keeps failed input for retry and never claims it was saved", async () => {
    offeringsAPI.create.mockRejectedValueOnce(new Error("offline"));
    open(); fill("Mangoes", "3");
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    expect(screen.getByLabelText(/What is the product/)).toHaveValue("Mangoes");
    expect(screen.queryByText("Saved to your desk")).not.toBeInTheDocument();
  });
  it("refuses invalid quantities without sending a request", () => {
    open(); fill("Mangoes", "-1");
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/whole stock quantity/);
    expect(offeringsAPI.create).not.toHaveBeenCalled();
  });
});
