import { AlertTriangle, RotateCw } from "lucide-react";
import Button from "./Button";
import EmptyState from "./EmptyState";

/**
 * A failed fetch is a state, not a blank screen. It says what broke and
 * offers the one useful action: try again.
 */
export default function ErrorState({ title = "That didn't load", description, onRetry, retryLabel = "Try again", action, compact }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      tone="danger"
      compact={compact}
      title={title}
      description={description || "The network or the server didn't answer. Nothing was changed."}
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
