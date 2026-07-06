import { getTranslations } from "next-intl/server";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { PasswordRotationBanner } from "@/components/auth/PasswordRotationBanner";
import { LocaleToggleLinks } from "@/components/i18n/LocaleToggleLinks";
import { PropertySwitcher } from "@/components/nav/PropertySwitcher";
import { Sidebar } from "@/components/nav/Sidebar";

export default async function DashboardLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const t = await getTranslations("nav");
  return (
    <main className="flex h-screen overflow-hidden bg-cortai-bg text-[13px]">
      <Sidebar locale={params.locale} />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[48px] items-center gap-3 border-b border-cortai-border bg-cortai-bg2 px-4">
          <h1 className="text-base font-semibold">{t("title")}</h1>
          <span className="rounded-pill border border-cortai-teal/25 bg-cortai-teal/10 px-2.5 py-1 text-[10px] text-cortai-teal">
            {t("live")}
          </span>
          <div className="ml-auto flex items-center gap-2 text-xs text-cortai-text2">
            <PropertySwitcher />
            <LocaleToggleLinks
              items={[
                { locale: "en", label: t("english") },
                { locale: "fr", label: t("french") }
              ]}
            />
            <LogoutButton />
          </div>
        </header>
        <PasswordRotationBanner locale={params.locale} />
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </section>
    </main>
  );
}
