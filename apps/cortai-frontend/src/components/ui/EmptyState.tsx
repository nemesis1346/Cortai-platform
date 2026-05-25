import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  "data-testid"?: string;
};

export function EmptyState({ title, description, action, icon, "data-testid": testId }: EmptyStateProps) {
  return (
    <section
      data-testid={testId}
      className="grid place-items-center rounded-lg border border-dashed border-cortai-border bg-cortai-bg2 p-6 text-center"
    >
      {icon ? <div className="mb-3 text-cortai-text2">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-cortai-text">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-xs text-cortai-text2">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}

