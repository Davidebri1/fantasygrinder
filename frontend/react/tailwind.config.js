/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // The dark room the app sits in.
        canvas: "#07090E",
        "canvas-deep": "#04060A",
        // Glass, not paint. Each level is the same white at a different
        // opacity, so a card reads as a sheet of glass over the light.
        surface: {
          1: "rgba(255,255,255,0.045)",
          2: "rgba(255,255,255,0.026)",
          3: "rgba(255,255,255,0.075)",
          4: "rgba(255,255,255,0.085)",
        },
        inset: "rgba(0,0,0,0.24)",
        ink: {
          DEFAULT: "#eef2f8",
          muted: "#9ba7b9",
          subtle: "#6c7789",
          "on-dark": "#eef2f8",
          "on-dark-muted": "#9ba7b9",
        },
        line: {
          DEFAULT: "rgba(255,255,255,0.09)",
          strong: "rgba(255,255,255,0.18)",
        },
        // The chrome bar is glass too, so the light behind it still shows.
        chrome: {
          DEFAULT: "rgba(10,14,22,0.66)",
          deep: "rgba(5,8,13,0.86)",
        },
        // The one bright thing you can act with.
        action: {
          DEFAULT: "#ffffff",
          deep: "#e2e8f1",
          wash: "rgba(255,255,255,0.10)",
        },
        // The colour of a number the engine touched.
        brand: {
          DEFAULT: "#4c8dff",
          bright: "#8fb8ff",
          deep: "#2f6bd6",
          wash: "rgba(76,141,255,0.14)",
        },
        good: {
          DEFAULT: "#3ed598",
          wash: "rgba(62,213,152,0.14)",
        },
        warn: {
          DEFAULT: "#f5b942",
          wash: "rgba(245,185,66,0.14)",
        },
        // Over the cap, and errors.
        danger: {
          DEFAULT: "#ff6a4d",
          wash: "rgba(255,106,77,0.14)",
        },
        // The colour of the sport you are in. Set at runtime.
        sport: "var(--sport)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        // The old condensed voice was broadcast graphics. Inter Tight is a
        // working tool's display face.
        condensed: ["Inter Tight", "Inter", "system-ui", "sans-serif"],
        display: ["Inter Tight", "Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "Menlo", "Monaco", "monospace"],
      },
      borderRadius: {
        1: "10px",
        2: "16px",
        3: "22px",
        4: "30px",
      },
      boxShadow: {
        1: "0 1px 2px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)",
        2: "0 8px 24px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
        3: "0 18px 44px -18px rgba(0,0,0,0.72), inset 0 1px 0 rgba(255,255,255,0.07)",
        4: "0 32px 72px -24px rgba(0,0,0,0.82), inset 0 1px 0 rgba(255,255,255,0.08)",
        onPhoto:
          "0 1px 1px rgba(0,0,0,0.4), 0 8px 18px -6px rgba(0,0,0,0.55)",
        "on-photo-hi":
          "0 2px 3px rgba(0,0,0,0.45), 0 18px 36px -10px rgba(0,0,0,0.68)",
        action: "0 10px 30px -12px rgba(255,255,255,0.45)",
      },
      maxWidth: {
        shell: "1400px",
      },
    },
  },
  plugins: [],
};
