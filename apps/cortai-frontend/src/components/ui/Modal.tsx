"use client";

import type { ReactNode } from "react";
import { Button } from "./Button";

type ModalProps = {
  open: boolean;
  title: string;
  closeLabel: string;
  children: ReactNode;
  onClose: () => void;
};

export function Modal({ open, title, closeLabel, children, onClose }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <section className="w-full max-w-xl rounded-lg border border-cortai-border bg-cortai-bg3 shadow-panel">
        <header className="flex items-center border-b border-cortai-border px-4 py-3">
          <h2 className="flex-1 text-sm font-semibold">{title}</h2>
          <Button type="button" variant="ghost" onClick={onClose}>
            {closeLabel}
          </Button>
        </header>
        <div className="p-4">{children}</div>
      </section>
    </div>
  );
}
