import { useState } from "react";
import { Camera, Type, Video, X } from "lucide-react";
import { fileAPI, statusesAPI } from "@/lib/api";
import { errorText, VIDEO_ENABLED } from "@/components/statuses/statusCore";

const TEXT_MAX = 500;

/**
 * STATUS COMPOSER: post a text or photo status as your business. It is seen
 * only by businesses that follow you, and it disappears after 24 hours.
 *
 * Video appears only when the video flag is on. Until then it is not shown.
 */
export default function StatusComposer({ onClose, onPosted }) {
  const [kind, setKind] = useState("text");
  const [body, setBody] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const kinds = [
    { id: "text", label: "Text", icon: Type },
    { id: "photo", label: "Photo", icon: Camera },
    ...(VIDEO_ENABLED ? [{ id: "video", label: "Video", icon: Video }] : []),
  ];

  const pickFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await fileAPI.upload(file);
      const url = data?.url || data?.path || data?.file_url;
      if (!url) throw new Error("no url");
      setMediaUrl(url);
      setFileName(file.name);
    } catch (err) {
      setMediaUrl("");
      setFileName("");
      setError(errorText(err, "That picture could not be uploaded. Try a smaller image."));
    } finally {
      setBusy(false);
    }
  };

  const post = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await statusesAPI.post({
        kind,
        body: body.trim() || null,
        media_url: kind === "text" ? null : mediaUrl || null,
      });
      onPosted?.();
    } catch (err) {
      setError(errorText(err, "Could not post your status. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const needsMedia = kind !== "text";
  const canPost = !busy && (kind === "text" ? body.trim().length > 0 : Boolean(mediaUrl));

  return (
    <div role="dialog" aria-modal="true" aria-label="Post a status"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center">
      <form onSubmit={post} className="w-full max-w-md space-y-4 rounded-2xl bg-surface-0 p-4 shadow-xl">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-1">Post a status</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 hover:bg-surface-1">
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div role="radiogroup" aria-label="Status type" className="flex gap-2">
          {kinds.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="radio" aria-checked={kind === id}
              onClick={() => { setKind(id); setError(""); }}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-micro font-bold ${
                kind === id ? "border-brand-500 bg-brand-50 text-brand-700 dark:text-brand-400" : "border-edge-1 text-ink-2"
              }`}>
              <Icon size={12} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>

        {needsMedia && (
          <label className="block rounded-xl border border-dashed border-edge-2 p-3 text-center text-xs text-ink-2">
            {fileName ? `Chosen: ${fileName}` : `Choose a ${kind === "video" ? "short video" : "photo"}`}
            <input type="file" accept={kind === "video" ? "video/*" : "image/*"} className="sr-only"
              aria-label={`Choose a ${kind}`} onChange={(e) => pickFile(e.target.files?.[0])} />
          </label>
        )}

        <div>
          <label htmlFor="status-body" className="sr-only">Status text</label>
          <textarea id="status-body" value={body} maxLength={TEXT_MAX} rows={3}
            onChange={(e) => setBody(e.target.value)}
            placeholder={kind === "text" ? "What is new at your business?" : "Add a line (optional)"}
            className="w-full rounded-xl border border-edge-1 bg-surface-1 p-3 text-sm text-ink-1" />
          <p className="mt-1 text-right text-micro text-ink-3 tabular-nums">{body.length}/{TEXT_MAX}</p>
        </div>

        <p className="text-micro text-ink-3">Seen only by businesses that follow you. Gone after 24 hours.</p>
        {error && <p role="alert" className="text-xs font-semibold text-red-600">{error}</p>}

        <button type="submit" disabled={!canPost}
          className="w-full rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {busy ? "Working…" : "Post status"}
        </button>
      </form>
    </div>
  );
}
