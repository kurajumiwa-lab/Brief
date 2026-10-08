import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import FileUpload from "@/components/ui/FileUpload";
import { toast } from "@/components/ui/Toast";
import QualityBadge from "./QualityBadge";
import { useStockStore } from "@/stores/stockStore";
import { stockAPI, apiError } from "@/lib/api";
import { toLocalInput } from "@/lib/formatters";

/**
 * Declare provenance for an item (v2.1 §3.1): batch, origin, expiry and an
 * optional spec sheet / certificate. With a sheet on file the vendor can mark
 * it lab-certified; without one the item becomes self-declared.
 */
export default function StockVerifyDialog({ item, open, onClose, onDone }) {
  const [form, setForm] = useState({ batch_number: "", origin_country: "", expiry_date: "", lab_certified: false });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const replaceItem = useStockStore((s) => s.replaceItem);

  useEffect(() => {
    if (!item) return;
    setForm({
      batch_number: item.batch_number || "",
      origin_country: item.origin_country || "",
      expiry_date: item.expiry_date ? toLocalInput(item.expiry_date).slice(0, 10) : "",
      lab_certified: item.quality_status === "lab_certified",
    });
    setFile(null);
  }, [item]);

  if (!item) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const hasSheet = !!(file || item.spec_sheet_url);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.batch_number.trim()) return toast.error("A batch or lot number is required");
    if (form.lab_certified && !hasSheet) return toast.error("Attach the certificate to mark it lab-certified");
    setSaving(true);
    try {
      const { data } = await stockAPI.verify(
        item.id,
        {
          batch_number: form.batch_number.trim(),
          origin_country: form.origin_country.trim(),
          expiry_date: form.expiry_date ? new Date(form.expiry_date).toISOString() : "",
          lab_certified: form.lab_certified ? "true" : "",
        },
        file
      );
      if (data.item) replaceItem?.(data.item);
      toast.success(data.message || "Provenance recorded");
      onDone?.(data.item);
      onClose?.();
    } catch (err) {
      toast.error(apiError(err, "Couldn't record provenance"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Verify · ${item.name}`} description="Buyers see the batch, origin and any certificate on the card. A patron of a list you're on can then upgrade it to patron-verified.">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-ink-3">
          Currently <QualityBadge status={item.quality_status} showUnverified size="sm" />
          {item.spec_sheet_url && (
            <a href={item.spec_sheet_url} target="_blank" rel="noreferrer" className="ml-auto text-brand-600 dark:text-brand-400 hover:underline">
              Current sheet
            </a>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="Batch / lot number" required value={form.batch_number} onChange={set("batch_number")} placeholder="MWEA-0927" className="font-mono" />
          <Input label="Origin country" value={form.origin_country} onChange={set("origin_country")} placeholder="Kenya" />
          <Input label="Expiry / best-before" type="date" value={form.expiry_date} onChange={set("expiry_date")} />
        </div>
        <FileUpload file={file} onFile={setFile} accept=".pdf,.png,.jpg,.jpeg,.webp" label="Spec sheet or certificate" hint="PDF or image, up to the upload limit. Stored with the item." />
        <label className="flex items-center gap-2.5 rounded-lg border border-edge-1 bg-surface-1 px-3 py-2.5 cursor-pointer">
          <input type="checkbox" checked={form.lab_certified} onChange={set("lab_certified")} disabled={!hasSheet} className="accent-brand-500 w-4 h-4" />
          <span className="text-sm text-ink-2">Lab-certified</span>
          <span className="ml-auto text-2xs text-ink-4">{hasSheet ? "the attached document is a lab certificate" : "attach the certificate first"}</span>
        </label>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save provenance
          </Button>
        </div>
      </form>
    </Modal>
  );
}
