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
        // v2.7 look: dark mode, but lighter and airier (was #09090b)
        surface: { 0: "#101216", 1: "#16191f", 2: "#1c2027", 3: "#242933", 4: "#2d3340" },
        // v2.7: lines are killed. Every legacy border-edge-* class resolves to
        // nothing — separation now comes from glass surfaces, depth and glow.
        // (widths stay, so no layout shifts where borders used to carry spacing)
        edge: { 1: "transparent", 2: "transparent", 3: "transparent" },
        ink: { 1: "#f7f8fa", 2: "#d6d9df", 3: "#a7adba", 4: "#767d8c" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        // Digital readouts — seven-segment style (timer look)
        digital: ['"DSEG7 Classic"', "Orbitron", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: { "2xs": ["0.625rem", { lineHeight: "0.875rem" }] },
      boxShadow: {
        glass: "0 8px 28px -10px rgba(0, 0, 0, 0.55), 0 1px 0 0 rgba(255,255,255,0.04) inset",
        "glass-lg": "0 20px 50px -12px rgba(0, 0, 0, 0.65), 0 1px 0 0 rgba(255,255,255,0.05) inset",
        lift: "0 12px 32px -12px rgba(0, 0, 0, 0.6)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.25s ease-out",
        "slide-right": "slideRight 0.2s ease-out",
        pulse_slow: "pulse 3s ease-in-out infinite",
        // "moving shelves": idle drift on shelf cards
        float: "float 7s ease-in-out infinite",
        "float-slow": "float 10s ease-in-out infinite",
        "dot-pulse": "dotPulse 1.8s ease-in-out infinite",
        "glow-breathe": "glowBreathe 4s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        slideRight: { "0%": { opacity: "0", transform: "translateX(-8px)" }, "100%": { opacity: "1", transform: "translateX(0)" } },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" },
        },
        dotPulse: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.55", transform: "scale(0.82)" },
        },
        glowBreathe: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
