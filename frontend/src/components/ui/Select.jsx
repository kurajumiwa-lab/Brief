import { forwardRef, useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldBase, fieldError, FieldLabel, FieldMeta } from "./Input";

const Select = forwardRef(function Select(
  { label, error, hint, options = [], placeholder, className, wrapperClassName, id, required, children, ...rest },
  ref
) {
  const autoId = useId();
  const selectId = id || autoId;
  const metaId = `${selectId}-meta`;
  return (
    <div className={wrapperClassName}>
      <FieldLabel htmlFor={selectId} required={required}>
        {label}
      </FieldLabel>
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? metaId : undefined}
          className={cn(fieldBase, "h-10 pl-3 pr-9 appearance-none cursor-pointer", error && fieldError, className)}
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
        <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" aria-hidden="true" />
      </div>
      <FieldMeta error={error} hint={hint} id={metaId} />
    </div>
  );
});

export default Select;
