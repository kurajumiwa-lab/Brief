import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PortfolioView from "@/components/you/PortfolioView";

vi.mock("@/lib/api", () => ({
  professionalAPI: { page: vi.fn() },
  vendorAPI: { byHandle: vi.fn() },
  offeringsAPI: { of: vi.fn().mockResolvedValue({ data: { items: [], counts: {} } }) },
  socialTrustAPI: {},
  receiptsAPI: {},
  apiError: (_e, fallback) => fallback,
}));

vi.mock("@/components/you/GalleryBoard", () => ({
  default: ({ onAdd }) => (
    <button type="button" data-testid="gallery-add" onClick={onAdd}>
      add a photo
    </button>
  ),
  AddGalleryModal: ({ open, onClose }) =>
    open ? (
      <div data-testid="gallery-sheet">
        photo sheet
        <button type="button" onClick={onClose}>close</button>
      </div>
    ) : null,
}));

const profile = {
  bio: "We visit you.",
  gallery_items: [],
  portfolio_images: [],
  capabilities: [],
};

const renderAt = (url) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/p/:handle"
          element={
            <PortfolioView
              vendor={{ vendor_handle: "amina", business_name: "Amina" }}
              profile={profile}
              isOwner
              onSaveGallery={vi.fn()}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );

describe("the one address for adding photos", () => {
  it("/p/<handle>?add=photos opens the sheet on arrival", async () => {
    renderAt("/p/amina?add=photos");
    await waitFor(() => expect(screen.getByTestId("gallery-sheet")).toBeInTheDocument());
  });

  it("without the parameter the sheet stays shut", async () => {
    renderAt("/p/amina");
    expect(screen.getByTestId("gallery-add")).toBeInTheDocument();
    expect(screen.queryByTestId("gallery-sheet")).not.toBeInTheDocument();
  });
});
