import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";
import { fieldBase, FieldLabel, FieldMeta } from "./Input";

const Textarea = forwardRef(function Textarea({ label, error, hint, className, wrapperClassName, id, rows = 3, required, ...rest }, ref) {
  const autoId = useId();
  const areaId = id || autoId;
  return (
    <div className={wrapperClassName}>
      <FieldLabel htmlFor={areaId} required={required}>{label}</FieldLabel>
      <textarea ref={ref} id={areaId} rows={rows} required={required} className={cn(fieldBase, "px-3 py-2 resize-y min-h-[2.5rem]", error && "bg-red-500/[0.08] ring-2 ring-red-500/30", className)} {...rest} />
      <FieldMeta error={error} hint={hint} />
    </div>
  );
});

export default Textarea;
