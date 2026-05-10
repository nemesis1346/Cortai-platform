import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
};

export function Card({ title, action, children }: CardProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-cortai-border bg-cortai-bg3">
      {title ? (
        <header className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
          <h2 className="flex-1 text-[13px] font-semibold text-cortai-text">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}
