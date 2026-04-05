import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        forge: {
          bg: "#0B0F14",
          panel: "#111827",
          elevated: "#0F172A",
          border: "#1F2937",
          primary: "#3B82F6",
          secondary: "#F59E0B",
          success: "#22C55E",
          danger: "#EF4444",
          text: "#E5E7EB",
          muted: "#94A3B8",
        },
      },
      boxShadow: {
        panel: "0 20px 45px rgba(0, 0, 0, 0.28)",
      },
    },
  },
  plugins: [],
};

export default config;
