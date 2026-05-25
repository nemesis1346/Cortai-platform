"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import type { UserRole } from "@/lib/api";

type NavItem = {
  id: string;
  label: string;
  href: (locale: string) => string;
  roles?: UserRole[];
};

type NavGroup = {
  id: string;
  label: string;
  icon: ReactNode;
  href: (locale: string) => string;
  roles?: UserRole[];
  items: NavItem[];
};

function hasAccess(role: UserRole | undefined, roles?: UserRole[]) {
  if (!roles || roles.length === 0) return true;
  if (!role) return false;
  return roles.includes(role);
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconStar() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function IconBroom() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 21l7-7" />
      <path d="M14 3l7 7" />
      <path d="M7 14l3 3" />
      <path d="M14 3l-4 4" />
      <path d="M10 7l7 7" />
    </svg>
  );
}

function IconMessage() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function IconBriefcase() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
      <path d="M2 12h20" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function IconCoin() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v20" />
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 transition ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="9,18 15,12 9,6" />
    </svg>
  );
}

export function Sidebar({ locale }: { locale: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { user } = useAuth();

  const groups = useMemo<NavGroup[]>(() => {
    const adminRoles: UserRole[] = ["IT_ADMIN", "SERVICE_PROVIDER_ADMIN"];
    const managerRoles: UserRole[] = ["IT_ADMIN", "SERVICE_PROVIDER_ADMIN", "HOTEL_ADMIN"];

    return [
      {
        id: "operations",
        label: t("operations"),
        icon: <IconGrid />,
        href: (l) => `/${l}/dashboard/operations`,
        items: [
          { id: "live", label: t("live"), href: (l) => `/${l}/dashboard/live` },
          { id: "edgeLive", label: t("edgeLive"), href: (l) => `/${l}/dashboard/edge/live` },
          { id: "incidentLog", label: t("incidentLog"), href: (l) => `/${l}/dashboard/security/incidents` }
        ]
      },
      {
        id: "hotelVision",
        label: t("hotelVision"),
        icon: <IconStar />,
        href: (l) => `/${l}/dashboard/hotel-vision`,
        roles: managerRoles,
        items: [{ id: "overview", label: t("overview"), href: (l) => `/${l}/dashboard/hotel-vision` }]
      },
      {
        id: "housekeeping",
        label: t("housekeeping"),
        icon: <IconBroom />,
        href: (l) => `/${l}/dashboard/housekeeping`,
        items: [{ id: "overview", label: t("overview"), href: (l) => `/${l}/dashboard/housekeeping` }]
      },
      {
        id: "guestMessaging",
        label: t("guestMessaging"),
        icon: <IconMessage />,
        href: (l) => `/${l}/dashboard/guest-messaging`,
        items: [{ id: "overview", label: t("overview"), href: (l) => `/${l}/dashboard/guest-messaging` }]
      },
      {
        id: "sales",
        label: t("sales"),
        icon: <IconBriefcase />,
        href: (l) => `/${l}/dashboard/sales`,
        roles: managerRoles,
        items: [{ id: "overview", label: t("overview"), href: (l) => `/${l}/dashboard/sales` }]
      },
      {
        id: "hr",
        label: t("hr"),
        icon: <IconUsers />,
        href: (l) => `/${l}/dashboard/hr`,
        roles: managerRoles,
        items: [{ id: "overview", label: t("overview"), href: (l) => `/${l}/dashboard/hr` }]
      },
      {
        id: "revenue",
        label: t("revenue"),
        icon: <IconCoin />,
        href: (l) => `/${l}/dashboard/revenue`,
        roles: managerRoles,
        items: [{ id: "overview", label: t("overview"), href: (l) => `/${l}/dashboard/revenue` }]
      },
      {
        id: "admin",
        label: t("admin"),
        icon: <IconSettings />,
        href: (l) => `/${l}/dashboard/admin`,
        roles: adminRoles,
        items: [
          { id: "users", label: t("users"), href: (l) => `/${l}/dashboard/admin/users`, roles: adminRoles },
          { id: "properties", label: t("properties"), href: (l) => `/${l}/dashboard/admin/properties`, roles: adminRoles },
          { id: "devices", label: t("devices"), href: (l) => `/${l}/dashboard/admin/devices`, roles: adminRoles }
        ]
      }
    ];
  }, [t]);

  const visibleGroups = useMemo(() => {
    return groups
      .filter((g) => hasAccess(user?.role, g.roles))
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => hasAccess(user?.role, it.roles))
      }));
  }, [groups, user?.role]);

  const activeGroupId = useMemo(() => {
    for (const g of visibleGroups) {
      const baseHref = g.href(locale);
      if (isActivePath(pathname, baseHref)) return g.id;
      for (const it of g.items) {
        if (isActivePath(pathname, it.href(locale))) return g.id;
      }
    }
    return visibleGroups[0]?.id ?? "operations";
  }, [visibleGroups, locale, pathname]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const g of visibleGroups) initial[g.id] = g.id === activeGroupId;
    return initial;
  });

  // Ensure the currently active group stays expanded as you navigate.
  useEffect(() => {
    if (!activeGroupId) return;
    setOpenGroups((prev) => ({ ...prev, [activeGroupId]: true }));
  }, [activeGroupId]);

  const stripItems = visibleGroups.map((g) => {
    const href = g.href(locale);
    const active = g.id === activeGroupId || isActivePath(pathname, href);
    return { id: g.id, href, active, icon: g.icon, label: g.label };
  });

  return (
    <>
      <aside className="flex w-[52px] min-w-[52px] flex-col items-center gap-1 border-r border-cortai-border bg-[#0d1220] py-3">
        <div className="mb-3 grid h-9 w-9 place-items-center rounded-md bg-cortai-teal font-bold text-[#071a14]">
          {t("brandInitial")}
        </div>
        {stripItems.map((it) => (
          <Link
            key={it.id}
            href={it.href as unknown as Route}
            title={it.label}
            className={`grid h-9 w-9 place-items-center rounded-md border transition ${
              it.active
                ? "border-cortai-teal/40 bg-cortai-teal/10 text-cortai-teal"
                : "border-cortai-border bg-[#0b1020] text-cortai-text2 hover:border-cortai-teal/25 hover:bg-cortai-teal/10 hover:text-cortai-teal"
            }`}
          >
            {it.icon}
          </Link>
        ))}
      </aside>

      <aside className="flex w-[210px] min-w-[210px] flex-col border-r border-cortai-border bg-cortai-bg2">
        <div className="border-b border-cortai-border px-3.5 py-3">
          <div className="text-[13px] font-bold tracking-[0.05em] text-cortai-teal">{t("brand")}</div>
          <div className="text-[10px] text-cortai-text3">{t("hotelOps")}</div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {visibleGroups.map((g) => {
            const groupOpen = openGroups[g.id] ?? false;
            const active = g.id === activeGroupId;
            return (
              <div key={g.id} className="mb-2">
                <button
                  type="button"
                  onClick={() => setOpenGroups((prev) => ({ ...prev, [g.id]: !groupOpen }))}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] transition ${
                    active ? "text-cortai-text" : "text-cortai-text3 hover:text-cortai-text2"
                  }`}
                >
                  <span className="text-cortai-text2">{g.label}</span>
                  <span className="ml-auto text-cortai-text3">
                    <Chevron open={groupOpen} />
                  </span>
                </button>

                {groupOpen ? (
                  <div className="mt-1 grid gap-1">
                    {g.items.map((it) => {
                      const href = it.href(locale);
                      const itemActive = isActivePath(pathname, href);
                      return (
                        <Link
                          key={it.id}
                          href={href as unknown as Route}
                          className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs transition ${
                            itemActive
                              ? "border-cortai-teal/25 bg-cortai-teal/10 text-cortai-teal"
                              : "border-cortai-border bg-cortai-bg text-cortai-text2 hover:border-cortai-teal/25 hover:bg-cortai-teal/10 hover:text-cortai-teal"
                          }`}
                        >
                          <span className="text-cortai-text2">{g.icon}</span>
                          <span className="min-w-0 flex-1 truncate">{it.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

