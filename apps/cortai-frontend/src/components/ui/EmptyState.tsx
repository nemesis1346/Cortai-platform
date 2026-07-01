import type { ReactNode } from "react";

type EmptyStateProps = {
  message: ReactNode;
  testId?: string;
  className?: string;
};

export function EmptyState({ message, testId, className = "px-4 py-8" }: EmptyStateProps) {
  return (
    <div
      className={`text-center text-[11px] text-cortai-text3 ${className}`}
      {...(testId ? { "data-testid": testId } : {})}
    >
      {message}
    </div>
  );
}