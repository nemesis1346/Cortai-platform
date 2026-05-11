"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "./AuthProvider";

export function LogoutButton() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const { setUser } = useAuth();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    try {
      await apiFetch<void>("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      router.push(`/${locale}/login`);
      router.refresh();
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant="ghost" onClick={() => void logout()} disabled={loading}>
      {loading ? t("loggingOut") : t("logout")}
    </Button>
  );
}
