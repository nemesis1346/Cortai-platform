import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { logger } from "@/lib/logger";

export const metadata: Metadata = {
  title: "COrtai",
  description: "Unified hotel operations platform"
};

export default async function LocaleLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const messages = await getMessages();
  logger.debug("render_locale_layout");
  return (
    <NextIntlClientProvider messages={messages}>
      <AuthProvider>{children}</AuthProvider>
    </NextIntlClientProvider>
  );
}
