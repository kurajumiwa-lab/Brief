import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Camera, Check, Contact, Layers, ScanLine, Sparkles, Store, X,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import EmptyState from "@/components/ui/EmptyState";
import PhotoUploader from "@/components/media/PhotoUploader";
import { toast } from "@/components/ui/Toast";
import { intakeAPI, marketDataAPI, apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * MARKET INTAKE — photographs of a shop front become a price.
 * ---------------------------------------------------------------------------
 * The wholesalers this network wants are already advertising on TikTok: a
 * phone camera pointed at a stack of rice bags, a price written over the top,
 * a number in the bio. None of them are going to sign up today. All of them are
 * telling us something worth keeping.
 *
 * So the screen is a desk, not a dashboard. Three things happen on it, in order:
 *
 *   1  **Drop up to twelve photographs.** That is one gallery selection on a
 *      phone, which is how the person holding the phone actually works.
 *   2  **Read what came back.** Every row is a *suggestion*: the product, the
 *      price, the size, a category guess and a confidence. Rows are kept or
 *      thrown away one press each — nothing enters the dataset without that.
 *   3  **Name the seller without giving them an account.** A virtual ID
 *      (`~khetia`) is minted free, holds their confirmed prices, and is
 *      claimed later by whoever can prove the phone number.
 *
 * The screen never says "we know this seller". It says what a photograph said,
 * which is the only thing it can honestly say.
 */
const CONFIDENCE_TONE = (score) => (score >= 0.8 ? "brand" : score >= 0.6 ? "amber" : "gray");

export default function MarketIntakePage() {
  const [photos, setPhotos] = useState([]);
  const [market, setMarket] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);

  const loadSide = useCallback(async () => {
    const [batches, market] = await Promise.allSettled([
      intakeAPI.batches(6),
      marketDataAPI.summary(),
    ]);
    if (batches.status === "fulfilled") setHistory(batches.value.data?.batches || []);
    if (market.status === "fulfilled") setSummary(market.value.data || null);
  }, []);

  useEffect(() => {
    loadSide().catch(() => {});
  }, [loadSide]);

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const { data } = photos.length
        ? await intakeAPI.upload(photos, { market, note: "" })
        : await intakeAPI.fromText({ text, market: market || null });
      setResult(data);
      setRows((data.observations || []).map((o) => ({ ...o, decided: null })));
      setPhotos([]);
      setText("");
      await loadSide();
      if (!data.observations?.length) {
        toast.error("Nothing with a price was read. Try a closer photo or paste the text.");
      } else {
        toast.success(`${data.observations.length} price${data.observations.length === 1 ? "" : "s"} read — review them below`);
      }
    } catch (err) {
      const message = apiError(err, "The photographs could not be read");
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (observation, status) => {
    try {
      await intakeAPI.decide(observation.id, status);
      setRows((current) =>
        current.map((row) => (row.id === observation.id ? { ...row, decided: status } : row))
      );
      await loadSide();
    } catch (err) {
      toast.error(apiError(err, "That row could not be saved"));
    }
  };

  const pending = useMemo(() => rows.filter((r) => !r.decided).length, [rows]);
  const canRead = photos.length > 0 || text.trim().length > 0;

  return (
    <div className="space-y-5 pb-24" data-testid="market-intake">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/me"
            className="inline-flex items-center gap-1 text-micro font-semibold text-ink-3 hover:text-ink-1"
          >
            <ArrowLeft size={12} aria-hidden="true" /> Profile
          </Link>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-1">
            Market intake
          </h1>
          <p className="text-xs text-ink-3">
            Photograph a shop front. Keep the prices. Give the seller a name that costs them nothing.
          </p>
        </div>
        <Badge variant="outline" size="sm">
          <ScanLine size={12} aria-hidden="true" /> Operations
        </Badge>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="intake-summary">
          <Metric label="Confirmed prices" value={summary.observations} />
          <Metric label="Sellers seen" value={summary.sellers} />
          <Metric label="Waiting review" value={summary.pending_review} tone={summary.pending_review ? "amber" : undefined} />
          <Metric label="Categories" value={summary.categories?.length ?? 0} />
        </div>
      )}

      <Card className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            <Camera size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink-1">One batch, up to 12 photographs</p>
            <p className="text-2xs text-ink-3">
              Screenshots of a wholesaler&apos;s feed work as well as photos of the shop. Prices are
              the only thing kept; slogans, view counts and hashtags are dropped.
            </p>
          </div>
        </div>

        <PhotoUploader
          value={photos}
          onChange={setPhotos}
          max={12}
          label=""
          hint=""
          testId="intake-photos"
          compact
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Market"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            placeholder="Kikomba, Kisumu, Nairobi CBD…"
            hint="Where the sign is. Optional but it makes the row useful."
          />
          <div className="flex items-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPasteOpen((v) => !v)}
              icon={Layers}
              type="button"
            >
              {pasteOpen ? "Hide text entry" : "Paste text instead"}
            </Button>
          </div>
        </div>

        {pasteOpen && (
          <Textarea
            label="What the sign says"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Maya diapers bale@ksh 2100/-\nSalt cooking oil 20 litres@ksh4000/-\n0104211141"}
            hint="One line per thing on the board. This path always works, even on a server with no reader installed."
          />
        )}

        {error && (
          <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-micro text-ink-4">
            {photos.length > 0
              ? `${photos.length} photograph${photos.length === 1 ? "" : "s"} ready`
              : text.trim()
              ? "Reading pasted text"
              : "Add photographs or paste the text"}
          </p>
          <Button onClick={submit} loading={busy} disabled={!canRead} icon={Sparkles}>
            Read the market
          </Button>
        </div>
      </Card>

      {result && (
        <Card className="p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge-1 bg-surface-1 px-5 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink-1">
                {rows.length} price{rows.length === 1 ? "" : "s"} read
                {result.seller_hint ? ` from ${result.seller_hint}` : ""}
              </p>
              <p className="text-micro text-ink-3">
                {result.ocr_engine
                  ? `Read by ${result.ocr_engine} from ${result.image_count || 0} image${result.image_count === 1 ? "" : "s"} · ${result.lines_read} lines`
                  : "Read from pasted text"}
                {result.skipped?.length ? ` · ${result.skipped.length} lines had no price and were left out` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {result.presence && (
                <Badge variant="purple" size="sm" testid="virtual-seller">
                  <Store size={11} aria-hidden="true" /> {result.presence.virtual_id}
                </Badge>
              )}
              {pending > 0 && (
                <Badge variant="amber" size="sm">
                  {pending} to review
                </Badge>
              )}
            </div>
          </div>

          {result.note && (
            <p className="border-b border-edge-1 bg-accent-50 px-5 py-2 text-micro text-accent-800 dark:bg-accent-950/40 dark:text-accent-200">
              {result.note}
            </p>
          )}

          {rows.length === 0 ? (
            <EmptyState
              title="Nothing with a price"
              description="The reader found text but no shilling amount. A closer photo of the board, or pasting the line, will read better."
            />
          ) : (
            <ul className="divide-y divide-edge-1">
              {rows.map((row) => (
                <ObservationRow key={row.id} row={row} onDecide={decide} />
              ))}
            </ul>
          )}
        </Card>
      )}

      {!result && history.length === 0 && (
        <EmptyState
          icon={ScanLine}
          title="No batches yet"
          description="The first batch starts the dataset. Twelve photographs of one wholesaler's feed is usually ten to twenty prices."
        />
      )}

      {history.length > 0 && (
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-bold text-ink-1">Recent batches</h2>
          <ul className="divide-y divide-edge-1">
            {history.map((batch) => (
              <li key={batch.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-ink-1">
                    {batch.seller_hint || "Unnamed seller"}
                    {batch.image_count ? ` · ${batch.image_count} photos` : " · text"}
                  </p>
                  <p className="text-micro text-ink-4">
                    {batch.created_at ? new Date(batch.created_at).toLocaleString() : ""}
                    {batch.ocr_engine ? ` · ${batch.ocr_engine}` : ""}
                  </p>
                </div>
                <Badge variant={batch.pending ? "amber" : "gray"} size="xs">
                  {batch.pending ? `${batch.pending} to review` : "reviewed"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="flex items-start gap-2 px-1 text-micro leading-relaxed text-ink-4">
        <Contact size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        Only public advertising — a post, a shop sign, a price board. A confirmed row can name a
        seller that has no account here; it can never sign in, and it is claimed only by whoever
        can prove the phone number.
      </p>
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="rounded-2xl border border-edge-1 bg-surface-1 px-3.5 py-3">
      <p className={cn("text-xl font-extrabold tabular-nums text-ink-1", tone === "amber" && "text-accent-700 dark:text-accent-300")}>
        {value ?? "—"}
      </p>
      <p className="text-micro text-ink-3">{label}</p>
    </div>
  );
}

function ObservationRow({ row, onDecide }) {
  const decided = row.decided;
  return (
    <li
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 px-5 py-3",
        decided === "confirmed" && "bg-brand-50/40 dark:bg-brand-500/5",
        decided === "rejected" && "opacity-50"
      )}
      data-testid="intake-row"
    >
      <div className="min-w-[12rem] flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-bold text-ink-1">{row.product}</span>
          {row.category && (
            <Badge variant="gray" size="xs">
              {row.category}
            </Badge>
          )}
          <Badge variant={CONFIDENCE_TONE(row.confidence)} size="xs">
            {Math.round((row.confidence || 0) * 100)}%
          </Badge>
        </div>
        <p className="mt-0.5 text-micro text-ink-3">
          KSh {Number(row.price_kes || 0).toLocaleString()}
          {row.quantity && row.unit ? ` · ${row.quantity} ${row.unit}` : ""}
          {row.market ? ` · ${row.market}` : ""}
          {row.wholesale ? " · wholesale" : ""}
        </p>
        {row.raw_line && (
          <p className="mt-0.5 truncate font-mono text-[10px] text-ink-4">{row.raw_line}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {decided ? (
          <Badge variant={decided === "confirmed" ? "brand" : "gray"} size="xs">
            {decided === "confirmed" ? "Kept" : "Thrown away"}
          </Badge>
        ) : (
          <>
            <Button size="xs" variant="secondary" icon={X} onClick={() => onDecide(row, "rejected")}>
              Throw away
            </Button>
            <Button size="xs" icon={Check} onClick={() => onDecide(row, "confirmed")}>
              Keep
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
