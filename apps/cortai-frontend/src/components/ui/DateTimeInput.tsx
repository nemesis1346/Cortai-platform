import { forwardRef, type InputHTMLAttributes } from "react";

type DateTimeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  error?: string;
};

export const DateTimeInput = forwardRef<HTMLInputElement, DateTimeInputProps>(
  function DateTimeInput({ label, error, className = "", style, ...props }, ref) {
    return (
      <label className="grid gap-1.5 text-xs text-cortai-text2">
        <span className="font-medium">{label}</span>
        <input
          ref={ref}
          type="datetime-local"
          className={`rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none transition placeholder:text-cortai-text3 focus:border-cortai-teal ${className}`}
          style={{ colorScheme: "dark", ...style }}
          {...props}
        />
        {error ? <span className="text-[11px] text-cortai-red">{error}</span> : null}
      </label>
    );
  },
);

/** Convert any ISO / datetime-local string to the "YYYY-MM-DDTHH:mm" format
 *  that <input type="datetime-local"> expects. Uses local time so the picker
 *  displays the hotel's wall-clock time without a UTC shift. */
export function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
