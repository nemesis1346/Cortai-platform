"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { useAuth } from "@/components/auth/AuthProvider";
import { LocaleToggleLinks } from "@/components/i18n/LocaleToggleLinks";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { apiFetch, type AuthUser } from "@/lib/api";

const schema = z.object({
  org: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1)
});

type LoginResponse = {
  user: AuthUser;
};

export default function LoginPage() {
  const t = useTranslations("login");
  const navT = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const { setUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(formData: FormData) {
    setError(null);
    setLoading(true);
    const payload = schema.safeParse({
      org: formData.get("org_slug"),
      email: formData.get("email"),
      password: formData.get("password")
    });
    if (!payload.success) {
      setLoading(false);
      setError(t("invalid"));
      return;
    }
    try {
      const response = await apiFetch<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload.data)
      });
      setUser(response.user);
      router.push(`/${locale}/dashboard/admin/users`);
    } catch {
      setError(t("failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,_rgba(0,196,163,0.16),_transparent_35%),#0b0f1a] p-6">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-start gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cortai-teal">{t("brand")}</p>
            <h1 className="mt-2 text-2xl font-semibold">{t("title")}</h1>
            <p className="mt-1 text-sm text-cortai-text2">{t("subtitle")}</p>
          </div>
          <div className="ml-auto flex gap-2 text-xs text-cortai-text2">
            <LocaleToggleLinks
              items={[
                { locale: "en", label: navT("english") },
                { locale: "fr", label: navT("french") }
              ]}
            />
          </div>
        </div>
        <Card>
          <form action={onSubmit} className="grid gap-4">
            <Input name="org_slug" label={t("org")} autoComplete="organization" />
            <Input name="email" type="email" label={t("email")} autoComplete="email" />
            <Input
              name="password"
              type="password"
              label={t("password")}
              autoComplete="current-password"
            />
            {error ? <p className="text-xs text-cortai-red">{error}</p> : null}
            <Button type="submit" disabled={loading}>
              {loading ? t("loading") : t("submit")}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
