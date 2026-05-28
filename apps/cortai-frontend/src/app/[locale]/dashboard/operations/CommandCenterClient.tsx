"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";

type OperationsKpis = {
  occupancy_pct: number;
  arrivals_today: number;
  departures_today: number;
  revenue_today: number;
  open_incidents: number;
  hk_progress_pct: number;
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

function toWsUrl(apiBaseUrl: string) {
  const base = apiBaseUrl?.trim();
  if (!base) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/live`;
  }
  const u = new URL(base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/ws/live";
  u.search = "";
  return u.toString();
}

function fmtMoney(value: number) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
      value
    );
  } catch {
    return `$${Math.round(value).toLocaleString()}`;
  }
}

function KpiTile({
  label,
  value,
  sub
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-cortai-text3">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-cortai-text">{value}</div>
      {sub ? <div className="mt-1 text-xs text-cortai-text2">{sub}</div> : null}
    </div>
  );
}

export function CommandCenterClient() {
  const t = useTranslations("operations");
  const { user } = useAuth();
  const [kpis, setKpis] = useState<OperationsKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastRefreshRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  const propertyId = useMemo(() => getCookie("cortai_property_id") ?? "", []);
  const wsUrl = useMemo(() => toWsUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? ""), []);

  async function refresh() {
    setError(null);
    try {
      const data = await apiFetch<OperationsKpis>("/api/operations/kpis");
      setKpis(data);
      lastRefreshRef.current = Date.now();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Initial fetch
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WebSocket subscription: on any property-scoped event, refetch KPIs
  useEffect(() => {
    if (!user) return;
    if (!propertyId) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const interval = window.setInterval(() => {
      // Guarantee freshness within 5s even if an event was missed.
      const age = Date.now() - lastRefreshRef.current;
      if (age > 5000) void refresh();
    }, 1000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", scope: "property", property_id: propertyId }));
    };
    ws.onerror = () => {
      // Fall back to polling only.
    };
    ws.onmessage = () => {
      // Debounce-ish: avoid spamming refetch if events burst.
      const now = Date.now();
      if (now - lastRefreshRef.current < 1000) return;
      void refresh();
    };

    return () => {
      window.clearInterval(interval);
      ws.close();
      wsRef.current = null;
    };
    // propertyId is cookie-derived; it will change after full refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, wsUrl]);

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-xs text-cortai-text2">
          {t("selectPropertyToViewKpis")}
        </p>
      </div>
    );
  }

  const dash = t("kpis.dash");
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("autoRefreshNote")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-cortai-text2">
          <button
            type="button"
            className="rounded-md border border-cortai-border bg-cortai-bg px-2.5 py-1.5 text-xs text-cortai-text2 hover:border-cortai-teal/25 hover:bg-cortai-teal/10 hover:text-cortai-teal"
            onClick={() => void refresh()}
          >
            {t("refresh")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-cortai-red/25 bg-cortai-red/10 p-3 text-xs text-cortai-red">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiTile
          label={t("kpis.occupancy")}
          value={kpis ? `${kpis.occupancy_pct.toFixed(0)}%` : loading ? dash : dash}
          sub={t("kpis.today")}
        />
        <KpiTile
          label={t("kpis.arrivals")}
          value={kpis ? String(kpis.arrivals_today) : loading ? dash : dash}
          sub={t("kpis.today")}
        />
        <KpiTile
          label={t("kpis.departures")}
          value={kpis ? String(kpis.departures_today) : loading ? dash : dash}
          sub={t("kpis.today")}
        />
        <KpiTile
          label={t("kpis.revenue")}
          value={kpis ? fmtMoney(kpis.revenue_today) : loading ? dash : dash}
          sub={t("kpis.today")}
        />
        <KpiTile
          label={t("kpis.openIncidents")}
          value={kpis ? String(kpis.open_incidents) : loading ? dash : dash}
          sub={t("kpis.operations")}
        />
        <KpiTile
          label={t("kpis.housekeeping")}
          value={kpis ? `${kpis.hk_progress_pct.toFixed(0)}%` : loading ? dash : dash}
          sub={t("kpis.progress")}
        />
      </div>
    </div>
  );
}

