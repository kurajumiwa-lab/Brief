import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn, debounce } from "@/lib/utils";
import { fieldBase } from "./Input";

/** Controlled-looking search box that debounces `onChange`. */
export default function SearchInput({ value = "", onChange, placeholder = "Search…", delay = 300, className, autoFocus, size = "md", "aria-label": ariaLabel }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  const emit = useMemo(() => debounce((v) => onChange?.(v), delay), [onChange, delay]);
  useEffect(() => () => emit.cancel(), [emit]);

  const update = (v) => {
    setText(v);
    emit(v);
  };

  return (
    <div className={cn("relative", className)}>
      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" aria-hidden="true" />
      <input
        type="search"
        role="searchbox"
        aria-label={ariaLabel || placeholder}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => update(e.target.value)}
        placeholder={placeholder}
        className={cn(fieldBase, size === "lg" ? "h-12 text-base" : "h-10", "pl-10 pr-9")}
      />
      {text && (
        <button
          type="button"
          onClick={() => {
            emit.cancel();
            setText("");
            onChange?.("");
          }}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-ink-4 hover:text-ink-1 hover:bg-surface-2"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
