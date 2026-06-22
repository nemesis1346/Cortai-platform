"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { useRealtimeSocket } from "@/hooks/use-realtime-socket";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

type SensorStatus = "online" | "stale" | "offline";
type SensorType   = "temperature" | "motion" | "door" | "water_leak" | "occupancy" | "air_quality";

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

type ReadingPoint = { ts: string; type?: string; value: number; unit?: string };

type LiveMsg = {
  type?: string;
  device_id?: string;
  status?: string;
  last_seen_at?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

type LiveEvent = { id: string; event: string; loc: string; time: number; col: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  return null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) { const n = Number(v); if (Number.isFinite(n)) return n; }
  return null;
}

function fmtTs(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 10) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

type StatusCfg = { col: string; bg: string; border: string; label: string };

function statusCfg(st: string): StatusCfg {
  if (st === "online")  return { col: "#10b981", bg: "rgba(16,185,129,.08)",  border: "rgba(16,185,129,.2)",  label: "Online" };
  if (st === "stale")   return { col: "#f59e0b", bg: "rgba(245,158,11,.08)", border: "rgba(245,158,11,.2)", label: "Stale" };
  if (st === "offline") return { col: "#ef4444", bg: "rgba(239,68,68,.08)",  border: "rgba(239,68,68,.2)",  label: "Offline" };
  return                         { col: "#94a3b8", bg: "rgba(148,163,184,.06)", border: "rgba(148,163,184,.15)", label: st };
}

type TypeCfg = { icon: string; col: string };

function typeCfg(type: string): TypeCfg {
  switch (type) {
    case "temperature":  return { icon: "🌡", col: "#f97316" };
    case "motion":       return { icon: "👁", col: "#3b82f6" };
    case "door":         return { icon: "🚪", col: "#8b5cf6" };
    case "water_leak":   return { icon: "💧", col: "#0ea5e9" };
    case "occupancy":    return { icon: "👥", col: "#6366f1" };
    case "air_quality":  return { icon: "💨", col: "#00c4a3" };
    default:             return { icon: "📡", col: "#94a3b8" };
  }
}

// ── Demo data ─────────────────────────────────────────────────────────────────

const DEMO_ALERTS = [
  { title: "Water Leak Detected",  loc: "Room 318 — bathroom sensor",   sev: "Critical", c: "#ef4444", time: "2h ago" },
  { title: "Smoke Detector Fault", loc: "Corridor Floor 4 — SD-4-12",   sev: "Critical", c: "#ef4444", time: "3h ago" },
  { title: "Temperature Anomaly",  loc: "Room 512 — thermostat offline", sev: "High",     c: "#f59e0b", time: "25m ago" },
  { title: "Door Held Open >5min", loc: "Staff Storage B1-04",          sev: "Medium",   c: "#f59e0b", time: "14m ago" },
] as const;

const DEMO_INVENTORY = [
  { type: "Temperature / Thermostat", total: 88, online: 86, alert: 1, bat: 2, c: "#00c4a3" },
  { type: "Motion / Occupancy",       total: 48, online: 48, alert: 0, bat: 0, c: "#10b981" },
  { type: "Door / Window Contact",    total: 62, online: 61, alert: 1, bat: 3, c: "#00c4a3" },
  { type: "Water / Leak",             total: 24, online: 23, alert: 1, bat: 0, c: "#ef4444" },
  { type: "Smoke / CO₂",             total: 18, online: 17, alert: 1, bat: 1, c: "#f59e0b" },
  { type: "Air Quality (IAQ)",        total: 8,  online: 8,  alert: 0, bat: 0, c: "#10b981" },
] as const;

const DEMO_FLOORS = [
  { floor: 1, pct: 98, c: "#00c4a3", badge: "OK",     bc: "#00c4a3" },
  { floor: 2, pct: 98, c: "#00c4a3", badge: "OK",     bc: "#00c4a3" },
  { floor: 3, pct: 88, c: "#ef4444", badge: "1 alert", bc: "#ef4444" },
  { floor: 4, pct: 92, c: "#f59e0b", badge: "1 alert", bc: "#f59e0b" },
  { floor: 5, pct: 98, c: "#00c4a3", badge: "OK",     bc: "#00c4a3" },
  { floor: 6, pct: 98, c: "#00c4a3", badge: "OK",     bc: "#00c4a3" },
  { floor: 7, pct: 98, c: "#00c4a3", badge: "OK",     bc: "#00c4a3" },
  { floor: 8, pct: 98, c: "#00c4a3", badge: "OK",     bc: "#00c4a3" },
] as const;

const DEMO_EVENTS_SEED: LiveEvent[] = [
  { id: "d1", event: "Motion Detected",  loc: "Corridor F3-East",       time: Date.now() - 12000,  col: "#10b981" },
  { id: "d2", event: "Door Opened",      loc: "Room 512 entrance",       time: Date.now() - 60000,  col: "#3b82f6" },
  { id: "d3", event: "Temp Reading",     loc: "Room 714: 71°F (normal)", time: Date.now() - 120000, col: "#00c4a3" },
  { id: "d4", event: "Temp Reading",     loc: "Room 318: 76°F (high)",   time: Date.now() - 240000, col: "#ef4444" },
  { id: "d5", event: "IAQ Update",       loc: "Fitness: CO₂ 480ppm",    time: Date.now() - 360000, col: "#00c4a3" },
  { id: "d6", event: "Door Opened",      loc: "Loading Bay",              time: Date.now() - 300000, col: "#3b82f6" },
  { id: "d7", event: "Water Sensor OK",  loc: "Pool Plant Room",          time: Date.now() - 480000, col: "#10b981" },
  { id: "d8", event: "Motion Detected",  loc: "Lobby main",               time: Date.now() - 540000, col: "#10b981" },
];

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ points }: { points: ReadingPoint[] }) {
  return (
    <div className="h-32 rounded-lg border border-cortai-border"
      style={{ background: "rgba(255,255,255,.02)" }}
      data-testid="iot-sensors-sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points}>
          <XAxis dataKey="ts" hide />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip contentStyle={{ background: "#0c1524", border: "1px solid #1e2d44", fontSize: 11 }} />
          <Line type="monotone" dataKey="value" stroke="#00c4a3" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function IotSensorsClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.iotSensors");

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [loading,       setLoading]       = useState(false);
  const [items,         setItems]          = useState<SensorInventoryItem[]>([]);
  const [typeFilter,    setTypeFilter]     = useState<SensorType | "">("");
  const [search,        setSearch]         = useState("");
  const [liveEvents,    setLiveEvents]     = useState<LiveEvent[]>([]);

  const [openDeviceId,   setOpenDeviceId]   = useState<string | null>(null);
  const [history,        setHistory]        = useState<ReadingPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const openSensor = useMemo(
    () => (openDeviceId ? items.find((s) => s.device_id === openDeviceId) ?? null : null),
    [items, openDeviceId],
  );

  const alertItems   = useMemo(() => items.filter((s) => s.status !== "online"), [items]);
  const offlineItems = useMemo(() => items.filter((s) => s.status === "offline"), [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((s) => {
      if (typeFilter && s.type !== typeFilter) return false;
      if (!q) return true;
      return s.device_id.toLowerCase().includes(q) || String(s.room ?? "").toLowerCase().includes(q);
    });
  }, [items, search, typeFilter]);

  // ── API ────────────────────────────────────────────────────────────────────

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
      const to   = new Date();
      const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
      const params = new URLSearchParams();
      params.set("property_id", propertyId);
      params.set("from", from.toISOString());
      params.set("to", to.toISOString());
      if (openSensor?.type) params.set("type", String(openSensor.type));
      const resp = await apiFetch<ReadingPoint[]>(
        `/api/operations/iot/sensors/${encodeURIComponent(openDeviceId)}/history?${params.toString()}`,
      );
      const cleaned = resp
        .map((p) => ({ ...p, value: toNumber((p as unknown as { value: unknown }).value) ?? 0 }))
        .filter((p) => typeof p.ts === "string" && Number.isFinite(p.value));
      setHistory(cleaned);
    } finally {
      setHistoryLoading(false);
    }
  }, [openDeviceId, openSensor?.type, propertyId]);

  useEffect(() => { void loadInventory(); }, [loadInventory]);
  useEffect(() => { if (openDeviceId) void loadHistory(); }, [loadHistory, openDeviceId]);

  // ── Live WS ────────────────────────────────────────────────────────────────

  const onLive = useCallback((raw: Record<string, unknown>) => {
    const msg = raw as LiveMsg;
    if (!msg.type) return;

    if (msg.type === "device.status" && typeof msg.device_id === "string") {
      setItems((prev) =>
        prev.map((s) =>
          s.device_id === msg.device_id
            ? { ...s, status: String(msg.status ?? s.status), last_seen_at: String(msg.last_seen_at ?? s.last_seen_at) }
            : s,
        ),
      );
      return;
    }

    if (msg.type === "sensor.reading") {
      const payload  = (typeof msg.payload === "object" && msg.payload) ? (msg.payload as Record<string, unknown>) : (msg as unknown as Record<string, unknown>);
      const deviceId = typeof payload.device_id === "string" ? payload.device_id : typeof msg.device_id === "string" ? msg.device_id : null;
      if (!deviceId) return;

      setItems((prev) =>
        prev.map((s) =>
          s.device_id === deviceId
            ? { ...s, value: (payload.value as number) ?? s.value, unit: (payload.unit as string) ?? s.unit, ts: (payload.ts as string) ?? s.ts }
            : s,
        ),
      );
      if (openDeviceId === deviceId) void loadHistory();

      setItems((prev) => {
        const sensor = prev.find((s) => s.device_id === deviceId);
        const tc2    = typeCfg(String(sensor?.type ?? ""));
        const ev: LiveEvent = {
          id:    `${deviceId}-${Date.now()}`,
          event: `${String(sensor?.type ?? "Sensor").replace(/_/g, " ")} reading`,
          loc:   sensor?.room ? `Room ${sensor.room}` : deviceId.slice(0, 12),
          time:  Date.now(),
          col:   tc2.col,
        };
        setLiveEvents((evs) => [ev, ...evs].slice(0, 20));
        return prev;
      });
    }
  }, [loadHistory, openDeviceId]);

  const { status: socketStatus } = useRealtimeSocket({
    enabled:     Boolean(propertyId),
    propertyId,
    onMessage:   onLive,
    onReconnect: loadInventory,
  });

  const displayEvents = liveEvents.length > 0 ? liveEvents : DEMO_EVENTS_SEED;
  const eventsAreDemo = liveEvents.length === 0;

  // ── Early exit ─────────────────────────────────────────────────────────────

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

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-cortai-text">{t("title")}</h1>
          <p className="text-[11px] text-cortai-text3">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5"
            style={{
              background: socketStatus === "connected" ? "rgba(16,185,129,.12)" : "rgba(245,158,11,.12)",
              color:      socketStatus === "connected" ? "#10b981" : "#f59e0b",
            }}>
            <div className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
            <span className="font-mono text-[9px] font-bold">{t(`socket.${socketStatus}`)}</span>
          </div>
          <Button type="button" variant="ghost" onClick={() => void loadInventory()} disabled={loading}
            data-testid="iot-sensors-refresh">{t("refresh")}</Button>
        </div>
      </div>

      {/* ── Alert banner (real) ──────────────────────────────────────────────── */}
      {alertItems.length > 0 ? (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3"
          style={{ background: "rgba(239,68,68,.07)", border: "1px solid rgba(239,68,68,.25)" }}>
          <div className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: "#ef4444", boxShadow: "0 0 6px #ef4444" }} />
          <div className="text-[12px]">
            <strong style={{ color: "#ef4444" }}>{alertItems.length} sensor{alertItems.length > 1 ? "s" : ""} need attention</strong>
            <span className="ml-2 text-cortai-text2">
              {alertItems.slice(0, 3).map((s) => `${s.device_id.slice(0, 10)} (${s.status})`).join(" · ")}
            </span>
          </div>
        </div>
      ) : null}

      {/* ── KPI strip ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {([
          { label: "Total Sensors",  v: items.length || "—",        sub: items.length > 0 ? `${items.filter((s) => s.status === "online").length} online` : "loading…", c: "#00c4a3" },
          { label: "Alerts Active",  v: alertItems.length || "—",   sub: `${offlineItems.length} offline · rest stale`,                                               c: alertItems.length > 0 ? "#ef4444" : "#10b981" },
          { label: "Battery Low",    v: "7",                         sub: "need replacement · demo",                                                                    c: "#f59e0b" },
          { label: "Offline",        v: offlineItems.length || "—", sub: "not reporting >15m",                                                                         c: offlineItems.length > 0 ? "#ef4444" : "#10b981" },
        ] as const).map(({ label, v, sub, c }) => (
          <div key={label} className="rounded-xl border border-cortai-border px-4 py-3"
            style={{ background: "rgba(255,255,255,.02)" }}>
            <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">{label}</div>
            <div className="mt-1 font-mono text-[24px] font-bold leading-none" style={{ color: c }}>{v}</div>
            <div className="mt-1 text-[9px] text-cortai-text3">{sub}</div>
          </div>
        ))}
      </div>

      {/* ── 2-col: alerts + inventory | floor health + events ─────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 340px" }}>

        {/* LEFT */}
        <div className="flex flex-col gap-4">

          {/* Active Sensor Alerts */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3"
              style={{ borderLeft: "3px solid #ef4444" }}>
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#ef4444" fill="none" strokeWidth="1.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              </svg>
              <span className="text-[13px] font-semibold" style={{ color: "#ef4444" }}>Active Sensor Alerts</span>
              <div className="ml-auto flex items-center gap-2">
                {DEMO_ALERTS.length + alertItems.length > 0 ? (
                  <span className="rounded-full px-2 py-0.5 font-mono text-[9px]"
                    style={{ background: "rgba(239,68,68,.12)", color: "#ef4444" }}>
                    {DEMO_ALERTS.length + alertItems.length} active
                  </span>
                ) : null}
                <span className="text-[9px] text-cortai-text3">demo</span>
              </div>
            </div>

            {/* Real alerts */}
            {alertItems.map((s) => {
              const sc = statusCfg(s.status);
              return (
                <div key={s.device_id} className="flex items-center gap-3 border-b border-cortai-border/30 px-4 py-3">
                  <div className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: sc.col, boxShadow: `0 0 5px ${sc.col}` }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold" style={{ color: sc.col }}>{s.device_id.slice(0, 16)}</div>
                    <div className="text-[10px] text-cortai-text3">
                      {s.room ? `Room ${s.room}` : "—"} · {String(s.type).replace(/_/g, " ")}
                    </div>
                  </div>
                  <span className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold"
                    style={{ background: sc.bg, color: sc.col }}>{sc.label}</span>
                  <span className="font-mono text-[10px] text-cortai-text3">{fmtTs(s.last_seen_at)}</span>
                  <button type="button" onClick={() => setOpenDeviceId(s.device_id)}
                    className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                    style={{ background: "rgba(0,196,163,.1)", color: "#00c4a3", border: "1px solid rgba(0,196,163,.2)" }}>
                    View
                  </button>
                </div>
              );
            })}

            {/* Demo alerts */}
            {DEMO_ALERTS.map((a) => (
              <div key={a.title} className="flex items-center gap-3 border-b border-cortai-border/30 px-4 py-3 last:border-0">
                <div className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: a.c, boxShadow: `0 0 5px ${a.c}` }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold" style={{ color: a.c }}>{a.title}</div>
                  <div className="text-[10px] text-cortai-text3">{a.loc}</div>
                </div>
                <span className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold"
                  style={{ background: `${a.c}22`, color: a.c }}>{a.sev}</span>
                <span className="font-mono text-[10px] text-cortai-text3">{a.time}</span>
                <button type="button"
                  className="rounded px-2 py-0.5 text-[9px] font-semibold"
                  style={{ background: "rgba(148,163,184,.08)", color: "#94a3b8", border: "1px solid rgba(148,163,184,.15)" }}>
                  Ack
                </button>
              </div>
            ))}
          </div>

          {/* Sensor Inventory by Type */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <span className="text-[13px] font-semibold text-cortai-text">Sensor Inventory by Type</span>
              <span className="ml-auto text-[9px] text-cortai-text3">demo</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-cortai-border/50">
                    {["Sensor Type", "Total", "Online", "Alerting", "Low Bat"].map((h) => (
                      <th key={h} className="px-4 py-2 text-left font-bold uppercase tracking-wide text-cortai-text3 text-[9px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DEMO_INVENTORY.map((row) => (
                    <tr key={row.type} className="border-b border-cortai-border/20 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-cortai-text">{row.type}</td>
                      <td className="px-4 py-2.5 text-center font-mono text-cortai-text2">{row.total}</td>
                      <td className="px-4 py-2.5 text-center font-mono font-semibold" style={{ color: row.c }}>{row.online}</td>
                      <td className="px-4 py-2.5 text-center font-mono" style={{ color: row.alert > 0 ? "#ef4444" : "#4d7088" }}>{row.alert}</td>
                      <td className="px-4 py-2.5 text-center font-mono" style={{ color: row.bat > 0 ? "#f59e0b" : "#4d7088" }}>{row.bat}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT column */}
        <div className="flex flex-col gap-4">

          {/* Floor-by-Floor Sensor Health */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 9h18M3 15h18M9 3v18"/>
              </svg>
              <span className="text-[13px] font-semibold text-cortai-text">Floor-by-Floor Health</span>
              <span className="ml-auto text-[9px] text-cortai-text3">demo</span>
            </div>
            <div className="px-4 py-3 grid gap-2.5">
              {DEMO_FLOORS.map(({ floor, pct, c, badge, bc }) => (
                <div key={floor} className="flex items-center gap-2">
                  <span className="font-semibold text-[11px] text-cortai-text shrink-0" style={{ minWidth: 52 }}>
                    Floor {floor}
                  </span>
                  <div className="flex-1 rounded-full overflow-hidden"
                    style={{ height: 6, background: "rgba(255,255,255,.06)" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: c, borderRadius: 3 }} />
                  </div>
                  <span className="font-mono text-[10px] text-cortai-text2 shrink-0" style={{ minWidth: 32, textAlign: "right" }}>{pct}%</span>
                  <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold shrink-0"
                    style={{ background: `${bc}22`, color: bc }}>{badge}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Events */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <span className="text-[13px] font-semibold text-cortai-text">Recent Events</span>
              {eventsAreDemo ? (
                <span className="ml-auto text-[9px] text-cortai-text3">demo</span>
              ) : (
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 rounded-full"
                    style={{ background: "#00c4a3", boxShadow: "0 0 4px #00c4a3" }} />
                  <span className="text-[9px] font-bold" style={{ color: "#00c4a3" }}>LIVE</span>
                </div>
              )}
            </div>
            <div className="divide-y divide-cortai-border/20">
              {displayEvents.slice(0, 8).map((ev) => (
                <div key={ev.id} className="flex items-center gap-2.5 px-4 py-2.5">
                  <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ev.col }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-cortai-text">{ev.event}</div>
                    <div className="text-[10px] text-cortai-text3">{ev.loc}</div>
                  </div>
                  <span className="font-mono text-[9px] text-cortai-text3 shrink-0">{timeAgo(ev.time)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Sensor Grid (real, filterable) ───────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
        <div className="flex flex-wrap items-center gap-3 border-b border-cortai-border px-4 py-3">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
            <path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/>
            <circle cx="12" cy="12" r="1"/>
          </svg>
          <span className="text-[13px] font-semibold text-cortai-text">
            Sensor Inventory
            {items.length > 0 ? (
              <span className="ml-2 font-mono text-[9px] font-normal text-cortai-text3">
                {filtered.length}/{items.length}
              </span>
            ) : null}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as SensorType | "")}
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-2 py-1.5 text-[11px] text-cortai-text outline-none focus:border-cortai-teal"
              style={{ colorScheme: "dark" }}
              data-testid="iot-sensors-filter-type"
            >
              <option value="">{t("filters.allTypes")}</option>
              {(["temperature", "motion", "door", "water_leak", "occupancy", "air_quality"] as const).map((tt) => (
                <option key={tt} value={tt}>{t(`types.${tt}`)}</option>
              ))}
            </select>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("filters.searchPlaceholder")}
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-[11px] text-cortai-text outline-none placeholder:text-cortai-text3 focus:border-cortai-teal"
              style={{ minWidth: 180 }}
              data-testid="iot-sensors-search"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-[11px] text-cortai-text3">
            {loading ? "Loading sensors…" : t("empty")}
          </div>
        ) : (
          <div className="grid p-4 gap-2.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
            data-testid="iot-sensors-grid">
            {filtered.map((s) => {
              const sc  = statusCfg(String(s.status));
              const tc2 = typeCfg(String(s.type));
              return (
                <button
                  key={s.device_id}
                  type="button"
                  onClick={() => setOpenDeviceId(s.device_id)}
                  data-testid={`iot-sensors-card-${s.device_id}`}
                  className="rounded-xl p-3 text-left transition hover:opacity-90"
                  style={{ background: sc.bg, border: `1px solid ${sc.border}` }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[18px] leading-none">{tc2.icon}</span>
                    <span className="rounded-full px-1.5 py-0.5 font-mono text-[8px] font-bold"
                      style={{ background: `${sc.col}22`, color: sc.col }}>{sc.label}</span>
                  </div>
                  <div className="text-[11px] font-semibold text-cortai-text truncate">{s.device_id}</div>
                  <div className="mt-0.5 text-[9px] text-cortai-text3">
                    {s.room ? `Room ${s.room}` : "—"} · {t(`types.${s.type}`) || String(s.type)}
                  </div>
                  {s.value !== null ? (
                    <div className="mt-2 font-mono text-[18px] font-bold leading-none" style={{ color: tc2.col }}>
                      {s.value}
                      {s.unit ? <span className="ml-0.5 text-[10px] font-normal text-cortai-text3">{s.unit}</span> : null}
                    </div>
                  ) : null}
                  <div className="mt-1.5 text-[9px] text-cortai-text3">{fmtTs(s.ts)}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── History Drawer ────────────────────────────────────────────────────── */}
      <Drawer
        open={Boolean(openSensor)}
        title={openSensor ? openSensor.device_id : t("drawer.title")}
        closeLabel={t("drawer.close")}
        onClose={() => { setOpenDeviceId(null); setHistory([]); }}
        data-testid="iot-sensors-drawer"
      >
        {!openSensor ? null : (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              {[
                { v: statusCfg(String(openSensor.status)).label, c: statusCfg(String(openSensor.status)).col },
                { v: t(`types.${openSensor.type}`) || String(openSensor.type), c: typeCfg(String(openSensor.type)).col },
                { v: openSensor.room ? `Room ${openSensor.room}` : t("drawer.noRoom"), c: "#94a3b8" },
              ].map(({ v, c }) => (
                <span key={v} className="rounded-full px-2.5 py-0.5 text-[10px] font-medium"
                  style={{ background: `${c}22`, color: c }}>{v}</span>
              ))}
            </div>

            {openSensor.value !== null ? (
              <div className="rounded-xl border border-cortai-border px-4 py-3"
                style={{ background: "rgba(255,255,255,.02)" }}>
                <div className="text-[9px] font-bold uppercase tracking-wide text-cortai-text3">Current Reading</div>
                <div className="mt-1 font-mono text-[28px] font-bold leading-none"
                  style={{ color: typeCfg(String(openSensor.type)).col }}>
                  {openSensor.value}{openSensor.unit ? ` ${openSensor.unit}` : ""}
                </div>
                <div className="mt-1 text-[10px] text-cortai-text3">
                  {t("drawer.lastSeen")}: {fmtTs(openSensor.last_seen_at)}
                </div>
              </div>
            ) : null}

            <div>
              <div className="mb-2 text-[12px] font-semibold text-cortai-text">{t("drawer.historyTitle")}</div>
              {historyLoading ? (
                <div className="text-[11px] text-cortai-text3">{t("drawer.loading")}</div>
              ) : history.length === 0 ? (
                <div className="text-[11px] text-cortai-text3">{t("drawer.noData")}</div>
              ) : (
                <Sparkline points={history} />
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
