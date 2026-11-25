import { Check } from "lucide-react";
import { CREATE_INTENTS } from "@/config/createIntents";
import { cn } from "@/lib/utils";

/**
 * THE CREATE SHEET — six purposes, chosen before anything is typed.
 *
 * The old Create page opened with two grids of internal type names (Available,
 * Wanted, Scheduled, Opportunity, Post, Event, Goods, Community, Collection,
 * Opportunity) and asked the person to pick a *system* before they could
 * describe their *intent*. Nine names, two of them duplicated, and not one of
 * them a thing a person would say out loud.
 *
 * This sheet is the whole fix: six plain purposes, each one a real publishing
 * path, each one carrying the fields that path needs. The internal type is
 * still decided — it is just decided behind the curtain, where it belongs.
 *
 * It is a radiogroup, not a menu of links, because picking a purpose *changes
 * the form below it*. A keyboard user arrows through it; a screen reader
 * announces the purpose and its hint as one choice.
 */

export default function CreateIntentSheet({ value, onSelect, className }) {
  return (
    <section aria-labelledby="create-intent-heading" className={cn("space-y-3", className)}>
      <div>
        <h2 id="create-intent-heading" className="ds-title">
          What do you want to do?
        </h2>
        <p className="mt-1 ds-lede">
          Pick the closest one. The form below changes to match it, and you can
          change your mind at any time.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="What do you want to publish?"
        data-testid="create-intent-sheet"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {CREATE_INTENTS.map((intent) => {
          const Icon = intent.icon;
          const active = value === intent.id;
          return (
            <button
              key={intent.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect?.(intent)}
              data-testid={`create-intent-${intent.id}`}
              className={cn(
                "ds-focus flex min-h-11 items-start gap-3 rounded-2xl border p-3 text-left transition-colors duration-1",
                active
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-500/15"
                  : "border-edge-1 bg-surface-1 hover:border-edge-2 hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                  active
                    ? "bg-brand-600 text-white"
                    : "bg-surface-2 text-ink-3",
                )}
              >
                <Icon size={17} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-ink-1">{intent.label}</span>
                  {active && (
                    <Check size={14} className="text-brand-700 dark:text-brand-300" aria-hidden="true" />
                  )}
                </span>
                <span className="mt-0.5 block text-2xs leading-snug text-ink-4">{intent.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
