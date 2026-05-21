import type { ReactNode, TdHTMLAttributes } from "react";

type TableProps = {
  headers: string[];
  children: ReactNode;
};

export function Table({ headers, children }: TableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-cortai-border">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                className="border-b border-cortai-border px-3 py-2 text-left text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-xs text-cortai-text">{children}</tbody>
      </table>
    </div>
  );
}

type TdProps = TdHTMLAttributes<HTMLTableCellElement> & {
  children: ReactNode;
};

export function Td({ children, className = "", ...props }: TdProps) {
  return (
    <td
      className={`border-b border-cortai-border/50 px-3 py-2.5 align-middle ${className}`}
      {...props}
    >
      {children}
    </td>
  );
}
