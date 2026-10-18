import { MapPin, X } from "lucide-react";
import { Link } from "react-router-dom";
import Button from "@/components/ui/Button";
import LocationBar from "@/components/outside/LocationBar";
import { dismissOnboarding, onboardingDismissed } from "@/stores/createStore";
import { useOutsideStore } from "@/stores/outsideStore";
import { useState } from "react";

/**
 * THE ONE FIRST-RUN PROMPT — and it asks for one thing.
 *
 * This replaces `OnboardingFlow`, which opened itself over every screen until
 * the person had completed a *business profile* and walked a market radar. That
 * was shelf-specific onboarding in disguise: you had to learn how the shop
 * worked before the app was usable, and on a discovery network most people are
 * not setting up a shop.
 *
 * What is actually needed before Outside is useful is a location. So this asks
 * for that, inline, once, dismissible — and it is a card in the feed rather
 * than a modal, because nothing about it is urgent enough to take over the
 * screen. Dismissing it never shows it again.
 *
 * The `/api/onboarding` endpoint and `OnboardingFlow` are both still in the
 * tree: the vendor workspace reaches them from Profile. What changed is that
 * they no longer interrupt.
 */
export default function LocationPrompt() {
  const location = useOutsideStore((s) => s.location);
  const loadLocation = useOutsideStore((s) => s.loadLocation);
  const [dismissed, setDismissed] = useState(onboardingDismissed());

  if (dismissed) return null;
  if (!location) {
    loadLocation();
    return null;
  }
  // Only prompt when there is genuinely nothing to go on. A point that came
  // from the business address is a point; the LocationBar explains it.
  if (location.source !== "unset" && location.lat != null) return null;

  const onDismiss = () => {
    dismissOnboarding();
    setDismissed(true);
  };

  return (
    <section
      aria-labelledby="location-prompt-title"
      data-testid="location-prompt"
      className="space-y-3 rounded-card-lg border border-brand-500/30 bg-brand-50/60 p-4 shadow-xs dark:bg-brand-500/5 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
            <MapPin size={12} aria-hidden="true" /> One thing to set up
          </p>
          <h2 id="location-prompt-title" className="mt-1 text-title-section font-bold text-ink-1">
            Tell Outside where you are
          </h2>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-ink-3">
            A neighbourhood or a town is enough — we never need your exact address, and you can
            type it instead of sharing your device location. This is the only setup the app asks for.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Don't ask again"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-4 transition-colors hover:bg-surface-2 hover:text-ink-1"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <LocationBar />

      <div className="flex flex-wrap items-center gap-2">
        <Link to="/create">
          <Button size="sm">Post something first</Button>
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="text-2xs font-semibold text-ink-4 underline-offset-2 hover:text-ink-1 hover:underline"
        >
          Skip for now
        </button>
      </div>
    </section>
  );
}
