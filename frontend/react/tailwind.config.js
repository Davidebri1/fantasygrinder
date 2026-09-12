/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Inspired by the Flutter app's slate-blue palette
        brand: {
          DEFAULT: "#2c5282",
          50: "#e6f0fa",
          100: "#c9deef",
          500: "#2c5282",
          600: "#26537f",
          700: "#1f4470",
          900: "#0e2c47",
        },
        ink: {
          DEFAULT: "#1a202c",
          muted: "#4a5568",
          subtle: "#718096",
        },
        accent: {
          DEFAULT: "#38a169",
          warning: "#dd6b20",
          danger: "#e53e3e",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "Menlo", "Monaco", "monospace"],
      },
      boxShadow: {
        soft: "0 2px 4px rgba(0, 0, 0, 0.06)",
      },
    },
  },
  plugins: [],
};
