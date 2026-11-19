import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Camera, CheckCircle2, Clock3, FileText, Receipt, ScanLine, Sparkles,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";
import { townAPI } from "@/lib/townApi";
import { formatKes } from "@/lib/receipts";
import { cn } from "@/lib/utils";

const FLAG_COPY = {
  priority_15_min: "Inside the 15-minute priority window",
  expired: "Older than 7 days — no reward",
  self_receipt: "Your own shop — no reward",
  item_total_mismatch: "Items do not add up to the total",
  possible_duplicate: "Looks like another receipt today",
  no_merchant_pin: "No merchant PIN read",
  low_ocr_confidence: "Low OCR confidence — check the lines",
  undated: "No date read",
  manual_record: "Typed record — points are not funded",
  ocr_text: "Read from pasted text, not a photograph",
};

function localInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function minutesOld(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
}

export default function ReceiptRewardsPage() {
  const fileRef = useRef(null);
  const [mode, setMode] = useState("photo");
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [draftSource, setDraftSource] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    merchant_name: "", merchant_pin: "", invoice_no: "", total_kes: "", issued_at: "",
  });

  const age = useMemo(() => minutesOld(form.issued_at), [form.issued_at]);
  const priority = age !== null && age <= 15;

  function applyDraft(next, url, source) {
    setDraft(next);
    setPhotoUrl(url || null);
    setDraftSource(source);
    setWarnings(next?.warnings || []);
    setForm({
      merchant_name: next?.merchant_name || "",
      merchant_pin: next?.merchant_pin || "",
      invoice_no: next?.invoice_no || "",
      total_kes: next?.total_kes ? String(next.total_kes) : "",
      issued_at: localInput(next?.issued_at),
    });
  }

  async function readPhoto(file) {
    if (!file) return;
    setBusy("photo");
    setError("");
    setResult(null);
    try {
      const { data } = await townAPI.scanPhoto(file, consent);
      if (!data.available || !data.draft) {
        toast.error(data.warnings?.[0] || "No OCR engine on this host — paste the receipt text instead.");
        setMode("text");
        return;
      }
      applyDraft(data.draft, data.photo_url, "photo");
      toast.success("Receipt read. Check the lines before submitting.");
    } catch (err) {
      setError(apiError(err, "The photograph could not be read"));
    } finally {
      setBusy("");
    }
  }

  async function readText() {
    if (text.trim().length < 3) return;
    setBusy("text");
    setError("");
    setResult(null);
    try {
      const { data } = await townAPI.scanText(text, consent);
      applyDraft(data.draft, null, "text");
      toast.success("Text read. Check the lines before submitting.");
    } catch (err) {
      setError(apiError(err, "That text could not be read"));
    } finally {
      setBusy("");
    }
  }

  async function submit() {
    setBusy("submit");
    setError("");
    try {
      const total = Number(form.total_kes);
      if (!Number.isFinite(total) || total <= 0) throw new Error("Enter the amount actually paid.");
      const body = {
        source: draft ? draftSource || "photo" : "manual",
        merchant_name: form.merchant_name || null,
        merchant_pin: form.merchant_pin || null,
        invoice_no: form.invoice_no || null,
        total_kes: Math.round(total),
        issued_at: form.issued_at ? new Date(form.issued_at).toISOString() : null,
        photo_url: photoUrl,
        photo_consent: consent,
        ocr_engine: draft?.engine || "text",
        items: (draft?.items || []).map((item) => ({
          description: item.description,
          quantity: item.quantity || 1,
          unit_price_kes: item.unit_price_kes || 0,
          total_price_kes: item.total_price_kes || 0,
          confidence: item.confidence || 0,
        })),
        extraction: {
          warnings: draft?.warnings || [],
          confidence: draft?.confidence || 0,
          line_count: draft?.line_count || 0,
        },
      };
      const { data } = await townAPI.captureReceipt(body);
      setResult(data);
      toast.success(
        data.points_awarded > 0
          ? `${data.points_awarded} points funded by the shop`
          : "Receipt recorded — the shop has not funded a reward yet",
      );
    } catch (err) {
      setError(err?.response ? apiError(err, "The receipt could not be submitted") : err.message);
    } finally {
      setBusy("");
    }
  }

  if (busy === "photo" && !draft) return <PageSpinner label="Reading the receipt…" />;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <header>
        <p className="eyebrow">Receipt rewards</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">
          Scan it while it is fresh
        </h1>
        <p className="mt-1.5 max-w-md text-xs leading-relaxed text-ink-3">
          A receipt scanned within 15 minutes gets the full merchant-funded reward. After that
          the ladder falls: one hour, one day, one week. The shop funds the points from prepaid
          credit — the platform never mints them.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {[
          ["15 min", "Full reward", priority],
          ["60 min", "70%", age !== null && age > 15 && age <= 60],
          ["24 hours", "40%", age !== null && age > 60 && age <= 1440],
        ].map(([label, value, active]) => (
          <div
            key={label}
            className={cn(
              "rounded-2xl border px-3 py-2.5",
              active
                ? "border-brand-300 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10"
                : "border-edge-1 bg-surface-1",
            )}
          >
            <p className="text-micro font-bold uppercase tracking-wide text-ink-4">{label}</p>
            <p className={cn("mt-0.5 text-sm font-extrabold", active ? "text-brand-700 dark:text-brand-300" : "text-ink-1")}>
              {value}
            </p>
          </div>
        ))}
      </div>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={mode === "photo" ? "primary" : "secondary"}
            icon={Camera}
            onClick={() => setMode("photo")}
          >
            Photo
          </Button>
          <Button
            size="sm"
            variant={mode === "text" ? "primary" : "secondary"}
            icon={FileText}
            onClick={() => setMode("text")}
          >
            Paste text
          </Button>
          <span className="ml-auto inline-flex items-center gap-1 text-micro text-ink-4">
            <Clock3 size={12} aria-hidden="true" /> Server decides freshness
          </span>
        </div>

        {mode === "photo" ? (
          <div className="mt-4 space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => readPhoto(event.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-4 py-8 text-center transition-colors hover:border-brand-300"
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                <ScanLine size={20} aria-hidden="true" />
              </span>
              <span className="text-sm font-bold text-ink-1">Take or choose a receipt photo</span>
              <span className="text-2xs text-ink-3">OCR reads the merchant, date, items and totals.</span>
            </button>
            <label className="flex items-start gap-2 text-2xs leading-relaxed text-ink-3">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-edge-2"
              />
              <span>
                Keep the photograph so a dispute can be reviewed. Without consent the image is
                read and discarded; the OCR text is still used for the reward.
              </span>
            </label>
            {busy === "photo" && <p className="text-2xs text-ink-3">Reading…</p>}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <Textarea
              rows={7}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"KISUMU CHEMIST\nP051234567X\nINV-778812\nParacetamol 2 x 250.00 500.00\nTOTAL 500.00"}
            />
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-2xs text-ink-3">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="h-4 w-4 rounded border-edge-2"
                />
                Consent to keep the photo, if one was attached
              </label>
              <Button size="sm" loading={busy === "text"} onClick={readText} disabled={text.trim().length < 3}>
                Read receipt
              </Button>
            </div>
          </div>
        )}
      </Card>

      {error && (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-1.5">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-2xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              {warning}
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <Card className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-extrabold text-ink-1">Check the draft</p>
              <p className="text-2xs text-ink-3">OCR is a reading, not a verification. Correct anything the paper disagrees with.</p>
            </div>
            <Badge variant={priority ? "brand" : "gray"} dot>
              {priority ? <Sparkles size={11} aria-hidden="true" /> : <Clock3 size={11} aria-hidden="true" />}
              {priority ? "Priority 15 min" : age !== null ? `${age} min old` : "No date"}
            </Badge>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-2xs font-semibold text-ink-3">
              Merchant
              <Input value={form.merchant_name} onChange={(e) => setForm({ ...form, merchant_name: e.target.value })} className="mt-1" />
            </label>
            <label className="text-2xs font-semibold text-ink-3">
              KRA PIN
              <Input value={form.merchant_pin} onChange={(e) => setForm({ ...form, merchant_pin: e.target.value.toUpperCase() })} className="mt-1" placeholder="P051234567X" />
            </label>
            <label className="text-2xs font-semibold text-ink-3">
              Invoice / receipt no.
              <Input value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} className="mt-1" />
            </label>
            <label className="text-2xs font-semibold text-ink-3">
              Total paid (KES)
              <Input type="number" inputMode="numeric" value={form.total_kes} onChange={(e) => setForm({ ...form, total_kes: e.target.value })} className="mt-1" />
            </label>
            <label className="text-2xs font-semibold text-ink-3 sm:col-span-2">
              Receipt date & time
              <Input type="datetime-local" value={form.issued_at} onChange={(e) => setForm({ ...form, issued_at: e.target.value })} className="mt-1" />
            </label>
          </div>

          <div className="rounded-2xl border border-edge-1 bg-surface-0">
            <div className="flex items-center justify-between border-b border-edge-1 px-3 py-2">
              <p className="text-2xs font-bold uppercase tracking-wide text-ink-4">Items read</p>
              <p className="text-2xs text-ink-3">{formatKes(draft.items_total_kes || 0)}</p>
            </div>
            {draft.items?.length ? (
              <ul className="divide-y divide-edge-1">
                {draft.items.map((item, index) => (
                  <li key={`${item.description}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-2xs">
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      {item.description} <span className="text-ink-4">× {item.quantity}</span>
                    </span>
                    <span className="digital shrink-0 text-ink-1">{formatKes(item.total_price_kes)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-3 text-2xs text-ink-3">No item lines were read. The total alone is still evidence.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" size="sm" as={Link} to="/receipts" icon={Receipt}>
              My receipt ledger
            </Button>
            <Button loading={busy === "submit"} onClick={submit} icon={CheckCircle2}>
              Submit receipt
            </Button>
          </div>
        </Card>
      )}

      {result && (
        <Card className="space-y-3 border-brand-200 p-4 dark:border-brand-500/30 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <CheckCircle2 size={20} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-extrabold text-ink-1">
                {result.points_awarded > 0 ? `${result.points_awarded} points funded` : "Recorded, not funded"}
              </p>
              <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">{result.note}</p>
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-edge-1 bg-surface-0 px-3 py-2">
              <dt className="text-[10px] font-bold uppercase tracking-wide text-ink-4">Calculated</dt>
              <dd className="digital text-sm font-extrabold text-ink-1">{result.calculated_points}</dd>
            </div>
            <div className="rounded-xl border border-edge-1 bg-surface-0 px-3 py-2">
              <dt className="text-[10px] font-bold uppercase tracking-wide text-ink-4">Funded</dt>
              <dd className="digital text-sm font-extrabold text-brand-700 dark:text-brand-300">{result.funded_points}</dd>
            </div>
            <div className="rounded-xl border border-edge-1 bg-surface-0 px-3 py-2">
              <dt className="text-[10px] font-bold uppercase tracking-wide text-ink-4">Window</dt>
              <dd className="text-sm font-extrabold text-ink-1">{result.priority ? "15 min" : result.freshness}</dd>
            </div>
          </dl>
          {result.fraud_flags?.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {result.fraud_flags.map((flag) => (
                <li key={flag} className="rounded-full border border-edge-2 bg-surface-0 px-2 py-1 text-[10px] font-semibold text-ink-3">
                  {FLAG_COPY[flag] || flag.replaceAll("_", " ")}
                </li>
              ))}
            </ul>
          )}
          <Button variant="secondary" size="sm" onClick={() => { setResult(null); setDraft(null); setText(""); }}>
            Scan another
          </Button>
        </Card>
      )}
    </div>
  );
}
