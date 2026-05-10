import type { Config } from "tailwindcss";
import { tokens } from "./src/design/tokens";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cortai: tokens.color,
        accent: {
          teal: tokens.color.teal,
          green: tokens.color.green,
          amber: tokens.color.amber,
          red: tokens.color.red
        }
      },
      fontFamily: {
        sans: [...tokens.font.sans],
        mono: [...tokens.font.mono]
      },
      borderRadius: tokens.radius,
      boxShadow: tokens.shadow
    }
  },
  plugins: []
};

export default config;
