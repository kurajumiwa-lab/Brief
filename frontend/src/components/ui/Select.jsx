import { forwardRef, useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldBase, FieldLabel, FieldMeta } from "./Input";

const Select = forwardRef(function Select({ label, error, hint, options = [], placeholder, className, wrapperClassName, id, required, children, ...rest }, ref) {
  const autoId = useId();
  const selectId = id || autoId;
  return (
    <div className={wrapperClassName}>
      <FieldLabel htmlFor={selectId} required={required}>{label}</FieldLabel>
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          required={required}
          className={cn(fieldBase, "h-9 pl-3 pr-8 appearance-none cursor-pointer", error && "border-red-500/60", className)}
          {...rest}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {children}
        </select>
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
      </div>
      <FieldMeta error={error} hint={hint} />
    </div>
  );
});

export default Select;
