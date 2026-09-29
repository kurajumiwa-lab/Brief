/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eefbf3", 100: "#d6f5e1", 200: "#b0eac8", 300: "#7cd9a8", 400: "#46c284",
          500: "#22a867", 600: "#158751", 700: "#116c43", 800: "#105637", 900: "#0e472e", 950: "#07281a",
        },
        surface: { 0: "#09090b", 1: "#111113", 2: "#18181b", 3: "#1f1f23", 4: "#27272a" },
        edge: { 1: "#27272a", 2: "#3f3f46", 3: "#52525b" },
        ink: { 1: "#fafafa", 2: "#d4d4d8", 3: "#a1a1aa", 4: "#71717a" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      fontSize: { "2xs": ["0.625rem", { lineHeight: "0.875rem" }] },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.25s ease-out",
        "slide-right": "slideRight 0.2s ease-out",
        pulse_slow: "pulse 3s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        slideRight: { "0%": { opacity: "0", transform: "translateX(-8px)" }, "100%": { opacity: "1", transform: "translateX(0)" } },
      },
    },
  },
  plugins: [],
};
