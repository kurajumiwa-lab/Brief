import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn, debounce } from "@/lib/utils";
import { fieldBase } from "./Input";

/** Controlled-looking search box that debounces `onChange`. */
export default function SearchInput({ value = "", onChange, placeholder = "Search…", delay = 300, className, autoFocus }) {
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
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
      <input
        type="search"
        role="searchbox"
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => update(e.target.value)}
        placeholder={placeholder}
        className={cn(fieldBase, "h-9 pl-9 pr-8")}
      />
      {text && (
        <button
          onClick={() => {
            emit.cancel();
            setText("");
            onChange?.("");
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-ink-4 hover:text-ink-1"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
