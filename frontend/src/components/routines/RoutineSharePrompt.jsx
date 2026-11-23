import { useState } from "react";
import { CalendarClock, Check, Share2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { recurringRoutineAPI, apiError } from "@/lib/api";

/**
 * THE ONE-TAP SHARE IN THE INBOX.
 *
 * When the hourly sweep publishes a weekly round, this is the only nudge the
 * owner gets: one row, one button, one WhatsApp text. It disappears once the
 * round has been shared (the server records `whatsapp_shared_at`), so the
 * Inbox does not become a reminder feed.
 */
export default function RoutineSharePrompt({ prompts = [], onShared }) {
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState([]);
  const open = prompts.filter((prompt) => !prompt.shared_at && !done.includes(prompt.instance_id));

  if (open.length === 0) return null;

  async function share(prompt) {
    const url = `${window.location.origin}${prompt.share_path}`;
    const text = `${prompt.share_text} ${url}`;
    setBusy(prompt.instance_id);
    try {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // A blocked clipboard must not block the share sheet.
      }
      await recurringRoutineAPI.markShared(prompt.instance_id);
      setDone((rows) => [...rows, prompt.instance_id]);
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      toast.success("Round shared. The link stays valid while it is live.");
      await onShared?.();
    } catch (err) {
      toast.error(apiError(err, "That round could not be shared."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-3 space-y-2" aria-labelledby="share-round-heading" data-testid="routine-share-prompt">
      <div className="flex items-center gap-1.5 px-1">
        <CalendarClock size={12} className="text-brand-700 dark:text-brand-300" aria-hidden="true" />
        <h2 id="share-round-heading" className="text-2xs font-extrabold text-ink-1">
          Share this week&apos;s round
        </h2>
      </div>
      <ul className="space-y-1.5">
        {open.slice(0, 3).map((prompt) => (
          <li key={prompt.instance_id} className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 p-2.5 dark:border-brand-500/30 dark:bg-brand-500/10">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-brand-900 dark:text-brand-100">{prompt.title}</p>
              <p className="text-2xs text-brand-800/70 dark:text-brand-200/70">
                {new Date(`${prompt.occurrence_date}T12:00:00`).toLocaleDateString(undefined, {
                  weekday: "long", day: "numeric", month: "short",
                })}
                {" · "}1-tap WhatsApp text
              </p>
            </div>
            <Button
              size="sm"
              icon={done.includes(prompt.instance_id) ? Check : Share2}
              loading={busy === prompt.instance_id}
              onClick={() => share(prompt)}
              className="min-h-[44px]"
            >
              WhatsApp
            </Button>
          </li>
        ))}
      </ul>
      <p className="px-1 text-2xs text-ink-4">
        Organic link only — no WhatsApp Business API. A weekly badge is a
        schedule, not a reliability guarantee, and awards no standing credit.
      </p>
    </section>
  );
}
