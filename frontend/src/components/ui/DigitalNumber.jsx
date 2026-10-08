import { cn } from "@/lib/utils";

const TONES = {
  default: "text-ink-1",
  brand: "text-brand-600 dark:text-brand-400",
  blue: "text-blue-600 dark:text-blue-400",
  amber: "text-accent-600 dark:text-accent-400",
  red: "text-red-600 dark:text-red-400",
};

const SIZES = {
  xs: "text-sm",
  sm: "text-lg",
  md: "text-2xl",
  xl: "text-3xl",
  "2xl": "text-4xl",
  "3xl": "text-5xl",
};

/**
 * v3 — the figure, rendered in the product typeface with tabular numerals.
 *
 * The seven-segment face and its glow were retired as the default: they cost a
 * webfont and lose legibility below 24px, which is where 90% of the app's
 * numbers live. Pass `segmented` to opt a genuine hero figure back in.
 * Still one text node, so screen readers announce it cleanly.
 */
export default function DigitalNumber({ value, tone = "default", size = "xl", segmented = false, className }) {
  return (
    <span
      className={cn(
        "font-bold tabular-nums leading-none tracking-tight",
        segmented && "digital",
        TONES[tone] || TONES.default,
        SIZES[size] || SIZES.xl,
        className
      )}
    >
      {value}
    </span>
  );
}
