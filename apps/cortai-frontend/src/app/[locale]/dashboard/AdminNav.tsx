"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";

export function AdminNav({ locale }: { locale: string }) {
  const t = useTranslations("nav");
  const { user } = useAuth();
  const isAdmin = user?.role === "IT_ADMIN" || user?.role === "SERVICE_PROVIDER_ADMIN";

  if (!isAdmin) {
    return (
      <div className="rounded-md border border-cortai-border bg-cortai-bg px-2.5 py-2 text-xs text-cortai-text2">
        {t("adminRestricted")}
      </div>
    );
  }

  return (
    <>
      <Link
        className="flex rounded-md border border-cortai-teal/25 bg-cortai-teal/10 px-2.5 py-2 text-xs text-cortai-teal"
        href={`/${locale}/dashboard/admin/users`}
      >
        {t("users")}
      </Link>
      <Link
        className="mt-2 flex rounded-md border border-cortai-border bg-cortai-bg px-2.5 py-2 text-xs text-cortai-text2 hover:border-cortai-teal/25 hover:bg-cortai-teal/10 hover:text-cortai-teal"
        href={`/${locale}/dashboard/admin/devices`}
      >
        {t("devices")}
      </Link>
    </>
  );
}

