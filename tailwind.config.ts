import type { Config } from "tailwindcss";

/**
 * Design system ispirato a Vercel/Geist:
 *  - superfici near-white + testo ink (#171717); dark = polarity flip near-black
 *  - accento singolo link-blue (#0070f3); nessun sesto accento
 *  - decorazione = mesh gradient (cyan/blue/violet/pink/amber) solo a scala hero
 *  - font Geist Sans (narrativa) + Geist Mono (label tecniche)
 * I colori-superficie/testo sono CSS variables (globals.css) -> tema automatico.
 */
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        body: "var(--body)",
        mute: "var(--mute)",
        hairline: "var(--hairline)",
        "hairline-strong": "var(--hairline-strong)",
        canvas: "var(--canvas)",
        "canvas-soft": "var(--canvas-soft)",
        "canvas-soft-2": "var(--canvas-soft-2)",
        link: "#0070f3",
        "link-deep": "#0761d1",
        "link-soft": "#d3e5ff",
        // stop del mesh gradient (fissi, indipendenti dal tema)
        "g-blue": "#007cf0",
        "g-teal": "#00dfd8",
        "g-cyan": "#50e3c2",
        "g-violet": "#7928ca",
        "g-pink": "#ff0080",
        "g-coral": "#ff4d4d",
        "g-amber": "#f9cb28",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        "display-xl": "-0.05em",
        "display-lg": "-0.04em",
        "display-md": "-0.03em",
        "display-sm": "-0.02em",
      },
      borderRadius: {
        ds: "8px",
        "ds-lg": "12px",
      },
      boxShadow: {
        ds: "0 1px 2px rgba(0,0,0,0.03), 0 4px 12px -6px rgba(0,0,0,0.08)",
        "ds-lg":
          "0 2px 4px rgba(0,0,0,0.03), 0 12px 32px -12px rgba(0,0,0,0.14)",
        focus: "0 0 0 4px rgba(0,112,243,0.14)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "mesh-drift": {
          "0%,100%": { transform: "translate(0,0) scale(1)" },
          "33%": { transform: "translate(3%,-4%) scale(1.08)" },
          "66%": { transform: "translate(-3%,3%) scale(0.96)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.4s infinite",
        "mesh-drift": "mesh-drift 18s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
