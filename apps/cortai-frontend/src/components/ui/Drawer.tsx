"use client";

import type { ReactNode } from "react";
import { Button } from "./Button";

type DrawerProps = {
  open: boolean;
  title: string;
  closeLabel: string;
  children: ReactNode;
  onClose: () => void;
  "data-testid"?: string;
};

export function Drawer({ open, title, closeLabel, children, onClose, "data-testid": testId }: DrawerProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" data-testid={testId}>
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label={closeLabel}
        data-testid={testId ? `${testId}-backdrop` : undefined}
      />
      <section className="absolute right-0 top-0 flex h-full w-full max-w-[520px] flex-col border-l border-cortai-border bg-cortai-bg3 shadow-panel">
        <header className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
          <Button type="button" variant="ghost" onClick={onClose} data-testid={testId ? `${testId}-close` : undefined}>
            {closeLabel}
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </section>
    </div>
  );
}

