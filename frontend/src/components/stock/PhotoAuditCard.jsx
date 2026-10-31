import { useState } from "react";
import { Image, ImageOff, Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { fileAPI, apiError } from "@/lib/api";

/**
 * "ARE MY PHOTOS ACTUALLY THERE?" — the check a seller can run themselves.
 *
 * A deployment that stored uploads on a disk it does not keep (see
 * `docs/briefs/deploy-media-and-migrations.md`) left records whose photographs
 * are gone. Every one of those cards draws the same designed placeholder as a
 * listing that never had a photo, so the only way to find them was to open every
 * listing and remember.
 *
 * This asks the server which of the seller's own recorded photos it cannot
 * serve, and names them. It repairs nothing — a lost file cannot be recovered —
 * but it turns "some of my pictures are missing" into a list of things to
 * re-photograph, which is the only useful form of that sentence.
 *
 * Deliberately a button rather than an automatic call on mount: the answer costs
 * an object-store lookup per photo, and a vendor opening their shelf to add
 * stock should not pay for a maintenance check they did not ask for.
 */
export default function PhotoAuditCard() {
  const [state, setState] = useState({ status: "idle" });
  const busy = state.status === "checking";

  const check = async () => {
    setState({ status: "checking" });
    try {
      const { data } = await fileAPI.audit();
      setState({ status: "ready", data });
    } catch (err) {
      setState({ status: "error", message: apiError(err, "Couldn't check your photos") });
    }
  };

  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-surface-0 border border-edge-1 p-2.5">
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-surface-2 text-brand-700 dark:text-brand-300 shrink-0">
        <Image size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="font-bold text-ink-1">Step 4 — Confirm your photos load</p>
        <p className="mt-0.5 leading-snug">
          A missing picture and a picture the server lost look the same on a card. Check which of
          yours the server can actually serve.
        </p>

        <Button
          size="sm"
          variant="secondary"
          className="mt-1.5"
          disabled={busy}
          onClick={check}
          icon={busy ? Loader2 : undefined}
        >
          {busy ? "Checking…" : state.status === "ready" ? "Check again" : "Check my photos"}
        </Button>

        {state.status === "error" && (
          <p className="mt-1.5 text-micro font-semibold text-red-700 dark:text-red-300">{state.message}</p>
        )}

        {state.status === "ready" && (
          <div className="mt-1.5" data-testid="photo-audit-result">
            {state.data.missing_count === 0 ? (
              <p className="text-micro font-semibold text-brand-700 dark:text-brand-300">
                All {state.data.checked} recorded photo{state.data.checked === 1 ? "" : "s"} can be
                served.
              </p>
            ) : (
              <>
                <p className="text-micro font-semibold text-red-700 dark:text-red-300">
                  <ImageOff size={12} className="inline -mt-0.5 mr-1" aria-hidden="true" />
                  {state.data.missing_count} photo
                  {state.data.missing_count === 1 ? " is" : "s are"} gone from the server. Re-add
                  them — the file cannot be recovered.
                </p>
                <ul className="mt-1 space-y-0.5">
                  {state.data.missing.slice(0, 6).map((item) => (
                    <li key={`${item.where}-${item.id}-${item.url}`} className="text-micro text-ink-3">
                      <span className="font-semibold text-ink-2">{item.label}</span>
                      <span className="text-ink-4"> · {item.where}</span>
                    </li>
                  ))}
                  {state.data.missing.length > 6 && (
                    <li className="text-micro text-ink-4">
                      and {state.data.missing.length - 6} more
                    </li>
                  )}
                </ul>
              </>
            )}
            {!state.data.durable && (
              <p className="mt-1 text-micro text-red-700 dark:text-red-300">
                This server still stores photos on a disk it does not keep. Uploads are refused
                rather than lost — ask the operator to set MEDIA_STORE=db.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
