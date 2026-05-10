export const tokens = {
  color: {
    bg: "#0b0f1a",
    bg2: "#111827",
    bg3: "#141d2e",
    bg4: "#1a2540",
    bg5: "#202c42",
    border: "#1e2d44",
    border2: "#243552",
    teal: "#00c4a3",
    teal2: "#00e0ba",
    text: "#dde4f0",
    text2: "#8a9ab8",
    text3: "#4d607e",
    red: "#ef4444",
    amber: "#f59e0b",
    blue: "#3b82f6",
    purple: "#8b5cf6",
    green: "#10b981",
    orange: "#f97316"
  },
  font: {
    sans: ["DM Sans", "sans-serif"],
    mono: ["JetBrains Mono", "monospace"]
  },
  radius: {
    sm: "6px",
    md: "8px",
    lg: "10px",
    pill: "999px"
  },
  shadow: {
    panel: "0 18px 50px rgba(0, 0, 0, 0.28)"
  },
  layout: {
    iconRail: "52px",
    sidebar: "210px",
    topbar: "48px"
  }
} as const;

export type DesignTokens = typeof tokens;
