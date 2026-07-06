"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useAuth } from "./AuthProvider";

export function PasswordRotationBanner({ locale }: { locale: string }) {
  const { user } = useAuth();
  const t = useTranslations("passwordRotationBanner");

  if (!user?.password_rotation_due) return null;

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-300"
    >
      <svg
        className="h-4 w-4 shrink-0 text-amber-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
        />
      </svg>
      <span className="flex-1">{t("message")}</span>
      <Link
        href={`/${locale}/dashboard/admin/users`}
        className="shrink-0 rounded border border-amber-400/50 px-2.5 py-1 font-medium text-amber-300 hover:bg-amber-400/10"
      >
        {t("action")}
      </Link>
    </div>
  );
}