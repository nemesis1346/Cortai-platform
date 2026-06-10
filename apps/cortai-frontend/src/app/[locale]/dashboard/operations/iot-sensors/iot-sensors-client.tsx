"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Drawer } from "@/components/ui/Drawer";
import { Input } from "@/components/ui/Input";
import { useRealtimeSocket } from "@/hooks/use-realtime-socket";

type SensorStatus = "online" | "stale" | "offline";
type SensorType = "temperature" | "motion" | "door" | "water_leak" | "occupancy" | "air_quality";

type SensorInventoryItem = {
  device_id: string;
  property_id: string;
  room: string | null;
  type: SensorType | string;
  unit: string | null;
  value: number | string | null;
  ts: string | null;
  status: SensorStatus | string;
  last_seen_at: string | null;
};

type ReadingPoint = {
  ts: string;
  type?: string;
  value: number;
  unit?: string;
};

type LiveMsg = {
  type?: string;
  device_id?: string;
  status?: string;
  last_seen_at?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
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

function statusTone(st: string): "green" | "amber" | "red" | "neutral" {
  if (st === "online") return "green";
  if (st === "stale") return "amber";
  if (st === "offline") return "red";
  return "neutral";
}

function fmtTs(value: string | null, dash: string) {
  if (!value) return dash;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function Sparkline({ points }: { points: ReadingPoint[] }) {
  const width = 440;
  const height = 96;
  const pad = 8;
  const ys = points.map((p) => p.value);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;

  const d = points
    .map((p, idx) => {
      const x = pad + (idx / Math.max(1, points.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (p.value - min) / span) * (height - pad * 2);
      return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="rounded-md border border-cortai-border bg-cortai-bg2">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" className="text-cortai-teal" />
    </svg>
  );
}

export function IotSensorsClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.iotSensors");
  const tc = useTranslations("operations.common");

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SensorInventoryItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<SensorType | "">("");
  const [search, setSearch] = useState("");

  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);
  const [history, setHistory] = useState<ReadingPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const openSensor = useMemo(
    () => (openDeviceId ? items.find((s) => s.device_id === openDeviceId) ?? null : null),
    [items, openDeviceId]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((s) => {
      if (typeFilter && s.type !== typeFilter) return false;
      if (!q) return true;
      return (
        s.device_id.toLowerCase().includes(q) ||
        String(s.room ?? "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [items, search, typeFilter]);

  const loadInventory = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const pid = encodeURIComponent(propertyId);
      const resp = await apiFetch<SensorInventoryItem[]>(`/api/operations/iot/sensors?property_id=${pid}`);
      setItems(resp);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  const loadHistory = useCallback(async () => {
    if (!propertyId || !openDeviceId) return;
    setHistoryLoading(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
      const params = new URLSearchParams();
      params.set("property_id", propertyId);
      params.set("from", from.toISOString());
      params.set("to", to.toISOString());
      if (openSensor?.type) params.set("type", String(openSensor.type));
      const resp = await apiFetch<ReadingPoint[]>(
        `/api/operations/iot/sensors/${encodeURIComponent(openDeviceId)}/history?${params.toString()}`
      );
      const cleaned = resp
        .map((p) => ({ ...p, value: toNumber((p as unknown as { value: unknown }).value) ?? 0 }))
        .filter((p) => typeof p.ts === "string" && Number.isFinite(p.value));
      setHistory(cleaned);
    } finally {
      setHistoryLoading(false);
    }
  }, [openDeviceId, openSensor?.type, propertyId]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    if (openDeviceId) void loadHistory();
  }, [loadHistory, openDeviceId]);

  const onLive = useCallback(
    (raw: Record<string, unknown>) => {
      const msg = raw as LiveMsg;
      if (!msg.type) return;

      if (msg.type === "device.status" && typeof msg.device_id === "string") {
        setItems((prev) =>
          prev.map((s) =>
            s.device_id === msg.device_id
              ? { ...s, status: String(msg.status ?? s.status), last_seen_at: String(msg.last_seen_at ?? s.last_seen_at) }
              : s
          )
        );
        return;
      }

      if (msg.type === "sensor.reading") {
        const payload = (typeof msg.payload === "object" && msg.payload) ? (msg.payload as Record<string, unknown>) : (msg as unknown as Record<string, unknown>);
        const deviceId = typeof payload.device_id === "string" ? payload.device_id : typeof msg.device_id === "string" ? msg.device_id : null;
        if (!deviceId) return;
        setItems((prev) =>
          prev.map((s) =>
            s.device_id === deviceId
              ? {
                  ...s,
                  value: (payload.value as unknown as number) ?? s.value,
                  unit: (payload.unit as unknown as string) ?? s.unit,
                  ts: (payload.ts as unknown as string) ?? s.ts
                }
              : s
          )
        );
        if (openDeviceId === deviceId) void loadHistory();
      }
    },
    [loadHistory, openDeviceId]
  );

  const { status: socketStatus } = useRealtimeSocket({
    enabled: Boolean(propertyId),
    propertyId,
    onMessage: onLive,
    onReconnect: loadInventory
  });

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-xs text-cortai-text2">{t("selectProperty")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="iot-sensors-page">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={socketStatus === "connected" ? "green" : "amber"} data-testid="iot-sensors-ws-status">
            {t(`socket.${socketStatus}`)}
          </Badge>
          <Button type="button" variant="ghost" onClick={() => void loadInventory()} disabled={loading} data-testid="iot-sensors-refresh">
            {t("refresh")}
          </Button>
        </div>
      </div>

      <Card
        title={t("filters.title")}
        action={
          <div className="flex flex-wrap gap-2" data-testid="iot-sensors-filters">
            <label className="grid gap-1.5 text-xs text-cortai-text2">
              <span className="font-medium">{t("filters.type")}</span>
              <select
                className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm outline-none focus:border-cortai-teal"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as SensorType | "")}
                data-testid="iot-sensors-filter-type"
              >
                <option value="">{t("filters.allTypes")}</option>
                {["temperature", "motion", "door", "water_leak", "occupancy", "air_quality"].map((tt) => (
                  <option key={tt} value={tt}>
                    {tt}
                  </option>
                ))}
              </select>
            </label>
            <div className="min-w-[260px]">
              <Input
                label={t("filters.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("filters.searchPlaceholder")}
                data-testid="iot-sensors-search"
              />
            </div>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="iot-sensors-grid">
          {filtered.length === 0 ? <p className="text-xs text-cortai-text2">{t("empty")}</p> : null}
          {filtered.map((s) => (
            <button
              key={s.device_id}
              type="button"
              onClick={() => setOpenDeviceId(s.device_id)}
              className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4 text-left transition hover:bg-cortai-bg4"
              data-testid={`iot-sensors-card-${s.device_id}`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.device_id}</span>
                <Badge tone={statusTone(String(s.status))}>{String(s.status)}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-cortai-text2">
                {t("card.room")}: {s.room ?? tc("dash")}
              </p>
              <p className="mt-1 text-[11px] text-cortai-text2">
                {t("card.type")}: {String(s.type)}
              </p>
              <p className="mt-2 text-sm">
                {t("card.last")}:{" "}
                <span className="font-semibold">
                  {s.value ?? tc("dash")}
                  {s.unit ? ` ${s.unit}` : ""}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-cortai-text3">
                {t("card.updated")}: {fmtTs(s.ts, tc("dash"))}
              </p>
            </button>
          ))}
        </div>
      </Card>

      <Drawer
        open={Boolean(openSensor)}
        title={openSensor ? `${openSensor.device_id}` : t("drawer.title")}
        closeLabel={t("drawer.close")}
        onClose={() => setOpenDeviceId(null)}
        data-testid="iot-sensors-drawer"
      >
        {!openSensor ? null : (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone={statusTone(String(openSensor.status))} data-testid="iot-sensors-drawer-status">
                {String(openSensor.status)}
              </Badge>
              <Badge tone="neutral">{String(openSensor.type)}</Badge>
              <Badge tone="neutral">{openSensor.room ? `${t("card.room")}: ${openSensor.room}` : t("drawer.noRoom")}</Badge>
            </div>
            <p className="text-xs text-cortai-text2">
              {t("drawer.lastSeen")}: {fmtTs(openSensor.last_seen_at, tc("dash"))}
            </p>
            <div className="grid gap-2">
              <h3 className="text-[13px] font-semibold">{t("drawer.historyTitle")}</h3>
              {historyLoading ? <p className="text-xs text-cortai-text2">{t("drawer.loading")}</p> : null}
              {!historyLoading && history.length === 0 ? <p className="text-xs text-cortai-text2">{t("drawer.noData")}</p> : null}
              {!historyLoading && history.length > 0 ? <Sparkline points={history} /> : null}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

