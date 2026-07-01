import type { ReactNode } from "react";

export type TabItem = {
  value: string;
  label: string;
  sub?: ReactNode;
  icon?: ReactNode;
  testId?: string;
};

type TabsProps = {
  value: string;
  onChange: (value: string) => void;
  tabs: TabItem[];
  rightSlot?: ReactNode;
  testId?: string;
};

export function Tabs({ value, onChange, tabs, rightSlot, testId }: TabsProps) {
  return (
    <div
      className="flex items-center overflow-x-auto rounded-xl border border-cortai-border"
      style={{ background: "#080f1d" }}
      {...(testId ? { "data-testid": testId } : {})}
    >
      {tabs.map((tab) => {
        const active = value === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            {...(tab.testId ? { "data-testid": tab.testId } : {})}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap px-5 py-3.5 text-[11px] font-semibold transition"
            style={{
              color: active ? "#00c4a3" : "#4d7088",
              borderBottom: active ? "2px solid #00c4a3" : "2px solid transparent",
              background: active ? "rgba(0,196,163,.05)" : "transparent",
            }}
          >
            {tab.icon}
            {tab.label}
            {tab.sub != null && (
              <span
                className="rounded-full px-2 py-0.5 text-[9px]"
                style={{
                  background: active ? "rgba(0,196,163,.18)" : "rgba(255,255,255,.05)",
                  color: active ? "#00c4a3" : "#4d7088",
                }}
              >
                {tab.sub}
              </span>
            )}
          </button>
        );
      })}
      {rightSlot != null && (
        <div className="ml-auto flex items-center px-4">{rightSlot}</div>
      )}
    </div>
  );
}
