import { cn } from "@/lib/utils";

/**
 * Status chips. Tinted fill + matching text, legible on both themes.
 * Status is never carried by colour alone — every caller passes a word too.
 *
 * ON THE NAME `purple`. The token ramp behind it is `orchid`, which is a cool
 * slate, so this variant looks blue-grey rather than violet. The name is wrong
 * twice over: it describes a hue the product does not use, and it is chosen by
 * callers to mean *seven unrelated things* — "scheduled", "service", "rental",
 * "shortlisted", "moderator", "stop", "patron". A colour that means everything
 * means nothing, and at a glance a chip reading "Scheduled" in the same colour
 * as one reading "Moderator" is not a signal.
 *
 * `purple` is kept as an alias because 20+ call sites pass it, but `neutral` is
 * the name to use: it is what the ramp actually is, and it does not invite
 * anyone to pick it for "the colour I have not used yet". Both resolve to the
 * same classes, so this is a rename, not a restyle.
 */
const variants = {
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  amber: "bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300",
  red: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  neutral: "bg-orchid-50 text-orchid-700 dark:bg-orchid-500/15 dark:text-orchid-300",
  // Deprecated alias — same classes, kept so existing call sites keep working.
  purple: "bg-orchid-50 text-orchid-700 dark:bg-orchid-500/15 dark:text-orchid-300",
  gray: "bg-surface-2 text-ink-3",
  outline: "bg-transparent text-ink-3 border border-edge-2",
  solid: "bg-ink-1 text-surface-0",
};

const sizes = {
  xs: "px-1.5 py-0.5 text-micro",
  sm: "px-2 py-0.5 text-2xs",
  md: "px-2.5 py-1 text-xs",
};

export default function Badge({ variant = "gray", size = "sm", dot, className, children, ...rest }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap leading-none",
        sizes[size] || sizes.sm,
        variants[variant] || variants.gray,
        className
      )}
      {...rest}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
}
