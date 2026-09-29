import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

export const fieldBase =
  "w-full rounded-lg border border-edge-2 bg-surface-1 text-sm text-ink-1 placeholder:text-ink-4 transition-colors " +
  "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40 disabled:opacity-50";

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
          className={cn(fieldBase, "h-9 px-3", Icon && "pl-9", prefix && "pl-10", error && "border-red-500/60 focus:border-red-500", className)}
          {...rest}
        />
      </div>
      <FieldMeta error={error} hint={hint} />
    </div>
  );
});

export default Input;
