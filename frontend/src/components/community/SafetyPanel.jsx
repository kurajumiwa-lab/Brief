import { useEffect, useState } from "react";
import { Ban, FileText, ShieldCheck, VolumeX, X } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import { socialAPI } from "@/lib/api";

/**
 * YOUR SAFETY.
 *
 * The two lists that make "block" and "report" trustworthy rather than a black
 * hole: who you have blocked or muted, with an undo, and the cases you opened,
 * each with its number. If a person cannot see what they blocked and cannot see
 * where their report went, the control is theatre.
 *
 * Reads directly rather than through the feed store: these are private lists,
 * they change rarely, and they should not cost a feed request to see.
 */

const KIND_LABEL = { block: "Blocked", mute: "Muted" };

export default function SafetyPanel({ onClose }) {
  const [blocks, setBlocks] = useState(null);
  const [reports, setReports] = useState(null);
  const [failure, setFailure] = useState("");
  const [working, setWorking] = useState("");

  const load = async () => {
    setFailure("");
    try {
      const [blocked, cases] = await Promise.all([socialAPI.blocks(), socialAPI.reports()]);
      setBlocks(blocked.data || []);
      setReports(cases.data || []);
    } catch (error) {
      setFailure(
        error?.response?.data?.detail || "Couldn't read your safety settings. Nothing was changed."
      );
      setBlocks([]);
      setReports([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undo = async (row) => {
    setWorking(row.target_id);
    setFailure("");
    try {
      await socialAPI.unblock(row.target_id, row.kind);
      await load();
    } catch (error) {
      setFailure(error?.response?.data?.detail || "That didn't reach the server. Nothing changed.");
    } finally {
      setWorking("");
    }
  };

  return (
    <section
      aria-label="Your safety settings"
      className="space-y-3 rounded-2xl border border-edge-1 bg-surface-1 p-3"
    >
      <header className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-ink-3" aria-hidden="true" />
        <h2 className="flex-1 text-sm font-bold text-ink-1">Your safety settings</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-ink-4 hover:bg-surface-2 hover:text-ink-2"
          aria-label="Close safety settings"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      {failure && <p className="text-2xs font-semibold text-red-600">{failure}</p>}

      <div className="space-y-1.5">
        <p className="text-2xs font-bold uppercase tracking-wide text-ink-4">Blocked and muted</p>
        {blocks === null && <Spinner size={14} />}
        {blocks !== null && blocks.length === 0 && (
          <p className="text-2xs text-ink-3">
            Nobody. Blocking hides someone's posts from you; it never hides you from them or tells
            them. Muting is the quieter version.
          </p>
        )}
        {blocks?.map((row) => (
          <div
            key={row.id}
            className="flex items-center gap-2 rounded-lg bg-surface-0 px-2.5 py-1.5"
            data-testid={`block-${row.target_id}`}
          >
            <Badge variant={row.kind === "block" ? "red" : "gray"} size="xs">
              {row.kind === "block" ? <Ban size={10} aria-hidden="true" /> : <VolumeX size={10} aria-hidden="true" />}
              {KIND_LABEL[row.kind] || row.kind}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
              {row.target?.display_name || row.target?.handle || "An account"}
            </span>
            <Button
              size="xs"
              variant="ghost"
              loading={working === row.target_id}
              onClick={() => undo(row)}
            >
              Undo
            </Button>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <p className="text-2xs font-bold uppercase tracking-wide text-ink-4">Your reports</p>
        {reports === null && <Spinner size={14} />}
        {reports !== null && reports.length === 0 && (
          <p className="text-2xs text-ink-3">
            No cases. A report opens one with a number; the post stays up until a moderator decides.
          </p>
        )}
        {reports?.map((row) => (
          <div key={row.id} className="flex items-center gap-2 rounded-lg bg-surface-0 px-2.5 py-1.5">
            <FileText size={12} className="text-ink-4" aria-hidden="true" />
            <span className="font-mono text-2xs text-ink-2">{row.case_number}</span>
            <span className="min-w-0 flex-1 truncate text-2xs text-ink-3">{row.reason}</span>
            <Badge variant="outline" size="xs">{row.status}</Badge>
          </div>
        ))}
      </div>
    </section>
  );
}
