import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";
import { fieldBase, fieldError, FieldLabel, FieldMeta } from "./Input";

const Textarea = forwardRef(function Textarea({ label, error, hint, className, wrapperClassName, id, rows = 3, required, ...rest }, ref) {
  const autoId = useId();
  const areaId = id || autoId;
  const metaId = `${areaId}-meta`;
  return (
    <div className={wrapperClassName}>
      <FieldLabel htmlFor={areaId} required={required}>
        {label}
      </FieldLabel>
      <textarea
        ref={ref}
        id={areaId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? metaId : undefined}
        className={cn(fieldBase, "px-3 py-2.5 resize-y min-h-[2.75rem] leading-relaxed", error && fieldError, className)}
        {...rest}
      />
      <FieldMeta error={error} hint={hint} id={metaId} />
    </div>
  );
});

export default Textarea;
