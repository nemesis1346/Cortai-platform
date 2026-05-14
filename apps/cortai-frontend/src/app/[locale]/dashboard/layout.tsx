import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { LocaleToggleLinks } from "@/components/i18n/LocaleToggleLinks";

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
      <aside className="flex w-[52px] min-w-[52px] flex-col items-center gap-1 border-r border-cortai-border bg-[#0d1220] py-3">
        <div className="mb-3 grid h-9 w-9 place-items-center rounded-md bg-cortai-teal font-bold text-[#071a14]">
          {t("brandInitial")}
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-md border border-cortai-teal/25 bg-cortai-teal/10 text-cortai-teal">
          {t("hotelInitial")}
        </div>
      </aside>
      <aside className="flex w-[210px] min-w-[210px] flex-col border-r border-cortai-border bg-cortai-bg2">
        <div className="border-b border-cortai-border px-3.5 py-3">
          <div className="text-[13px] font-bold tracking-[0.05em] text-cortai-teal">{t("brand")}</div>
          <div className="text-[10px] text-cortai-text3">{t("hotelOps")}</div>
        </div>
        <nav className="flex-1 p-2">
          <div className="px-2 pb-2 pt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-cortai-text3">
            {t("admin")}
          </div>
          <Link
            className="flex rounded-md border border-cortai-teal/25 bg-cortai-teal/10 px-2.5 py-2 text-xs text-cortai-teal"
            href={`/${params.locale}/dashboard/admin/users`}
          >
            {t("users")}
          </Link>
        </nav>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[48px] items-center gap-3 border-b border-cortai-border bg-cortai-bg2 px-4">
          <h1 className="text-base font-semibold">{t("title")}</h1>
          <span className="rounded-pill border border-cortai-teal/25 bg-cortai-teal/10 px-2.5 py-1 text-[10px] text-cortai-teal">
            {t("live")}
          </span>
          <div className="ml-auto flex items-center gap-2 text-xs text-cortai-text2">
            <LocaleToggleLinks
              items={[
                { locale: "en", label: t("english") },
                { locale: "fr", label: t("french") }
              ]}
            />
            <LogoutButton />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </section>
    </main>
  );
}
