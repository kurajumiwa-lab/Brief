import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Compass } from "lucide-react";
import { nextShelf } from "@/lib/guide";

/**
 * CAESAR, AT THE END OF THE AISLE.
 *
 * Not a chat box. A guide in a supermarket does not wait to be asked — it
 * stands where you are already walking and says "the eggs are this way". That
 * is what this is: three chips under a shelf, drawn from `GET /api/guide/next`.
 *
 * Three rules, all of them visible in the code below:
 *
 *  · **It explains itself.** `basis` from the server is rendered: "from N next
 *    taps" when it was learned, "the shelf map" when it was not. A guide that
 *    pretends to know more than it does is a guide nobody checks.
 *  · **Silence is a valid answer.** No suggestions, a slow network, or an
 *    error all render nothing. A chip that appears and then vanishes is worse
 *    than no chip, and an error message under every shelf is noise, not help.
 *  · **It never sends you somewhere empty.** The server only proposes the nine
 *    shelves that exist, so every chip leads to a real screen.
 */
export default function CaesarGuide({ from, className = "", limit = 3 }) {
  const [state, setState] = useState({ loading: true, basis: null, why: null, suggestions: [] });

  useEffect(() => {
    let alive = true;
    if (!from) return undefined;
    setState((s) => ({ ...s, loading: true }));
    nextShelf(from).then((data) => {
      if (!alive) return;
      setState({
        loading: false,
        basis: data?.basis ?? null,
        why: data?.why ?? null,
        suggestions: data?.suggestions ?? [],
      });
    });
    return () => {
      alive = false;
    };
  }, [from]);

  const chips = useMemo(() => state.suggestions.slice(0, limit), [state.suggestions, limit]);
  if (!from || state.loading || chips.length === 0) return null;

  const learned = state.basis === "observed";

  return (
    <nav
      aria-label="Where to go next"
      data-testid="caesar-guide"
      data-basis={state.basis}
      className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 ${className}`}
    >
      <span className="inline-flex items-center gap-1 text-micro font-semibold text-ink-4">
        <Compass size={12} aria-hidden="true" />
        Next
      </span>

      {chips.map((s) => (
        <Link
          key={s.shelf}
          to={s.to}
          className="inline-flex items-center gap-1 rounded-full border border-edge-1 bg-surface-1 px-2.5 py-1 text-micro font-semibold text-ink-2 transition-colors hover:border-brand-300 hover:bg-brand-500/10 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:hover:text-brand-300"
          title={s.blurb}
        >
          {s.label}
          <ArrowRight size={10} aria-hidden="true" />
        </Link>
      ))}

      {/* Where the suggestion came from, in the same size text as the chips. */}
      <span className="text-micro text-ink-4">
        {learned ? `learned from ${state.why?.replace(/^From /i, "").replace(/\.$/, "")}` : "the shelf map"}
      </span>
    </nav>
  );
}
