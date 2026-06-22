import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211b",
        muted: "#6d766f",
        line: "#e5e9e4",
        panel: "#ffffff",
        wash: "#f6f8f5",
        accent: "#167a5a",
        coral: "#cc5b45",
        amber: "#ad7a19"
      },
      boxShadow: {
        soft: "0 16px 40px rgba(23, 33, 27, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
