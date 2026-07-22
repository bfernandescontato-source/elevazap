import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        muted: "#666666",
        line: "#e5e5e5",
        panel: "#ffffff",
        wash: "#f7f7f7",
        accent: "#111111",
        coral: "#cc5b45",
        amber: "#ad7a19"
      },
      boxShadow: {
        soft: "0 12px 32px rgba(0, 0, 0, 0.06)"
      }
    }
  },
  plugins: []
};

export default config;
