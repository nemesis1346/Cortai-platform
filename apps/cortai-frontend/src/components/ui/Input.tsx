import { forwardRef, type InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, className = "", ...props },
  ref
) {
  return (
    <label className="grid gap-1.5 text-xs text-cortai-text2">
      <span className="font-medium">{label}</span>
      <input
        ref={ref}
        className={`rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none transition placeholder:text-cortai-text3 focus:border-cortai-teal ${className}`}
        {...props}
      />
      {error ? <span className="text-[11px] text-cortai-red">{error}</span> : null}
    </label>
  );
});
