import type { ReactNode } from "react";

export type BadgeTone = "teal" | "green" | "amber" | "red" | "blue" | "neutral";

type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  "data-testid"?: string;
};

const styles: Record<BadgeTone, string> = {
  teal: "border-cortai-teal/25 bg-cortai-teal/10 text-cortai-teal",
  green: "border-cortai-green/25 bg-cortai-green/10 text-cortai-green",
  amber: "border-cortai-amber/25 bg-cortai-amber/10 text-cortai-amber",
  red: "border-cortai-red/25 bg-cortai-red/10 text-cortai-red",
  blue: "border-cortai-blue/25 bg-cortai-blue/10 text-cortai-blue",
  neutral: "border-cortai-border2 bg-cortai-bg4 text-cortai-text2"
};

export function Badge({ children, tone = "teal", "data-testid": testId }: BadgeProps) {
  return (
    <span
      data-testid={testId}
      className={`rounded-pill border px-2 py-0.5 text-[10px] font-semibold ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

