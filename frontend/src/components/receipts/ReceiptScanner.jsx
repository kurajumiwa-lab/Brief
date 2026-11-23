import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Camera, Check, ImagePlus, Keyboard, QrCode, ScanLine, ShieldCheck,
} from "lucide-react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useQrScanner } from "@/hooks/useQrScanner";
import { useReceiptStore } from "@/stores/receiptStore";
import { useAuthStore } from "@/stores/authStore";
import { regionFromPlace } from "@/config/regions";
import { formatKes, parseReceiptPayload, receiptValue } from "@/lib/receipts";

/**
 * THE SCAN SHEET — where a receipt becomes a fact.
 *
 * Three ways in, in order of trust: the camera reads the QR on the device; a
 * pasted verification link is parsed the same way; typing the printed fields
 * records the receipt without points. The difference is shown, not hidden —
 * a manual record says so and earns nothing, because otherwise the ledger is
 * just a text box with a reward attached.
 */
export default function ReceiptScanner({ open, onClose }) {
  const addReceipt = useReceiptStore((s) => s.addReceipt);
  const vendor = useAuthStore((s) => s.vendor);
  const region = regionFromPlace(vendor?.physical_location || "") || null;
  const [step, setStep] = useState("scan");
  const [raw, setRaw] = useState("");
  const [candidate, setCandidate] = useState(null);
  const [manual, setManual] = useState({ merchant: "", invoice: "", pin: "", total: "" });
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const read = (value) => {
    const parsed = parseReceiptPayload(value);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    // Keep the raw payload: the server parses the same evidence rather than
    // trusting this device's summary of it.
    setCandidate({ ...parsed.receipt, raw_payload: value, region });
    setStep("confirm");
  };

  const { videoRef, start, stop, scanImage, active, error: cameraError, supported } = useQrScanner({
    onResult: read,
  });

  useEffect(() => {
    if (!open) return undefined;
    setStep("scan");
    setRaw("");
    setCandidate(null);
    setResult(null);
    setError(null);
    setManual({ merchant: "", invoice: "", pin: "", total: "" });
    const timer = supported ? setTimeout(() => start(), 80) : null;
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
    // `start`/`stop` are stable callbacks; the sheet resets only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const preview = useMemo(() => {
    if (!candidate?.total) return null;
    return receiptValue({ total: candidate.total, issued_at: candidate.issued_at });
  }, [candidate]);

  const status = candidate?.verified ? "verified" : candidate?.source === "manual" ? "manual" : "partial";
  const earning = status === "verified" ? 1 : status === "manual" ? 0 : 0.5;
  const points = preview ? Math.round(preview.points * earning) : 0;

  function save() {
    if (!candidate) return;
    if (!candidate.total) {
      setError("Enter the total printed on the receipt. Points are based on what was actually paid.");
      return;
    }
    const saved = addReceipt({ ...candidate, verified: status !== "manual" && candidate.verified });
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setError(null);
    setResult(saved);
    setStep("done");
  }

  function saveManual(event) {
    event.preventDefault();
    const total = Number(String(manual.total).replace(/[^\d.]/g, ""));
    if (!manual.merchant.trim() || !total) {
      setError("A merchant name and the amount paid are the minimum for a record.");
      return;
    }
    const saved = addReceipt({
      merchant: manual.merchant.trim(),
      invoice: manual.invoice.trim(),
      pin: manual.pin.trim(),
      total,
      issued_at: new Date().toISOString(),
      verified: false,
      source: "manual",
      raw_payload: null,
      region,
    });
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setError(null);
    setResult(saved);
    setStep("done");
  }

  async function onFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const value = await scanImage(file);
    if (value) read(value);
    else setError("No QR code was found in that image.");
  }

  const title =
    step === "done" ? "Receipt recorded" : step === "confirm" ? "Confirm the receipt" : "Scan a receipt";

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <div className="space-y-4 px-1 pb-1" data-testid="receipt-scanner">
        {step === "scan" && (
          <>
            <div className="relative overflow-hidden rounded-2xl border border-edge-1 bg-ink-1">
              <video
                ref={videoRef}
                className="aspect-[4/3] w-full object-cover"
                muted
                playsInline
                aria-label="Receipt camera"
              />
              {!active && (
                <div className="absolute inset-0 grid place-items-center bg-ink-1/80 p-6 text-center">
                  <div>
                    <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/10 text-white">
                      <QrCode size={24} aria-hidden="true" />
                    </span>
                    <p className="mt-3 text-xs font-bold text-white">
                      Point the camera at the QR on the receipt
                    </p>
                    <p className="mx-auto mt-1 max-w-xs text-micro leading-relaxed text-white/70">
                      Reading happens on this phone. No photograph of the receipt is uploaded.
                    </p>
                    {supported && (
                      <button
                        type="button"
                        onClick={start}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-micro font-bold text-ink-1"
                      >
                        <Camera size={13} aria-hidden="true" /> Start camera
                      </button>
                    )}
                  </div>
                </div>
              )}
              {active && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="h-40 w-40 rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,.35)]" />
                </div>
              )}
            </div>

            {(error || cameraError) && (
              <p data-testid="receipt-error" className="flex items-start gap-2 rounded-xl border border-accent-200 bg-accent-50 px-3 py-2 text-2xs text-accent-800 dark:border-accent-500/30 dark:bg-accent-500/10 dark:text-accent-200">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                {error || cameraError}
              </p>
            )}

            <div className="rounded-xl border border-edge-1 bg-surface-1 p-3">
              <p className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.1em] text-ink-4">
                <Keyboard size={12} aria-hidden="true" /> No camera? Paste the receipt link
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  value={raw}
                  onChange={(event) => setRaw(event.target.value)}
                  placeholder="https://etims.kra.go.ke/… or receipt data"
                  aria-label="Receipt link or QR data"
                  data-testid="receipt-paste"
                  className="h-10 min-w-0 flex-1 rounded-xl border border-edge-1 bg-surface-0 px-3 text-xs text-ink-1 placeholder:text-ink-4 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                <Button size="sm" variant="secondary" icon={ScanLine} onClick={() => read(raw)} disabled={!raw.trim()}>
                  Read
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-edge-1 bg-surface-0 px-2.5 py-1.5 text-micro font-bold text-ink-3 hover:border-edge-2 hover:text-ink-1">
                  <ImagePlus size={12} aria-hidden="true" />
                  Use a photo
                  <input type="file" accept="image/*" className="sr-only" onChange={onFile} />
                </label>
                <button
                  type="button"
                  onClick={() => { setStep("manual"); setError(null); }}
                  data-testid="receipt-manual-open"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-edge-1 bg-surface-0 px-2.5 py-1.5 text-micro font-bold text-ink-3 hover:border-edge-2 hover:text-ink-1"
                >
                  <Keyboard size={12} aria-hidden="true" /> Type it instead
                </button>
              </div>
            </div>

            <p className="text-micro leading-relaxed text-ink-4">
              Full points inside 15 minutes, then 70% within the hour, 40% by the next
              day and 15% within a week. A receipt older than seven days earns nothing.
            </p>
          </>
        )}

        {step === "confirm" && candidate && (
          <div data-testid="receipt-confirm" className="space-y-3">
            <div className="rounded-2xl border border-edge-1 bg-surface-1 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-ink-1">{candidate.merchant}</p>
                  <p className="mt-0.5 truncate text-micro text-ink-4">
                    {candidate.invoice ? `Invoice ${candidate.invoice}` : "Invoice not in the code"}
                    {candidate.pin ? ` · PIN ${candidate.pin}` : ""}
                  </p>
                </div>
                <span
                  className={
                    status === "verified"
                      ? "inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-1 text-micro font-bold text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300"
                      : "inline-flex shrink-0 items-center gap-1 rounded-full border border-accent-200 bg-accent-50 px-2 py-1 text-micro font-bold text-accent-800 dark:border-accent-500/30 dark:bg-accent-500/10 dark:text-accent-300"
                  }
                >
                  <ShieldCheck size={11} aria-hidden="true" />
                  {status === "verified" ? "QR read" : "Partial QR"}
                </span>
              </div>

              {candidate.total ? (
                <div className="mt-3 flex items-end justify-between gap-3 rounded-xl bg-surface-0 px-3 py-2">
                  <div>
                    <p className="text-micro uppercase tracking-[0.1em] text-ink-4">Total paid</p>
                    <p className="digital text-lg font-extrabold text-ink-1">{formatKes(candidate.total)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-micro uppercase tracking-[0.1em] text-ink-4">Worth</p>
                    <p className="digital text-lg font-extrabold text-brand-700 dark:text-brand-300" data-testid="receipt-points">
                      {points} pts
                    </p>
                  </div>
                </div>
              ) : (
                <Input
                  label="Total paid (KES)"
                  type="number"
                  min="1"
                  value={candidate.total ?? ""}
                  onChange={(event) => setCandidate((current) => ({ ...current, total: Number(event.target.value) }))}
                  data-testid="receipt-missing-total"
                  className="mt-3"
                />
              )}

              <p className="mt-2 text-micro leading-relaxed text-ink-3">
                {preview ? preview.freshness.label : "The receipt date is missing, so its freshness cannot be checked."}
                {status === "partial" && " A partial QR earns half points until the merchant PIN and invoice are both present."}
              </p>
            </div>

            {handledMissing(candidate) && (
              <p className="text-micro text-ink-4">
                You can add this to the ledger now; the missing field only affects points.
              </p>
            )}

            {error && (
              <p data-testid="receipt-error" className="rounded-xl border border-accent-200 bg-accent-50 px-3 py-2 text-2xs text-accent-800 dark:border-accent-500/30 dark:bg-accent-500/10 dark:text-accent-200">
                {error}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => { setStep("scan"); setCandidate(null); setError(null); }}>
                Scan again
              </Button>
              <Button icon={Check} onClick={save} data-testid="receipt-add">
                Add receipt
              </Button>
            </div>
          </div>
        )}

        {step === "manual" && (
          <form onSubmit={saveManual} className="space-y-3" data-testid="receipt-manual">
            <p className="rounded-xl border border-edge-1 bg-surface-1 px-3 py-2 text-micro leading-relaxed text-ink-3">
              A typed receipt is a record, not proof, so it earns no points. Use it when
              the QR is damaged and keep the paper until a merchant checks it.
            </p>
            <Input
              label="Merchant"
              value={manual.merchant}
              onChange={(event) => setManual((current) => ({ ...current, merchant: event.target.value }))}
              placeholder="e.g. Milimani Chemist"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Invoice number"
                value={manual.invoice}
                onChange={(event) => setManual((current) => ({ ...current, invoice: event.target.value }))}
                placeholder="From the receipt"
              />
              <Input
                label="Merchant PIN"
                value={manual.pin}
                onChange={(event) => setManual((current) => ({ ...current, pin: event.target.value }))}
                placeholder="P051…"
              />
            </div>
            <Input
              label="Total paid (KES)"
              type="number"
              min="1"
              value={manual.total}
              onChange={(event) => setManual((current) => ({ ...current, total: event.target.value }))}
            />
            {error && (
              <p data-testid="receipt-error" className="rounded-xl border border-accent-200 bg-accent-50 px-3 py-2 text-2xs text-accent-800 dark:border-accent-500/30 dark:bg-accent-500/10 dark:text-accent-200">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { setStep("scan"); setError(null); }}>
                Back to camera
              </Button>
              <Button type="submit" variant="secondary" data-testid="receipt-manual-add">
                Add without points
              </Button>
            </div>
          </form>
        )}

        {step === "done" && result && (
          <div className="space-y-3 text-center" data-testid="receipt-success">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <Check size={26} aria-hidden="true" />
            </span>
            <div>
              <p className="text-base font-extrabold text-ink-1">
                {result.points > 0 ? `+${result.points} points` : "Receipt recorded"}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                {result.receipt.merchant} · {formatKes(result.receipt.total)}
              </p>
              <p className="mt-1 text-micro text-ink-4">{result.receipt.freshness_label}</p>
              {result.receipt.status !== "manual" && (
                <p className="mx-auto mt-2 max-w-xs text-micro leading-relaxed text-ink-4">
                  If this shop is on Brief, it now has one tap to confirm the
                  trade. Both sides have to agree before it counts.
                </p>
              )}
            </div>
            <div className="flex justify-center gap-2">
              <Button
                variant="secondary"
                onClick={() => { setStep("scan"); setCandidate(null); setResult(null); setError(null); }}
              >
                Scan another
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

const handledMissing = (candidate) =>
  !candidate.invoice || !candidate.pin || !candidate.total;
