/** @type {import('tailwindcss').Config} */

// Every colour resolves to a CSS variable declared in src/styles/tokens.css, so
// one token file re-skins the entire product and `.dark` is a true peer theme
// rather than a pile of `dark:` overrides.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const scale = (prefix, steps) =>
  Object.fromEntries(steps.map((s) => [s, token(`${prefix}-${s}`)]));

const RAMP = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // The one action colour: trade green — go, confirm, source.
        brand: scale("brand", RAMP),
        // The heritage amber, kept for money, markets and stated prices.
        accent: scale("accent", RAMP),
        surface: { ...scale("surface", [0, 1, 2, 3, 4]), inverse: token("surface-inverse") },
        // v3: hairlines are back. Separation is a line *and* elevation, which
        // is what makes a light UI readable in daylight and in forced-colours.
        edge: scale("edge", [1, 2, 3]),
        ink: { ...scale("ink", [1, 2, 3, 4]), inverse: token("ink-inverse") },
      },
      fontFamily: {
        sans: ["Inter var", "Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
        // Opt-in seven-segment readout, now reserved for hero figures only.
        digital: ['"DSEG7 Classic"', "Orbitron", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        // The meta floor is 12px — the audience reads this in market daylight.
        // (Was 10px; 10px survives only as `text-micro` for uppercase tags.)
        micro: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.04em" }],
        "2xs": ["0.75rem", { lineHeight: "1.125rem" }],
        xs: ["0.8125rem", { lineHeight: "1.25rem" }],
        sm: ["0.875rem", { lineHeight: "1.375rem" }],
        base: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg: ["1.0625rem", { lineHeight: "1.625rem" }],
        xl: ["1.25rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.015em" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.02em" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.025em" }],
        "5xl": ["3rem", { lineHeight: "1.1", letterSpacing: "-0.03em" }],
      },
      borderRadius: { xl: "0.75rem", "2xl": "1rem", "3xl": "1.5rem", "4xl": "2rem" },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        // Legacy aliases — every existing `shadow-glass*`/`shadow-lift` usage
        // keeps working and simply resolves to the new elevation scale.
        glass: "var(--shadow-sm)",
        "glass-lg": "var(--shadow-lg)",
        lift: "var(--shadow-md)",
        focus: "0 0 0 3px rgb(var(--brand-500) / 0.28)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        spring: "var(--ease-spring)",
      },
      transitionDuration: { 1: "var(--dur-1)", 2: "var(--dur-2)", 3: "var(--dur-3)" },
      animation: {
        "fade-in": "fadeIn var(--dur-2) var(--ease-out) both",
        "slide-up": "slideUp var(--dur-3) var(--ease-out) both",
        "slide-down": "slideDown var(--dur-2) var(--ease-out) both",
        "slide-right": "slideRight var(--dur-2) var(--ease-out) both",
        "scale-in": "scaleIn var(--dur-2) var(--ease-spring) both",
        pulse_slow: "pulse 3s ease-in-out infinite",
        float: "float 7s ease-in-out infinite",
        "float-slow": "float 10s ease-in-out infinite",
        "dot-pulse": "dotPulse 1.8s ease-in-out infinite",
        "glow-breathe": "glowBreathe 4s ease-in-out infinite",
        shimmer: "shimmer 1.4s linear infinite",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: { "0%": { opacity: "0", transform: "translateY(10px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        slideDown: { "0%": { opacity: "0", transform: "translateY(-8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        slideRight: { "0%": { opacity: "0", transform: "translateX(-10px)" }, "100%": { opacity: "1", transform: "translateX(0)" } },
        scaleIn: { "0%": { opacity: "0", transform: "scale(0.96)" }, "100%": { opacity: "1", transform: "scale(1)" } },
        float: { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-5px)" } },
        dotPulse: { "0%, 100%": { opacity: "1", transform: "scale(1)" }, "50%": { opacity: "0.55", transform: "scale(0.82)" } },
        glowBreathe: { "0%, 100%": { opacity: "0.55" }, "50%": { opacity: "1" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
    },
  },
  plugins: [],
};
