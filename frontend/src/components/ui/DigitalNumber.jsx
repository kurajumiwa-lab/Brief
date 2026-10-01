import { cn } from "@/lib/utils";

const GLOWS = {
  default: "text-ink-1",
  brand: "text-brand-300 digital-glow",
  blue: "text-blue-300 digital-glow-blue",
  amber: "text-amber-300 digital-glow-amber",
  red: "text-red-300",
};

/**
 * Digital readout — the "timer look": seven-segment face with a soft glow.
 * Renders the value as ONE text node so a11y/announcements stay clean.
 */
export default function DigitalNumber({ value, tone = "default", size = "xl", className }) {
  const sizes = {
    sm: "text-lg",
    md: "text-2xl",
    xl: "text-3xl",
    "2xl": "text-4xl",
    "3xl": "text-5xl",
  };
  return (
    <span className={cn("digital tabular-nums leading-none", GLOWS[tone] || GLOWS.default, sizes[size] || sizes.xl, className)}>
      {value}
    </span>
  );
}
