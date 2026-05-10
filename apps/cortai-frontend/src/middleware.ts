import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { defaultLocale, locales } from "./i18n";

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: "always"
});

export default function middleware(request: NextRequest) {
  const isDashboard = /^\/(en|fr)\/dashboard/.test(request.nextUrl.pathname);
  if (isDashboard && !request.cookies.get("cortai_access_token")) {
    const candidateLocale = request.nextUrl.pathname.split("/")[1];
    const locale = locales.includes(candidateLocale as (typeof locales)[number])
      ? candidateLocale
      : defaultLocale;
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
  }
  return intlMiddleware(request);
}

export const config = {
  matcher: ["/", "/(en|fr)/:path*"]
};
