"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";

export type TabItem = {
  id: string;
  label: string;
  content: ReactNode;
  "data-testid"?: string;
};

type TabsProps = {
  items: TabItem[];
  defaultId?: string;
  onChange?: (id: string) => void;
  "data-testid"?: string;
};

export function Tabs({ items, defaultId, onChange, "data-testid": testId }: TabsProps) {
  const initial = useMemo(() => {
    if (defaultId && items.some((i) => i.id === defaultId)) return defaultId;
    return items[0]?.id ?? "";
  }, [defaultId, items]);
  const [active, setActive] = useState(initial);

  const activeItem = items.find((i) => i.id === active) ?? items[0] ?? null;

  return (
    <div data-testid={testId} className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {items.map((it) => {
          const isActive = it.id === active;
          return (
            <button
              key={it.id}
              type="button"
              data-testid={it["data-testid"]}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? "border-cortai-teal/25 bg-cortai-teal/10 text-cortai-teal"
                  : "border-cortai-border bg-cortai-bg2 text-cortai-text2 hover:border-cortai-teal/25 hover:bg-cortai-teal/10 hover:text-cortai-teal"
              }`}
              onClick={() => {
                setActive(it.id);
                onChange?.(it.id);
              }}
            >
              {it.label}
            </button>
          );
        })}
      </div>

      <div className="min-w-0">{activeItem ? activeItem.content : null}</div>
    </div>
  );
}

