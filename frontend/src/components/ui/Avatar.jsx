import { cn, initials } from "@/lib/utils";

const sizes = { xs: "w-6 h-6 text-2xs", sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-14 h-14 text-lg", xl: "w-20 h-20 text-2xl" };

const palette = [
  "from-brand-700 to-brand-500",
  "from-blue-700 to-blue-500",
  "from-amber-700 to-amber-500",
  "from-purple-700 to-purple-500",
  "from-rose-700 to-rose-500",
  "from-teal-700 to-teal-500",
];

const hue = (s = "") => palette[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];

export default function Avatar({ name = "", size = "md", ring, className, online }) {
  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "rounded-xl bg-gradient-to-br flex items-center justify-center font-semibold text-white select-none",
          sizes[size],
          hue(name),
          ring && "ring-2 ring-brand-500/60 ring-offset-2 ring-offset-surface-0"
        )}
        aria-hidden
      >
        {initials(name)}
      </div>
        {online && <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand-500 shadow-[0_0_0_2px_var(--tw-shadow-color,rgba(16,18,22,1)),0_0_8px_rgba(251, 191, 36,0.7)]" style={{ "--tw-shadow-color": "rgb(16 18 22)" }} />}
    </div>
  );
}
