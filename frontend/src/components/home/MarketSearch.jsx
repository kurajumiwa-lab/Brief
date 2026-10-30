import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Clock3, MapPin, Package, Search, Store, X } from "lucide-react";
import { SEARCH_SCOPES } from "@/config/navigation";
import { suggest as suggestTerms } from "@/lib/guide";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

/**
 * THE MARKET SEARCH — one compact field, and nothing invented under it.
 *
 * Two things this replaces, both on purpose:
 *
 *  · **The hardcoded chip list.** "tomatoes, sukuma wiki, cooking oil, kitenge,
 *    rice" was the same five words for a tailor in Kisumu and a hardware shop in
 *    Nakuru, and four of them were usually wrong. Worse, a chip that leads to an
 *    empty result teaches people the search does not work.
 *  · **The suggestion band that was always there.** It occupied a permanent row
 *    under the field whether or not it had anything to say.
 *
 * What happens now, and only on evidence:
 *
 *  · **Typing (2+ letters).** The guide is asked, debounced. It returns real
 *    shelf names and real item names that exist and have stock right now —
 *    "Tomatoes (crate) · 1 shelf carries it · from KSh 180". Choosing one goes
 *    straight to the record or the shelf.
 *  · **An empty field, on a vendor who has declared categories.** Their own
 *    categories, because that is genuinely specific to them and is a fact the
 *    session already holds. No categories means no chips — never a generic list.
 *  · **Nothing else.** No suggestions, no band, no reserved space.
 *
 * The field itself is one control: 40px tall, the scope selector inside it, and
 * ⌘K/^K still focuses it from anywhere.
 */

const KEEP_VISIBLE = 5;

function categoryChips(categories) {
  return (Array.isArray(categories) ? categories : [])
    .filter((c) => typeof c === "string" && c.trim())
    .slice(0, 4)
    .map((c) => ({
      key: `cat:${c}`,
      label: c.replace(/[_-]+/g, " ").trim(),
      to: `/browse?type=goods&search=${encodeURIComponent(c)}`,
      icon: Package,
      hint: "your category",
    }));
}

export default function MarketSearch({ className, autoFocus, onSubmitted, compact = false }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const categories = useAuthStore((s) => s.vendor?.business_categories);

  const [scope, setScope] = useState(() => {
    try {
      return localStorage.getItem("brief-search-scope") || "stock";
    } catch {
      return "stock";
    }
  });
  const [q, setQ] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [live, setLive] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const current = SEARCH_SCOPES.find((s) => s.value === scope) || SEARCH_SCOPES[0];

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced, cancelled on every keystroke: the guide is asked at most once
  // per pause, and never for the query the reader has already moved past.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setLive([]);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      suggestTerms(term, { limit: KEEP_VISIBLE }).then((rows) => {
        if (!alive) return;
        setLive(rows);
        setLoading(false);
      });
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  const pickScope = (value) => {
    setScope(value);
    setScopeOpen(false);
    try {
      localStorage.setItem("brief-search-scope", value);
    } catch {
      /* non-persistent is fine */
    }
    inputRef.current?.focus();
  };

  const submit = (e) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return inputRef.current?.focus();
    navigate(current.to(term));
    setOpen(false);
    onSubmitted?.();
  };

  const go = (to) => {
    navigate(to);
    setOpen(false);
    onSubmitted?.();
  };

  const typing = q.trim().length >= 2;
  const chips = useMemo(
    () => (typing ? live.map((row, i) => ({
      key: `live:${row.to}:${i}`,
      label: row.label,
      to: row.to,
      hint: row.blurb,
      icon: row.kind === "shelf" ? Store : Package,
      kind: row.kind,
    })) : categoryChips(categories)),
    [typing, live, categories]
  );

  // The band is shown when it has something to say — including "there is
  // nothing", which is information, not an error. It stays hidden when the
  // field is empty and the vendor has declared no categories, because then
  // there is genuinely nothing specific to offer.
  const showBand = open && (chips.length > 0 || typing);

  return (
    <div className={cn("relative", className)}>
      <form
        role="search"
        onSubmit={submit}
        onFocus={() => setOpen(true)}
        data-testid="market-search"
        className={cn(
          "group relative flex items-stretch rounded-xl border border-white/25 bg-surface-0/97 shadow-sm",
          "focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/25",
          "transition-[border-color,box-shadow] duration-1",
          compact ? "h-9" : "h-10"
        )}
      >
        <label htmlFor="market-search-input" className="sr-only">
          Search the network
        </label>
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"
          aria-hidden="true"
        />
        <input
          id="market-search-input"
          type="search"
          ref={inputRef}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            // Typing is itself an intent to see suggestions, whether or not the
            // reader's finger was on the field when the value changed.
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={`Search ${current.label.toLowerCase()}…`}
          className="market-search-input min-w-0 flex-1 rounded-l-xl bg-transparent pr-1 text-xs text-ink-1 placeholder:text-ink-4 focus:outline-none"
          style={{ paddingLeft: "2.125rem" }}
          aria-expanded={showBand}
          aria-controls="market-search-suggestions"
          autoComplete="off"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setLive([]);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="px-1 text-ink-4 hover:text-ink-1"
          >
            <X size={13} />
          </button>
        )}

        {/* Scope lives inside the field: one control, not two. */}
        <div className="relative flex items-center border-l border-edge-1">
          <button
            type="button"
            onClick={() => setScopeOpen((o) => !o)}
            onBlur={() => setTimeout(() => setScopeOpen(false), 120)}
            aria-haspopup="listbox"
            aria-expanded={scopeOpen}
            aria-label={`Search scope: ${current.label}`}
            className="flex h-full items-center gap-1 rounded-r-xl px-2.5 text-micro font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink-1"
          >
            <current.icon size={13} aria-hidden="true" />
            <span className="hidden sm:inline">{current.label}</span>
            <ChevronDown
              size={12}
              className={cn("transition-transform duration-1", scopeOpen && "rotate-180")}
              aria-hidden="true"
            />
          </button>
          {scopeOpen && (
            <ul
              role="listbox"
              className="absolute right-0 top-[calc(100%+6px)] z-50 w-44 animate-scale-in origin-top-right rounded-xl border border-edge-1 bg-surface-0 p-1 shadow-lg"
            >
              {SEARCH_SCOPES.map((s) => (
                <li key={s.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={s.value === scope}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickScope(s.value)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-2xs font-semibold transition-colors",
                      s.value === scope
                        ? "bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300"
                        : "text-ink-2 hover:bg-surface-2"
                    )}
                  >
                    <s.icon size={13} aria-hidden="true" />
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>

      {showBand && (
        <div
          id="market-search-suggestions"
          data-testid="market-search-suggestions"
          data-source={typing ? "live" : "categories"}
          className="mt-1.5 overflow-hidden rounded-xl border border-white/20 bg-surface-0/97 shadow-lg backdrop-blur-sm"
        >
          <p className="flex items-center gap-1 px-2.5 pb-0.5 pt-1.5 text-micro font-bold uppercase tracking-[0.12em] text-ink-4">
            {typing ? (
              loading ? (
                <>
                  <Clock3 size={10} aria-hidden="true" /> Looking on the shelves…
                </>
              ) : (
                <>
                  <Search size={10} aria-hidden="true" /> On the network now
                </>
              )
            ) : (
              <>
                <MapPin size={10} aria-hidden="true" /> What you trade in
              </>
            )}
          </p>
          <ul className="max-h-[13rem] overflow-y-auto p-1">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  onClick={() => go(chip.to)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
                >
                  <chip.icon size={13} className="shrink-0 text-brand-700 dark:text-brand-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-2xs font-semibold text-ink-1">{chip.label}</span>
                    {chip.hint && (
                      <span className="block truncate text-micro text-ink-4">{chip.hint}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {typing && !loading && live.length === 0 && (
            <p className="px-2.5 pb-2 text-micro text-ink-4">
              Nothing on the shelves matches that yet. Searching anyway will show what the network has.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
