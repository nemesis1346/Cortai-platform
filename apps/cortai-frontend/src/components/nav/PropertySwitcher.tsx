"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";

type PropertyPublic = {
  id: string;
  name: string;
  slug: string;
};

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}

function setCookie(name: string, value: string) {
  // Keep it simple: session cookie, path=/.
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
}

export function PropertySwitcher() {
  const t = useTranslations("nav");
  const router = useRouter();
  const pathname = usePathname();
  const [properties, setProperties] = useState<PropertyPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    let active = true;
    apiFetch<PropertyPublic[]>("/api/properties")
      .then((items) => {
        if (!active) return;
        setProperties(items);
        const existing = getCookie("cortai_property_id");
        const fallback = items[0]?.id ?? "";
        const next = existing && items.some((p) => p.id === existing) ? existing : fallback;
        setSelectedId(next);
        if (next) setCookie("cortai_property_id", next);
      })
      .catch(() => {
        if (!active) return;
        setProperties([]);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = useMemo(() => properties.find((p) => p.id === selectedId) ?? null, [properties, selectedId]);

  if (loading) {
    return (
      <div className="rounded-md border border-cortai-border bg-cortai-bg px-2.5 py-1.5 text-xs text-cortai-text3">
        {t("propertyLoading")}
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="rounded-md border border-cortai-border bg-cortai-bg px-2.5 py-1.5 text-xs text-cortai-text3">
        {t("noProperties")}
      </div>
    );
  }

  return (
    <label className="flex items-center gap-2 text-xs text-cortai-text2">
      <span className="hidden sm:inline">{t("property")}</span>
      <select
        className="max-w-[220px] rounded-md border border-cortai-border bg-cortai-bg px-2.5 py-1.5 text-xs text-cortai-text outline-none focus:border-cortai-teal"
        value={selected?.id ?? ""}
        onChange={(e) => {
          const next = e.target.value;
          setSelectedId(next);
          setCookie("cortai_property_id", next);
          window.dispatchEvent(new CustomEvent("cortai:property-changed", { detail: { propertyId: next } }));
          // Soft refresh to let server components re-render (and to refetch any property-scoped data).
          router.refresh();
          // If already on a property-scoped page in the future, refreshing is enough.
          // Keep the current route stable.
          if (pathname) void pathname;
        }}
      >
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

