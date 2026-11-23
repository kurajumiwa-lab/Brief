import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck, Camera, Check, Circle, Copy, Loader2, RefreshCw, ShieldAlert,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { socialTrustAPI, fileAPI, apiError } from "@/lib/api";
import { mediaUrl } from "@/lib/media";
import { formatKes } from "@/lib/receipts";
import { cn } from "@/lib/utils";

/**
 * OWNER CONTROLS for the social-seller trust card.
 *
 * Three mutually independent signals. The editor never implies that one raises
 * the other: a bio match does not verify the shop, a photo does not verify the
 * stock, and a resolved report does not erase the report.
 */

const PLATFORMS = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook Marketplace" },
];

const blankLinks = () => PLATFORMS.map((platform) => ({
  platform: platform.value,
  handle: "",
  profile_url: "",
  bio_verified: false,
  checked_at: null,
}));

export default function SocialTrustEditor() {
  const [state, setState] = useState(null);
  const [links, setLinks] = useState(blankLinks);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(null);
  const [item, setItem] = useState("");
  const [price, setPrice] = useState("");
  const [photo, setPhoto] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [resolveNotes, setResolveNotes] = useState({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await socialTrustAPI.me();
      setState(data);
      setLinks(PLATFORMS.map((platform) => {
        const saved = (data.social_links || []).find((entry) => entry.platform === platform.value);
        return saved ? { ...saved } : blankLinks().find((entry) => entry.platform === platform.value);
      }));
      setError("");
    } catch (err) {
      setError(apiError(err, "Your trust card could not be loaded."));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function updateLink(platform, key, value) {
    setLinks((rows) => rows.map((row) => row.platform === platform ? { ...row, [key]: value } : row));
  }

  async function saveLinks() {
    setSaving(true);
    try {
      const filled = links.filter((row) => row.handle.trim() && row.profile_url.trim());
      await socialTrustAPI.saveLinks(filled.map((row) => ({
        platform: row.platform,
        handle: row.handle.trim().replace(/^@/, ""),
        profile_url: row.profile_url.trim(),
      })));
      toast.success("Social links saved. Run the check to see what the public bio shows.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "Those links could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function checkBio(platform) {
    setChecking(platform);
    try {
      const { data } = await socialTrustAPI.verifyBio(platform);
      toast(data.matched ? "Link matched in the public bio." : "No match yet — see why below.");
      await load();
    } catch (err) {
      toast.error(apiError(err, "That bio could not be checked."));
    } finally {
      setChecking(null);
    }
  }

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    try {
      const { data } = await fileAPI.upload(file);
      setPhoto(data.url);
      toast.success("Photo attached. Add the item and publish.");
    } catch (err) {
      toast.error(apiError(err, "That photo could not be uploaded."));
    } finally {
      setUploading(false);
    }
  }

  async function publishProof() {
    if (!state?.challenge?.challenge_code) return;
    setPublishing(true);
    try {
      await socialTrustAPI.publishStockProof({
        challenge_code: state.challenge.challenge_code,
        item_title: item.trim(),
        price_kes: price === "" ? null : Number(price),
        image_url: photo,
      });
      toast.success("Stock-in-hand photo published for 48 hours.");
      setItem("");
      setPrice("");
      setPhoto(null);
      await load();
    } catch (err) {
      toast.error(apiError(err, "That photo could not be published."));
    } finally {
      setPublishing(false);
    }
  }

  async function resolve(reportId) {
    const note = (resolveNotes[reportId] || "").trim();
    if (note.length < 10) return toast.error("Say how it was resolved, in at least 10 characters.");
    try {
      await socialTrustAPI.resolveDelivery(reportId, note);
      toast.success("Marked resolved.");
      setResolveNotes((notes) => ({ ...notes, [reportId]: "" }));
      await load();
    } catch (err) {
      toast.error(apiError(err, "That report could not be resolved."));
    }
  }

  if (error) return <p className="text-xs text-ink-3">{error}</p>;
  if (!state) return <p className="flex items-center gap-2 text-xs text-ink-3"><Loader2 size={13} className="animate-spin" /> Loading trust signals…</p>;

  const challenge = state.challenge || {};
  const proof = state.stock_proof;
  const delivery = state.delivery || { reports: [] };

  return (
    <section className="space-y-4" aria-labelledby="trust-editor-heading" data-testid="social-trust-editor">
      <div>
        <h2 id="trust-editor-heading" className="text-base font-extrabold tracking-tight text-ink-1">Social seller trust</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-3">
          For TikTok, Instagram and Facebook sellers. Put your page link in your
          bio, publish a weekly stock photo, and answer delivery reports from
          buyers who actually traded with you.
        </p>
      </div>

      {/* ── bio links ───────────────────────────────────────────────────── */}
      <div className="space-y-2 rounded-2xl border border-edge-1 bg-surface-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-extrabold text-ink-1">Bio links</h3>
          <Button size="xs" variant="secondary" loading={saving} onClick={saveLinks}>Save links</Button>
        </div>
        {links.map((row) => {
          const platform = PLATFORMS.find((entry) => entry.value === row.platform);
          return (
            <div key={row.platform} className="rounded-xl border border-edge-1 bg-surface-0 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-2xs font-bold text-ink-1">
                  {row.bio_verified ? <BadgeCheck size={12} className="text-brand-700 dark:text-brand-300" /> : <Circle size={12} className="text-ink-4" />}
                  {platform.label}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  icon={checking === row.platform ? Loader2 : RefreshCw}
                  loading={checking === row.platform}
                  disabled={!row.profile_url.trim()}
                  onClick={() => checkBio(row.platform)}
                >
                  Check bio
                </Button>
              </div>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                <input
                  className="rounded-lg border border-edge-2 bg-surface-1 px-2 py-1.5 text-xs"
                  placeholder="@handle"
                  value={row.handle}
                  onChange={(event) => updateLink(row.platform, "handle", event.target.value)}
                  aria-label={`${platform.label} handle`}
                />
                <input
                  className="rounded-lg border border-edge-2 bg-surface-1 px-2 py-1.5 text-xs"
                  placeholder={`https://${row.platform}.com/@handle`}
                  value={row.profile_url}
                  onChange={(event) => updateLink(row.platform, "profile_url", event.target.value)}
                  aria-label={`${platform.label} profile URL`}
                />
              </div>
              <p className={cn(
                "mt-1 text-2xs leading-relaxed",
                row.bio_verified ? "text-brand-700 dark:text-brand-300" : "text-ink-4",
              )}>
                {row.bio_verified
                  ? `Matched ${row.bio_match_on || row.checked_at || "when last checked"}.`
                  : row.checked_at
                    ? `Not matched when checked ${row.checked_at}.`
                    : "Not checked yet."} A bio match is a signal and awards no standing credit.
              </p>
            </div>
          );
        })}
      </div>

      {/* ── daily code + stock photo ────────────────────────────────────── */}
      <div className="space-y-2 rounded-2xl border border-edge-1 bg-surface-1 p-3">
        <h3 className="text-xs font-extrabold text-ink-1">Today&apos;s stock-in-hand code</h3>
        <div className="flex items-center gap-2">
          <code className="rounded-lg bg-brand-50 px-2.5 py-1.5 text-sm font-extrabold tracking-wider text-brand-800 dark:bg-brand-500/15 dark:text-brand-200" data-testid="stock-challenge-code">
            {challenge.challenge_code}
          </code>
          <Button
            size="xs"
            variant="ghost"
            icon={Copy}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(challenge.challenge_code);
                toast.success("Code copied");
              } catch {
                toast.error("Copy is blocked in this browser.");
              }
            }}
          >
            Copy code
          </Button>
        </div>
        <p className="text-2xs leading-relaxed text-ink-4">{challenge.instructions}</p>

        {proof && (
          <div className="flex gap-2 rounded-xl border border-edge-1 bg-surface-0 p-2">
            <img src={mediaUrl(proof.image_url)} alt="" className="h-16 w-16 rounded-lg object-cover" />
            <div className="min-w-0">
              <p className="truncate text-2xs font-bold text-ink-1">{proof.item_title}</p>
              <p className="text-2xs text-ink-3">{proof.label}</p>
              {proof.price_kes != null && <p className="text-2xs text-ink-2">{formatKes(proof.price_kes)}</p>}
            </div>
          </div>
        )}

        <div className="grid gap-1.5 sm:grid-cols-2">
          <input
            className="rounded-lg border border-edge-2 bg-surface-0 px-2 py-1.5 text-xs"
            placeholder="What is in the photo (e.g. Nike Air Max 90)"
            value={item}
            onChange={(event) => setItem(event.target.value)}
            aria-label="Item title"
          />
          <input
            type="number"
            min="0"
            className="rounded-lg border border-edge-2 bg-surface-0 px-2 py-1.5 text-xs"
            placeholder="Price in KSh (optional)"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            aria-label="Price in KSh"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-edge-2 px-2.5 py-2 text-2xs font-semibold text-ink-2">
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
          {photo ? "Photo attached" : "Snap the product beside the handwritten code"}
          <input type="file" accept="image/*" className="sr-only" onChange={(event) => upload(event.target.files?.[0])} />
        </label>
        <Button
          size="sm"
          fullWidth
          loading={publishing}
          disabled={!photo || item.trim().length < 3 || uploading}
          onClick={publishProof}
        >
          Publish for 48 hours
        </Button>
        <p className="text-2xs leading-relaxed text-ink-4">
          A photo proves a photograph was taken beside today&apos;s code. It does
          not prove ownership or quantity, and awards no standing credit.
        </p>
      </div>

      {/* ── delivery reports ────────────────────────────────────────────── */}
      <div className="space-y-2 rounded-2xl border border-edge-1 bg-surface-1 p-3">
        <div className="flex items-center gap-1.5">
          <ShieldAlert size={13} className={delivery.qualified_count >= 2 ? "text-amber-600" : "text-ink-4"} aria-hidden="true" />
          <h3 className="text-xs font-extrabold text-ink-1">Delivery reports</h3>
        </div>
        <p className="text-2xs leading-relaxed text-ink-3">
          {delivery.qualified_count >= 2
            ? delivery.warning_text
            : `${delivery.qualified_count || 0} open report${delivery.qualified_count === 1 ? "" : "s"} from Level 2+ buyers. Two unrelated buyers raise the warning on your page.`}
        </p>
        <p className="text-2xs leading-relaxed text-ink-4">
          {delivery.signal_note || "A report is an allegation from a buyer who traded with you, not a finding. Two unrelated Level 2+ buyers raise the warning; none of it changes your standing."}
        </p>
        {delivery.reports.length === 0 ? (
          <p className="rounded-lg border border-dashed border-edge-2 px-2.5 py-2 text-2xs text-ink-4">
            No open reports. Buyers can only report a trade they actually made with you.
          </p>
        ) : (
          <ul className="space-y-2">
            {delivery.reports.map((report) => (
              <li key={report.id} className="rounded-lg border border-amber-200 bg-amber-50 p-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="text-2xs leading-relaxed text-amber-950 dark:text-amber-100">{report.note}</p>
                <div className="mt-1.5 flex gap-1.5">
                  <input
                    className="min-w-0 flex-1 rounded-lg border border-amber-300 bg-surface-0 px-2 py-1 text-2xs text-ink-1"
                    placeholder="How was it resolved?"
                    value={resolveNotes[report.id] || ""}
                    onChange={(event) => setResolveNotes((notes) => ({ ...notes, [report.id]: event.target.value }))}
                  />
                  <Button size="xs" variant="secondary" icon={Check} onClick={() => resolve(report.id)}>Resolve</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-2xs leading-relaxed text-ink-4">{state.signals_note}</p>
    </section>
  );
}
