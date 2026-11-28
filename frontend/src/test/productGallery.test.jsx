import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import ProductGallery from "@/components/stock/ProductGallery";
import PhotoUploader from "@/components/media/PhotoUploader";
import { fileAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({ fileAPI: { uploadMany: vi.fn(), upload: vi.fn() }, apiError: (e, fallback) => e?.response?.data?.detail || e?.message || fallback }));
vi.mock("@/components/ui/Toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function Uploader() {
  const [photos, setPhotos] = useState([]);
  return <PhotoUploader value={photos} onChange={setPhotos} />;
}
beforeEach(() => vi.clearAllMocks());

describe("product photos", () => {
  it("lets a buyer view every recorded image and reports unavailable images", () => {
    render(<ProductGallery name="Beans" images={["https://example.com/1.jpg", "https://example.com/2.jpg"]} />);
    expect(screen.getByAltText("Beans, photo 1 of 2")).toHaveAttribute("src", "https://example.com/1.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(screen.getByAltText("Beans, photo 2 of 2")).toHaveAttribute("src", "https://example.com/2.jpg");
    fireEvent.error(screen.getByAltText("Beans, photo 2 of 2"));
    expect(screen.getByText("Photo unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show photo 1" }));
    expect(screen.getByAltText("Beans, photo 1 of 2")).toBeInTheDocument();
  });
  it("falls back to uploading every file when the batch endpoint fails", async () => {
    fileAPI.uploadMany.mockRejectedValue(new Error("batch unavailable"));
    fileAPI.upload.mockResolvedValueOnce({ data: { url: "/static/1.jpg" } }).mockResolvedValueOnce({ data: { url: "/static/2.jpg" } });
    render(<Uploader />);
    const files = [new File(["1"], "one.jpg", { type: "image/jpeg" }), new File(["2"], "two.jpg", { type: "image/jpeg" })];
    fireEvent.change(screen.getByLabelText("Choose photos from your gallery"), { target: { files } });
    await waitFor(() => expect(screen.getAllByTestId("photo-uploader-item")).toHaveLength(2));
    expect(fileAPI.upload).toHaveBeenCalledTimes(2);
  });
  it("shows partial batch failures rather than silently losing a photo", async () => {
    fileAPI.uploadMany.mockResolvedValue({ data: { files: [{ url: "/static/1.jpg" }], rejected: [{ filename: "two.jpg", reason: "too large" }] } });
    render(<Uploader />);
    fireEvent.change(screen.getByLabelText("Choose photos from your gallery"), { target: { files: [new File(["1"], "one.jpg"), new File(["2"], "two.jpg")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("two.jpg could not be read — too large");
    expect(screen.getAllByTestId("photo-uploader-item")).toHaveLength(1);
  });
});
