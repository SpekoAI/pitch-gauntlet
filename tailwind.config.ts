import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        stage: "var(--stage)",
        "stage-deep": "var(--stage-deep)",
        parchment: "var(--parchment)",
        "parchment-dim": "var(--parchment-dim)",
        spotlight: "var(--spotlight)",
        interrupt: "var(--interrupt)",
        "interrupt-bright": "var(--interrupt-bright)",
        rulec: "var(--rule)",
        card: "var(--card)",
      },
      fontFamily: {
        display: ["var(--font-anton)", "sans-serif"],
        body: ["var(--font-instrument)", "sans-serif"],
      },
      transitionTimingFunction: {
        "out-quint": "cubic-bezier(0.23, 1, 0.32, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
