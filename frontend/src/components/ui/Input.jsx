import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

// v2.7: borderless glass fields — the fill, not a drawn box, marks the field
export const fieldBase =
  "w-full rounded-xl bg-white/[0.06] backdrop-blur-md text-sm text-ink-1 placeholder:text-ink-4 transition-all duration-200 " +
  "hover:bg-white/[0.08] focus:outline-none focus:bg-white/[0.09] focus:ring-2 focus:ring-brand-500/40 disabled:opacity-50";

export function FieldLabel({ htmlFor, children, required }) {
  if (!children) return null;
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-3 mb-1.5">
      {children}
      {required && <span className="text-brand-400 ml-0.5">*</span>}
    </label>
  );
}

export function FieldMeta({ error, hint }) {
  if (!error && !hint) return null;
  return <p className={cn("mt-1 text-2xs", error ? "text-red-400" : "text-ink-4")}>{error || hint}</p>;
}

const Input = forwardRef(function Input({ label, error, hint, icon: Icon, prefix, className, wrapperClassName, id, required, ...rest }, ref) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className={wrapperClassName}>
      <FieldLabel htmlFor={inputId} required={required}>{label}</FieldLabel>
      <div className="relative">
        {Icon && <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />}
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-4 font-mono pointer-events-none">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          required={required}
          className={cn(fieldBase, "h-9 px-3", Icon && "pl-9", prefix && "pl-10", error && "bg-red-500/[0.08] ring-2 ring-red-500/30 focus:ring-red-500/50", className)}
          {...rest}
        />
      </div>
      <FieldMeta error={error} hint={hint} />
    </div>
  );
});

export default Input;
