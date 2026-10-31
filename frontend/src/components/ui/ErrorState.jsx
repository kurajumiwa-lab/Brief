import { AlertTriangle, RotateCw } from "lucide-react";
import Button from "./Button";
import EmptyState from "./EmptyState";

/**
 * A failed fetch is a state, not a blank screen. It says what broke and
 * offers the one useful action: try again.
 *
 * `detail` is the raw answer from the server, folded away behind a disclosure.
 * It exists because a fault report that can be read aloud ("it says column
 * stock_items.brand does not exist") is worth ten minutes of guessing — but it
 * must never be the headline. A page whose *title* was a database error is how a
 * live vendor came to be reported as missing.
 *
 * `onRetry` is only passed when repeating the request could actually help;
 * `retryable` in `@/lib/failure` is where that judgement lives.
 */
export default function ErrorState({
  title = "That didn't load",
  description,
  onRetry,
  retryLabel = "Try again",
  action,
  detail,
  compact,
}) {
  return (
    <EmptyState
      icon={AlertTriangle}
      tone="danger"
      compact={compact}
      title={title}
      description={
        <>
          <span>{description || "The network or the server didn't answer. Nothing was changed."}</span>
          {detail ? (
            <details className="mt-2 text-left">
              <summary className="cursor-pointer text-micro font-semibold text-ink-3 hover:text-ink-2">
                What the server said
              </summary>
              <p className="mt-1.5 rounded-lg bg-surface-2 px-2.5 py-2 font-mono text-micro leading-relaxed text-ink-3 break-words">
                {detail}
              </p>
            </details>
          ) : null}
        </>
      }
      action={
        onRetry ? (
          <Button size="sm" variant="secondary" icon={RotateCw} onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
      secondaryAction={action}
    />
  );
}
