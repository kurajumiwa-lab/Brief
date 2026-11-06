import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2, UserMinus, X } from "lucide-react";
import { statusesAPI } from "@/lib/api";
import { agoText, errorText, leftText } from "@/components/statuses/statusCore";

const STEP_MS = 6000;

/**
 * STATUS VIEWER: full-screen look at one business's live statuses, one after
 * another. Opening a status records a view (someone else's status only).
 *
 * Owner: sees who viewed each status, and can delete it.
 * Viewer: can unfollow the business from here.
 */
export default function StatusViewer({ group, own = false, onClose, onUnfollow, onDeleted }) {
  const statuses = group?.statuses || [];
  const [index, setIndex] = useState(0);
  const [viewers, setViewers] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const recorded = useRef(new Set());
  const current = statuses[index];

  // Record the view once per status, and only for someone else's status.
  useEffect(() => {
    if (!current || own || recorded.current.has(current.id)) return;
    recorded.current.add(current.id);
    statusesAPI.view(current.id).catch(() => {});
  }, [current, own]);

  // Owners see who looked at the status on screen.
  useEffect(() => {
    if (!current || !own) return undefined;
    let live = true;
    setViewers(null);
    statusesAPI.viewers(current.id)
      .then(({ data }) => { if (live) setViewers(data.viewers || []); })
      .catch(() => { if (live) setViewers([]); });
    return () => { live = false; };
  }, [current, own]);

  // Move on by itself; closing after the last one.
  useEffect(() => {
    if (!current) return undefined;
    const timer = setTimeout(() => {
      if (index < statuses.length - 1) setIndex(index + 1);
      else onClose?.();
    }, STEP_MS);
    return () => clearTimeout(timer);
  }, [index, current, statuses.length, onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, statuses.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, statuses.length]);

  if (!current) return null;

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await statusesAPI.remove(current.id);
      onDeleted?.();
    } catch (err) {
      setError(errorText(err, "Could not delete that status."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`${group.vendor.business_name} statuses`}
      className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white">
      <div className="flex gap-1 p-3">
        {statuses.map((s, i) => (
          <span key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
            {i <= index && <span className="block h-full bg-white" />}
          </span>
        ))}
      </div>

      <header className="flex items-center justify-between gap-3 px-4 pb-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{group.vendor.business_name}</p>
          <p className="text-micro text-white/70">
            {agoText(current.created_at)} · {leftText(current.expires_at)}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close statuses"
          className="rounded-full p-2 hover:bg-white/10">
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        {current.kind === "text" ? (
          <p className="max-w-md whitespace-pre-line text-center text-lg font-semibold">{current.body}</p>
        ) : current.kind === "photo" ? (
          <div className="flex max-h-full flex-col items-center gap-3">
            <img src={current.media_url} alt={current.body || `${group.vendor.business_name} photo`}
              className="max-h-[60vh] max-w-full rounded-xl object-contain" />
            {current.body && <p className="max-w-md text-center text-sm">{current.body}</p>}
          </div>
        ) : (
          <video src={current.media_url} controls playsInline className="max-h-[60vh] max-w-full rounded-xl" />
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button type="button" onClick={() => setIndex((i) => Math.max(i - 1, 0))} disabled={index === 0}
          aria-label="Previous status" className="rounded-full p-2 hover:bg-white/10 disabled:opacity-30">
          <ChevronLeft size={20} aria-hidden="true" />
        </button>

        {own ? (
          <div className="min-w-0 flex-1 text-center">
            <p className="text-micro text-white/80" aria-live="polite">
              {viewers === null
                ? "Checking who viewed…"
                : viewers.length === 0
                  ? "No views yet"
                  : `Viewed by ${viewers.length}: ${viewers.map((v) => v.business_name).join(", ")}`}
            </p>
            <button type="button" onClick={remove} disabled={busy}
              className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-micro font-bold hover:bg-white/20 disabled:opacity-50">
              <Trash2 size={12} aria-hidden="true" /> Delete this status
            </button>
            {error && <p role="alert" className="mt-1 text-micro text-red-300">{error}</p>}
          </div>
        ) : (
          <div className="flex-1 text-center">
            <button type="button" onClick={onUnfollow}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-micro font-bold hover:bg-white/20">
              <UserMinus size={12} aria-hidden="true" /> Unfollow {group.vendor.business_name}
            </button>
          </div>
        )}

        <button type="button" onClick={() => {
          if (index < statuses.length - 1) setIndex(index + 1);
          else onClose?.();
        }} aria-label="Next status" className="rounded-full p-2 hover:bg-white/10">
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
