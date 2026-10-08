import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Search, X } from "lucide-react";
import { SEARCH_SCOPES } from "@/config/navigation";
import { cn } from "@/lib/utils";

/**
 * The marketplace search bar: one field, one scope.
 *
 * v2 had four separate search boxes (Stock Room, Network, Markets, Tools) and
 * a clock in the header. v3 puts one scoped field in the most valuable row of
 * the app — each scope routes to the screen that already owns that query, so
 * no new endpoint is involved.
 *
 * ⌘K / Ctrl-K focuses it from anywhere.
 */
export default function GlobalSearch({ className, autoFocus, onSubmitted, size = "md" }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [scope, setScope] = useState(() => {
    try {
      return localStorage.getItem("brief-search-scope") || "stock";
    } catch {
      return "stock";
    }
  });
  const [q, setQ] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = SEARCH_SCOPES.find((s) => s.value === scope) || SEARCH_SCOPES[0];

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
    onSubmitted?.();
  };

  const tall = size === "lg";

  return (
    <form
      role="search"
      onSubmit={submit}
      className={cn(
        "group relative flex items-stretch rounded-xl border border-edge-2 bg-surface-0 shadow-xs",
        "focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 transition-[border-color,box-shadow] duration-1",
        tall ? "h-13" : "h-10",
        className
      )}
      style={tall ? { height: "3.25rem" } : undefined}
    >
      <label htmlFor="global-search" className="sr-only">
        Search the network
      </label>
      <Search size={tall ? 18 : 16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" aria-hidden="true" />
      <input
        id="global-search"
        ref={inputRef}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${current.label.toLowerCase()}…`}
        className={cn(
          "flex-1 min-w-0 bg-transparent pl-10 pr-2 text-ink-1 placeholder:text-ink-4 focus:outline-none rounded-l-xl",
          tall ? "text-base" : "text-sm"
        )}
      />
      {q && (
        <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="px-1.5 text-ink-4 hover:text-ink-1">
          <X size={14} />
        </button>
      )}

      {/* Scope selector — a real listbox, keyboard reachable */}
      <div className="relative flex items-center border-l border-edge-1">
        <button
          type="button"
          onClick={() => setScopeOpen((o) => !o)}
          onBlur={() => setTimeout(() => setScopeOpen(false), 120)}
          aria-haspopup="listbox"
          aria-expanded={scopeOpen}
          aria-label={`Search scope: ${current.label}`}
          className="h-full flex items-center gap-1 px-3 text-2xs font-semibold text-ink-2 hover:text-ink-1 hover:bg-surface-2 transition-colors"
        >
          <current.icon size={14} aria-hidden="true" />
          <span className="hidden sm:inline">{current.label}</span>
          <ChevronDown size={13} className={cn("transition-transform duration-1", scopeOpen && "rotate-180")} aria-hidden="true" />
        </button>
        {scopeOpen && (
          <ul
            role="listbox"
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-44 rounded-xl border border-edge-1 bg-surface-0 shadow-lg p-1 animate-scale-in origin-top-right"
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
                    "w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-left transition-colors",
                    s.value === scope ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" : "text-ink-2 hover:bg-surface-2"
                  )}
                >
                  <s.icon size={14} aria-hidden="true" />
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="submit"
        className={cn(
          "shrink-0 m-1 ml-0 rounded-lg bg-ink-1 px-3.5 text-surface-0 font-semibold text-2xs",
          "hover:bg-ink-2 active:scale-[0.97] transition-[background-color,transform] duration-1"
        )}
      >
        <Search size={15} className="sm:hidden" aria-hidden="true" />
        <span className="hidden sm:inline">Search</span>
      </button>
    </form>
  );
}
