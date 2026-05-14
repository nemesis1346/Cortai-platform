"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type LocaleItem = {
  locale: string;
  label: string;
};

function swapLocalePrefix(pathname: string, nextLocale: string): string {
  if (!pathname.startsWith("/")) return `/${nextLocale}`;
  const segments = pathname.split("/");
  // segments[0] === "" because pathname starts with "/"
  if (segments.length >= 2 && segments[1]) {
    segments[1] = nextLocale;
    return segments.join("/") || `/${nextLocale}`;
  }
  return `/${nextLocale}`;
}

export function LocaleToggleLinks({ items }: { items: LocaleItem[] }) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  type Href = React.ComponentProps<typeof Link>["href"];

  return (
    <>
      {items.map((item) => {
        const path = swapLocalePrefix(pathname, item.locale);
        const href = query ? `${path}?${query}` : path;
        return (
          <Link key={item.locale} href={href as unknown as Href}>
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

