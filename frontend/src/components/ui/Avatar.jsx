import { cn, initials } from "@/lib/utils";

const sizes = {
  xs: "w-6 h-6 text-micro rounded-lg",
  sm: "w-8 h-8 text-2xs rounded-lg",
  md: "w-10 h-10 text-xs rounded-xl",
  lg: "w-14 h-14 text-base rounded-2xl",
  xl: "w-20 h-20 text-2xl rounded-3xl",
  "2xl": "w-24 h-24 text-3xl rounded-3xl",
};

// Deterministic palette: the same business always gets the same colour, which
// makes avatars function as recognisable identity across every surface.
const palette = [
  "bg-brand-600",
  "bg-blue-600",
  "bg-accent-600",
  "bg-purple-600",
  "bg-rose-600",
  "bg-teal-600",
  "bg-indigo-600",
  "bg-orange-600",
];

const hue = (s = "") => palette[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];

export default function Avatar({ name = "", size = "md", ring, className, online, src }) {
  return (
    <div className={cn("relative shrink-0", className)}>
      {src ? (
        <img
          src={src}
          alt=""
          className={cn("object-cover", sizes[size] || sizes.md, ring && "ring-2 ring-brand-500 ring-offset-2 ring-offset-surface-0")}
        />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center font-bold text-white select-none",
            sizes[size] || sizes.md,
            hue(name),
            ring && "ring-2 ring-brand-500 ring-offset-2 ring-offset-surface-0"
          )}
          aria-hidden="true"
        >
          {initials(name)}
        </div>
      )}
      {online && (
        <span
          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-brand-500 ring-2 ring-surface-0"
          aria-label="Active"
        />
      )}
    </div>
  );
}
