import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

// v3 fields: a drawn box again. In daylight a tinted fill alone disappears.
export const fieldBase =
  "w-full rounded-xl bg-surface-0 text-sm text-ink-1 placeholder:text-ink-4 " +
  "border border-edge-2 shadow-xs transition-[border-color,box-shadow,background-color] duration-1 ease-out " +
  "hover:border-edge-3 focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 " +
  "disabled:opacity-50 disabled:bg-surface-2 disabled:cursor-not-allowed";

export const fieldError = "border-red-500 focus:border-red-500 focus:ring-red-500/15";

export function FieldLabel({ htmlFor, children, required }) {
  if (!children) return null;
  return (
    <label htmlFor={htmlFor} className="block text-2xs font-semibold text-ink-2 mb-1.5">
      {children}
      {required && (
        <span className="text-red-500 ml-0.5" aria-hidden="true">
          *
        </span>
      )}
    </label>
  );
}

export function FieldMeta({ error, hint, id }) {
  if (!error && !hint) return null;
  return (
    <p id={id} className={cn("mt-1.5 text-2xs", error ? "text-red-600 dark:text-red-400 font-medium" : "text-ink-4")} role={error ? "alert" : undefined}>
      {error || hint}
    </p>
  );
}

const Input = forwardRef(function Input(
  { label, error, hint, icon: Icon, prefix, suffix, className, wrapperClassName, id, required, ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id || autoId;
  const metaId = `${inputId}-meta`;
  return (
    <div className={wrapperClassName}>
      <FieldLabel htmlFor={inputId} required={required}>
        {label}
      </FieldLabel>
      <div className="relative">
        {Icon && <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" aria-hidden="true" />}
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-2xs text-ink-4 font-medium pointer-events-none">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? metaId : undefined}
          className={cn(fieldBase, "h-10 px-3", Icon && "pl-9", prefix && "pl-11", suffix && "pr-11", error && fieldError, className)}
          {...rest}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-2xs text-ink-4 font-medium pointer-events-none">{suffix}</span>}
      </div>
      <FieldMeta error={error} hint={hint} id={metaId} />
    </div>
  );
});

export default Input;
