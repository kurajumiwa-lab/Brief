import { useEffect, useState } from "react";
import { Loader2, Mic, Play, RotateCw } from "lucide-react";
import { chatAPI, apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

function prettySize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "small audio file";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VoiceNote({ message, mine }) {
  const [audioUrl, setAudioUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const details = (message.attachments || []).find((item) => item?.kind === "voice") || {};
  const duration = Math.max(0, Math.round(Number(details.duration_seconds) || 0));

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const load = async () => {
    if (loading || audioUrl) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await chatAPI.voice(message.room_id, message.id);
      setAudioUrl(URL.createObjectURL(data));
    } catch (err) {
      setError(apiError(err, "Couldn't load this voice note"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn("min-w-[220px] max-w-full", message.content && "mt-2")}>
      {!audioUrl ? (
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-70",
            mine ? "border-edge-1 bg-surface-2 hover:bg-surface-2" : "border-edge-1 bg-surface-2 hover:bg-surface-1"
          )}
          aria-label={loading ? "Loading voice note" : `Load voice note, ${duration} seconds, ${prettySize(details.size_bytes)}`}
        >
          {loading ? <Loader2 size={16} className="shrink-0 animate-spin" /> : error ? <RotateCw size={16} className="shrink-0" /> : <Play size={16} className="shrink-0" />}
          <span className="min-w-0">
            <span className="block text-xs font-semibold">{loading ? "Loading voice note…" : error ? "Try loading again" : "Load voice note"}</span>
            <span className="block text-2xs opacity-75">{duration}s · {prettySize(details.size_bytes)} · tap to download</span>
            {error && <span className="block text-2xs text-red-600 dark:text-red-400">{error}</span>}
          </span>
          <Mic size={14} className="ml-auto shrink-0 opacity-70" />
        </button>
      ) : (
        <audio className="block h-10 max-w-full" controls preload="none" src={audioUrl} aria-label={`Voice note, ${duration} seconds`} />
      )}
    </div>
  );
}
