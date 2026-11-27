import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  Check,
  FileSpreadsheet,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import PhotoUploader from "@/components/media/PhotoUploader";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  "Florists & flower growers",
  "Pottery & handicrafts",
  "Hardware & general stores",
  "Other",
];

const SAMPLE_DETECTIONS = [
  { id: "d1", name: "Red rose bouquet", category: "Florists & flower growers", quantity: 3, price: "", confidence: 0.94, approved: true },
  { id: "d2", name: "White lilies", category: "Florists & flower growers", quantity: 5, price: "", confidence: 0.91, approved: true },
  { id: "d3", name: "Potted orchids", category: "Florists & flower growers", quantity: 2, price: "1200", confidence: 0.88, approved: true },
  { id: "d4", name: "Small flower baskets", category: "Pottery & handicrafts", quantity: 4, price: "", confidence: 0.82, approved: true },
  { id: "d5", name: "Ceramic flower pots", category: "Pottery & handicrafts", quantity: 6, price: "650", confidence: 0.86, approved: true },
];

export default function PhotoCataloguePage() {
  const [photos, setPhotos] = useState([]);
  const [detecting, setDetecting] = useState(false);
  const [items, setItems] = useState([]);
  const [published, setPublished] = useState(false);
  const [quoteQuantities, setQuoteQuantities] = useState({});
  const [quoteSent, setQuoteSent] = useState(false);

  const approvedItems = items.filter((item) => item.approved);

  function runDetection(useSample = false) {
    if (!useSample && photos.length === 0) {
      toast.error("Upload at least one stock photo first.");
      return;
    }
    setDetecting(true);
    setPublished(false);
    setQuoteSent(false);
    window.setTimeout(() => {
      setItems(SAMPLE_DETECTIONS.map((d) => ({ ...d, id: `${d.id}-${Date.now()}` })));
      setDetecting(false);
      toast.success("Draft catalogue generated — review and verify items below.");
    }, 500);
  }

  function updateItem(id, patch) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function addBlankItem() {
    setItems((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        name: "",
        category: CATEGORIES[0],
        quantity: 1,
        price: "",
        confidence: 1,
        approved: true,
      },
    ]);
  }

  function publishCatalogue() {
    if (approvedItems.length === 0) {
      toast.error("Approve at least one item before publishing.");
      return;
    }
    setPublished(true);
    toast.success(`${approvedItems.length} product${approvedItems.length === 1 ? "" : "s"} published to your catalogue.`);
  }

  function submitQuoteRequest(e) {
    e.preventDefault();
    const selected = approvedItems.filter((item) => Number(quoteQuantities[item.id] || 0) > 0);
    if (selected.length === 0) {
      toast.error("Select a quantity for at least one item to request a quote.");
      return;
    }
    setQuoteSent(true);
    toast.success(`Price enquiry sent for ${selected.length} item${selected.length === 1 ? "" : "s"}.`);
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-4 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link
            to="/you"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-3 hover:text-ink-1"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Back to Profile
          </Link>
          <h1 className="mt-1 text-xl font-extrabold tracking-tight text-ink-1">
            Photo-to-Catalogue &amp; Quotations
          </h1>
          <p className="mt-0.5 text-xs text-ink-3">
            Photograph your stock, verify detected products, and collect structured price enquiries.
          </p>
        </div>
        <Badge tone="brand">Beta</Badge>
      </div>

      {/* Step 1: Photo Upload */}
      <Card>
        <CardHeader>
          <CardTitle>1. Upload stock photographs</CardTitle>
        </CardHeader>
        <p className="mb-3 text-xs text-ink-3">
          Upload one or multiple photos of your shelf, greenhouse, or workshop.
        </p>
        <PhotoUploader
          files={photos}
          onChange={setPhotos}
          maxFiles={12}
        />
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            icon={Camera}
            loading={detecting}
            onClick={() => runDetection(false)}
          >
            Detect products
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon={Sparkles}
            loading={detecting}
            onClick={() => runDetection(true)}
          >
            Try sample Kiambu stock
          </Button>
        </div>
      </Card>

      {/* Step 2: Human Verification & Draft Catalogue */}
      {items.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>2. Verify draft catalogue ({approvedItems.length} approved)</CardTitle>
              <Button type="button" size="sm" variant="secondary" icon={Plus} onClick={addBlankItem}>
                Add item
              </Button>
            </div>
          </CardHeader>
          <p className="mb-4 text-xs text-ink-3">
            Confirm or correct product names, categories, quantities, and unit prices (KES) before publishing. Leave price blank for <strong>Awaiting quote</strong>.
          </p>

          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "rounded-2xl border p-3.5 transition-colors",
                  item.approved
                    ? "border-[#176B53]/30 bg-[#E7F1EC]/50 dark:border-brand-500/30 dark:bg-brand-500/10"
                    : "border-edge-1 bg-surface-0 opacity-75",
                )}
              >
                <div className="grid gap-3 sm:grid-cols-12 sm:items-end">
                  <div className="sm:col-span-4">
                    <Input
                      label="Product name"
                      value={item.name}
                      onChange={(e) => updateItem(item.id, { name: e.target.value })}
                      placeholder="e.g. Ceramic flower pot"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-2xs font-bold text-ink-2">
                      Category
                      <select
                        value={item.category}
                        onChange={(e) => updateItem(item.id, { category: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-edge-1 bg-surface-1 px-2.5 py-2 text-xs text-ink-1"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="sm:col-span-2">
                    <Input
                      label="Qty"
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Input
                      label="Price (KES)"
                      type="number"
                      min={0}
                      placeholder="Awaiting quote"
                      value={item.price}
                      onChange={(e) => updateItem(item.id, { price: e.target.value })}
                    />
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-micro text-ink-4">
                    Confidence: {Math.round((item.confidence || 1) * 100)}%
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateItem(item.id, { approved: !item.approved })}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-micro font-bold",
                        item.approved
                          ? "bg-[#103D32] text-white"
                          : "bg-surface-2 text-ink-3",
                      )}
                    >
                      <Check size={12} aria-hidden="true" />
                      {item.approved ? "Approved" : "Approve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      aria-label="Remove item"
                      className="rounded-lg p-1.5 text-ink-4 hover:bg-surface-2 hover:text-ink-1"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge-1 pt-4">
            <span className="text-xs text-ink-3">
              {approvedItems.length} of {items.length} items ready to publish
            </span>
            <Button type="button" icon={FileSpreadsheet} onClick={publishCatalogue}>
              {published ? "Update published catalogue" : "Publish catalogue"}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 3: Buyer Price Enquiry / Quotation */}
      {published && approvedItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>3. Request a consolidated quotation</CardTitle>
          </CardHeader>
          <p className="mb-4 text-xs text-ink-3">
            Buyers can select quantities from your published items to request unit, wholesale, and delivery quotes.
          </p>
          <form onSubmit={submitQuoteRequest} className="space-y-3">
            {approvedItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-edge-1 bg-surface-0 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-ink-1">{item.name || "Unnamed item"}</p>
                  <p className="text-micro text-ink-4">
                    {item.category} · {item.price ? `KES ${item.price}` : "Awaiting quote"} · {item.quantity} in stock
                  </p>
                </div>
                <input
                  type="number"
                  min={0}
                  placeholder="Qty"
                  aria-label={`Request quantity for ${item.name}`}
                  value={quoteQuantities[item.id] || ""}
                  onChange={(e) =>
                    setQuoteQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))
                  }
                  className="w-20 rounded-xl border border-edge-1 bg-surface-1 px-2.5 py-1.5 text-xs text-ink-1"
                />
              </div>
            ))}

            <div className="flex items-center justify-between gap-3 pt-2">
              {quoteSent ? (
                <span className="text-xs font-bold text-[#103D32] dark:text-brand-400">
                  Quotation request sent! Vendor will reply with unit &amp; delivery pricing.
                </span>
              ) : (
                <span className="text-micro text-ink-4">Enter desired quantities to send an enquiry.</span>
              )}
              <Button type="submit" icon={Send}>
                Send price enquiry
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
