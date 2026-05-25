"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ToastTone = "info" | "success" | "warning" | "error";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
  "data-testid"?: string;
};

type ToastItem = ToastInput & {
  id: string;
};

type ToastContextValue = {
  notify: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function toneClasses(tone: ToastTone) {
  if (tone === "success") return "border-cortai-green/25 bg-cortai-green/10 text-cortai-green";
  if (tone === "warning") return "border-cortai-amber/25 bg-cortai-amber/10 text-cortai-amber";
  if (tone === "error") return "border-cortai-red/25 bg-cortai-red/10 text-cortai-red";
  return "border-cortai-teal/25 bg-cortai-teal/10 text-cortai-teal";
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const notify = useCallback((input: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const toast: ToastItem = {
      id,
      tone: input.tone ?? "info",
      durationMs: input.durationMs ?? 3500,
      title: input.title,
      description: input.description,
      "data-testid": input["data-testid"]
    };

    setToasts((prev) => [toast, ...prev].slice(0, 5));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, toast.durationMs);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[60] grid w-[340px] max-w-[calc(100vw-32px)] gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid={t["data-testid"]}
            className={`pointer-events-auto rounded-lg border p-3 shadow-panel ${toneClasses(
              t.tone ?? "info"
            )}`}
          >
            <div className="text-xs font-semibold">{t.title}</div>
            {t.description ? <div className="mt-1 text-[11px] text-cortai-text2">{t.description}</div> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

