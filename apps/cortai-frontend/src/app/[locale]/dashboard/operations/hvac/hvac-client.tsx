"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useRealtimeSocket } from "@/hooks/use-realtime-socket";

// ── Types ─────────────────────────────────────────────────────────────────────

type HvacRoomState = {
  room_id: string;
  current_temp_c: number | null;
  target_temp_c: number | null;
  mode: string | null;
  fan_speed: string | null;
  fault_code: string | null;
  last_updated: string | null;
};

type EdgeEvent = {
  device_id: string;
  type: string;
  severity: string;
  payload: Record<string, unknown>;
  ts: string;
};

type ControlResponse = { command_id: string; accepted_at: string; expected_ack_within_s: number };

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  return null;
}

function fmtTs(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fmtTemp(value: number | null) {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}°C`;
}

type ZoneCfg = { col: string; bg: string; border: string; label: string };

function roomCfg(room: HvacRoomState): ZoneCfg {
  if (room.fault_code)
    return { col: "#ef4444", bg: "rgba(239,68,68,.08)", border: "rgba(239,68,68,.3)",  label: "Fault" };
  if (room.mode === "off" || room.mode === "Off")
    return { col: "#4d7088", bg: "rgba(77,112,136,.06)", border: "rgba(77,112,136,.2)", label: "Off" };
  const cur = room.current_temp_c;
  const tgt = room.target_temp_c;
  if (cur !== null && tgt !== null) {
    const diff = cur - tgt;
    if (Math.abs(diff) > 3)
      return { col: "#ef4444", bg: "rgba(239,68,68,.07)", border: "rgba(239,68,68,.25)", label: "Critical" };
    if (Math.abs(diff) > 1.5)
      return { col: "#f59e0b", bg: "rgba(245,158,11,.07)", border: "rgba(245,158,11,.25)", label: "Warn" };
  }
  return { col: "#00c4a3", bg: "rgba(0,196,163,.07)", border: "rgba(0,196,163,.2)",  label: "Normal" };
}

function modeColor(mode: string | null): string {
  switch ((mode ?? "").toLowerCase()) {
    case "cooling": return "#3b82f6";
    case "heating": return "#f97316";
    case "fan only":
    case "fan_only": return "#8b5cf6";
    case "off":     return "#4d7088";
    default:        return "#00c4a3";
  }
}

// Demo AHU/Chiller systems — labeled as demo in the panel
const DEMO_SYSTEMS = [
  { id: "AHU-01", zone: "Floors 1–3",   status: "Running",  load: "98%", c: "#10b981" },
  { id: "AHU-02", zone: "Floors 4–6",   status: "Fault",    load: "—",   c: "#ef4444" },
  { id: "AHU-03", zone: "Floors 7–8",   status: "Running",  load: "72%", c: "#10b981" },
  { id: "AHU-04", zone: "Pool & Spa",   status: "Running",  load: "85%", c: "#00c4a3" },
  { id: "AHU-05", zone: "Event Salons", status: "Running",  load: "91%", c: "#f59e0b" },
  { id: "Chiller-01", zone: "Main Plant", status: "Running", load: "88%", c: "#10b981" },
  { id: "Chiller-02", zone: "Main Plant", status: "Standby", load: "—",  c: "#4d7088" },
  { id: "Boiler-01",  zone: "Mech Room",  status: "Running", load: "65%", c: "#10b981" },
] as const;

// Demo energy bars (24 hours, colour-coded by load)
const DEMO_ENERGY = [55,48,42,40,43,52,70,88,96,102,98,94,90,95,100,108,112,106,98,95,92,88,80,72] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export function HvacClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t  = useTranslations("operations.hvac");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [items,            setItems]            = useState<HvacRoomState[]>([]);
  const [alerts,           setAlerts]           = useState<EdgeEvent[]>([]);
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(null);
  const pendingRef = useRef(pendingCommandId);
  useEffect(() => { pendingRef.current = pendingCommandId; }, [pendingCommandId]);

  const faultItems = useMemo(() => items.filter((i) => Boolean(i.fault_code)), [items]);
  const faultCount = faultItems.length;

  const avgTemp = useMemo(() => {
    const temps = items.map((i) => i.current_temp_c).filter((v): v is number => v !== null);
    return temps.length === 0 ? null : temps.reduce((a, b) => a + b, 0) / temps.length;
  }, [items]);

  const alertsByRoom = useMemo(() => {
    const m = new Map<string, EdgeEvent[]>();
    for (const a of alerts) {
      const rid = String((a.payload as Record<string, unknown>)?.room_id ?? "");
      if (!rid) continue;
      m.set(rid, [...(m.get(rid) ?? []), a]);
    }
    return m;
  }, [alerts]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const [rooms, ev] = await Promise.all([
        apiFetch<HvacRoomState[]>(`/api/operations/hvac/rooms?property_id=${pid}`),
        apiFetch<EdgeEvent[]>(`/api/operations/hvac/alerts?property_id=${pid}`),
      ]);
      setItems(rooms);
      setAlerts(ev);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  // ── WebSocket subscription ─────────────────────────────────────────────────
  useRealtimeSocket({
    enabled: Boolean(propertyId),
    propertyId,
    onReconnect: () => { void load(); },
    onMessage: useCallback((msg) => {
      if (msg.type === "hvac.state" && msg.room_id) {
        setItems((prev) =>
          prev.map((r) =>
            r.room_id === msg.room_id
              ? {
                  ...r,
                  current_temp_c: (msg.current_temp_c as number | null) ?? r.current_temp_c,
                  target_temp_c:  (msg.target_temp_c  as number | null) ?? r.target_temp_c,
                  mode:           (msg.mode      as string | null) ?? r.mode,
                  fan_speed:      (msg.fan_speed  as string | null) ?? r.fan_speed,
                  fault_code:     (msg.fault_code as string | null) ?? r.fault_code,
                  last_updated:   (msg.ts         as string | null) ?? r.last_updated,
                }
              : r
          )
        );
      }
      if (msg.type === "hvac.command.acked" && msg.command_id === pendingRef.current) {
        setPendingCommandId(null);
        if (msg.accepted) {
          notify({ title: t("toast.acked.title"), description: t("toast.acked.description"), tone: "success" });
        } else {
          notify({ title: t("toast.ackFailed.title"), description: String(msg.error ?? ""), tone: "error" });
        }
      }
    }, [notify, t]),
  });

  // ── Control modal ─────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [selected,  setSelected]  = useState<HvacRoomState | null>(null);
  const [targetTemp, setTargetTemp] = useState<string>("");
  const [mode,       setMode]       = useState<string>("auto");
  const [fanIndex,   setFanIndex]   = useState<number>(0);

  const fanSpeed = useMemo(() => {
    const options = ["auto", "low", "medium", "high"] as const;
    return options[Math.max(0, Math.min(options.length - 1, fanIndex))];
  }, [fanIndex]);

  function openControl(room: HvacRoomState) {
    setSelected(room);
    setTargetTemp(room.target_temp_c == null ? "" : String(room.target_temp_c));
    setMode(room.mode ?? "auto");
    const idx = room.fan_speed === "high" ? 3 : room.fan_speed === "medium" ? 2 : room.fan_speed === "low" ? 1 : 0;
    setFanIndex(idx);
    setModalOpen(true);
  }

  async function submitControl() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { mode, fan_speed: fanSpeed };
      const tt = Number.parseFloat(targetTemp);
      if (Number.isFinite(tt)) payload.target_temp_c = tt;

      const resp = await apiFetch<ControlResponse>(
        `/api/operations/hvac/rooms/${encodeURIComponent(selected.room_id)}/control`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      notify({ title: t("toast.sent.title"), description: t("toast.sent.description", { seconds: resp.expected_ack_within_s }), tone: "success" });
      setPendingCommandId(resp.command_id);
      setModalOpen(false);
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-xs text-cortai-text2">{t("selectProperty")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="hvac-page">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-cortai-text">{t("title")}</h1>
          <p className="text-[11px] text-cortai-text3">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full px-2.5 py-0.5 font-mono text-[9px] font-bold"
            style={{ background: faultCount > 0 ? "rgba(239,68,68,.12)" : "rgba(16,185,129,.12)", color: faultCount > 0 ? "#ef4444" : "#10b981" }}>
            {faultCount > 0 ? t("faults", { count: faultCount }) : t("noFaults")}
          </span>
          <Button type="button" variant="ghost" onClick={() => void load()} disabled={loading}>
            {t("refresh")}
          </Button>
        </div>
      </div>

      {/* ── Alert banner ─────────────────────────────────────────────────── */}
      {(faultCount > 0 || alerts.length > 0) ? (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3"
          style={{ background: "rgba(239,68,68,.07)", border: "1px solid rgba(239,68,68,.25)" }}>
          <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: "#ef4444", boxShadow: "0 0 6px #ef4444" }} />
          <div className="text-[12px]">
            <strong style={{ color: "#ef4444" }}>{faultCount > 0 ? `${faultCount} Active HVAC Fault${faultCount > 1 ? "s" : ""}` : `${alerts.length} Alert${alerts.length > 1 ? "s" : ""}`}</strong>
            {faultItems.length > 0 ? (
              <span className="ml-2 text-cortai-text2">
                {faultItems.slice(0, 3).map((r) => `Room ${r.room_id.slice(0, 8)} — ${r.fault_code}`).join(" · ")}
              </span>
            ) : alerts.length > 0 ? (
              <span className="ml-2 text-cortai-text2">
                {alerts.slice(0, 2).map((a) => String((a.payload as Record<string, unknown>)?.fault_code ?? a.type)).join(" · ")}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-cortai-red">{error}</div>
      ) : null}

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          {
            label: "Zones Online",
            v:      items.length > 0 ? `${items.length - faultCount} / ${items.length}` : "—",
            sub:   faultCount > 0 ? `${faultCount} offline / fault` : "all operational",
            c:     faultCount > 0 ? "#f59e0b" : "#10b981",
          },
          {
            label: "Abnormal Rooms",
            v:     faultCount || items.filter((i) => {
              const diff = (i.current_temp_c ?? 0) - (i.target_temp_c ?? 0);
              return Math.abs(diff) > 1.5;
            }).length || "—",
            sub:   "above / below setpoint",
            c:     faultCount > 0 ? "#ef4444" : "#f59e0b",
          },
          {
            label: "Avg Building Temp",
            v:     avgTemp !== null ? `${avgTemp.toFixed(1)}°C` : "—",
            sub:   items.length > 0 ? `across ${items.length} zones` : "no data",
            c:     "#00c4a3",
          },
          {
            label: "Active Alerts",
            v:     alerts.length || "—",
            sub:   alerts.length > 0 ? `${alerts.filter((a) => a.severity === "high").length} high severity` : "no active alerts",
            c:     alerts.length > 0 ? "#ef4444" : "#10b981",
          },
        ].map(({ label, v, sub, c }) => (
          <div key={label} className="rounded-xl border border-cortai-border px-4 py-3" style={{ background: "rgba(255,255,255,.02)" }}>
            <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">{label}</div>
            <div className="mt-1 font-mono text-[24px] font-bold leading-none" style={{ color: c }}>{v}</div>
            <div className="mt-1 text-[9px] text-cortai-text3">{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Main 2-col grid ──────────────────────────────────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 360px" }}>

        {/* ── LEFT: Zone/Room Grid ─────────────────────────────────────── */}
        <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
          <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            <span className="text-[13px] font-semibold text-cortai-text">{t("rooms")}</span>
            {items.length > 0 ? (
              <span className="rounded-full px-2 py-0.5 font-mono text-[9px]"
                style={{ background: "rgba(0,196,163,.12)", color: "#00c4a3" }}>{items.length} zones</span>
            ) : null}
            {/* Legend */}
            <div className="ml-auto flex items-center gap-3">
              {[
                { col: "#00c4a3", label: "Normal" },
                { col: "#f59e0b", label: "Warn" },
                { col: "#ef4444", label: "Fault" },
                { col: "#4d7088", label: "Off" },
              ].map(({ col, label }) => (
                <div key={label} className="flex items-center gap-1">
                  <div className="h-1.5 w-1.5 rounded-full" style={{ background: col }} />
                  <span className="text-[9px] text-cortai-text3">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-12 text-center text-[11px] text-cortai-text3">
              {loading ? t("loading") : t("empty")}
            </div>
          ) : (
            <div className="grid p-4 gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
              {items.map((room) => {
                const cfg        = roomCfg(room);
                const roomAlerts = alertsByRoom.get(room.room_id) ?? [];
                const diff       = room.current_temp_c !== null && room.target_temp_c !== null
                  ? room.current_temp_c - room.target_temp_c
                  : null;

                return (
                  <button
                    key={room.room_id}
                    type="button"
                    onClick={() => openControl(room)}
                    data-testid="hvac-room-card"
                    className="rounded-xl p-3 text-left transition hover:opacity-90"
                    style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
                  >
                    {/* Alert note */}
                    {(room.fault_code ?? roomAlerts.length > 0) ? (
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: "#ef4444", boxShadow: "0 0 4px #ef4444" }} />
                        <span className="text-[9px] font-semibold" style={{ color: "#ef4444" }}>
                          {room.fault_code ?? `${roomAlerts.length} alert${roomAlerts.length > 1 ? "s" : ""}`}
                        </span>
                      </div>
                    ) : null}

                    {/* Room ID */}
                    <div className="text-[12px] font-semibold text-cortai-text mb-1.5">
                      {room.room_id.slice(0, 12)}
                    </div>

                    {/* Temps */}
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span className="font-mono text-[20px] font-bold leading-none" style={{ color: cfg.col }}>
                        {fmtTemp(room.current_temp_c)}
                      </span>
                      {room.target_temp_c !== null ? (
                        <span className="text-[10px] text-cortai-text3">/ {fmtTemp(room.target_temp_c)} set</span>
                      ) : null}
                    </div>

                    {/* Deviation */}
                    {diff !== null && Math.abs(diff) > 0.5 ? (
                      <div className="text-[9px] font-mono mb-1.5" style={{ color: diff > 0 ? "#f59e0b" : "#3b82f6" }}>
                        {diff > 0 ? `↑${diff.toFixed(1)}°C above` : `↓${Math.abs(diff).toFixed(1)}°C below`}
                      </div>
                    ) : null}

                    {/* Mode + fan */}
                    <div className="flex items-center gap-1.5">
                      <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                        style={{ background: `${modeColor(room.mode)}22`, color: modeColor(room.mode) }}>
                        {(room.mode ?? "auto").toUpperCase()}
                      </span>
                      {room.fan_speed ? (
                        <span className="text-[9px] text-cortai-text3">fan {room.fan_speed}</span>
                      ) : null}
                      <span className="ml-auto text-[8px] text-cortai-text3">{fmtTs(room.last_updated)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── RIGHT column ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Abnormal Rooms (real) */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3"
              style={{ borderLeft: "3px solid #ef4444" }}>
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#ef4444" fill="none" strokeWidth="1.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              </svg>
              <span className="text-[13px] font-semibold" style={{ color: "#ef4444" }}>Abnormal Rooms</span>
              {faultCount > 0 ? (
                <span className="ml-auto rounded-full px-2 py-0.5 font-mono text-[9px]"
                  style={{ background: "rgba(239,68,68,.12)", color: "#ef4444" }}>{faultCount}</span>
              ) : null}
            </div>

            {faultItems.length === 0 && alerts.length === 0 ? (
              <div className="px-4 py-6 text-center text-[11px] text-cortai-text3">
                {t("alerts.empty")}
              </div>
            ) : (
              <div>
                {faultItems.map((room) => (
                  <div key={room.room_id} className="border-b border-cortai-border/30 p-4 last:border-0">
                    <div className="flex items-start gap-3 mb-2">
                      {/* Room badge */}
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                        style={{ background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.3)" }}>
                        <span className="font-mono text-[9px] font-bold leading-tight text-center" style={{ color: "#ef4444" }}>
                          Rm<br />{room.room_id.slice(0, 6)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold" style={{ color: "#ef4444" }}>{room.fault_code}</div>
                        <div className="text-[9px] text-cortai-text3">{fmtTs(room.last_updated)}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[18px] font-bold" style={{ color: "#ef4444" }}>{fmtTemp(room.current_temp_c)}</div>
                        <div className="text-[9px] text-cortai-text3">set {fmtTemp(room.target_temp_c)}</div>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => openControl(room)}
                        className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                        style={{ background: "rgba(239,68,68,.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,.2)" }}>
                        Control
                      </button>
                    </div>
                  </div>
                ))}

                {/* Alerts without matching fault rooms */}
                {alerts.filter((a) => {
                  const rid = String((a.payload as Record<string, unknown>)?.room_id ?? "");
                  return !faultItems.some((r) => r.room_id === rid);
                }).map((a) => {
                  const rid  = String((a.payload as Record<string, unknown>)?.room_id ?? "");
                  const code = String((a.payload as Record<string, unknown>)?.fault_code ?? a.type);
                  const sc   = a.severity === "high" ? "#ef4444" : a.severity === "medium" ? "#f59e0b" : "#94a3b8";
                  return (
                    <div key={`${a.device_id}-${a.ts}`} className="flex items-center gap-3 border-b border-cortai-border/30 px-4 py-2.5 last:border-0">
                      <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: sc }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-cortai-text">{rid ? t("alerts.room", { room: rid.slice(0, 8) }) : a.device_id.slice(0, 10)}</div>
                        <div className="text-[9px] text-cortai-text3">{t("alerts.fault", { code })}</div>
                      </div>
                      <span className="text-[9px] text-cortai-text3">{fmtTs(a.ts)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* HVAC Systems (demo) */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                <path d="M18 8h1a4 4 0 010 8h-1M6 8H5a4 4 0 000 8h1M2 12h4M18 12h4"/>
              </svg>
              <span className="text-[13px] font-semibold text-cortai-text">HVAC Systems</span>
              <span className="ml-auto text-[9px] text-cortai-text3">demo</span>
            </div>
            <div className="divide-y divide-cortai-border/30">
              {DEMO_SYSTEMS.map((sys) => (
                <div key={sys.id} className="flex items-center gap-2.5 px-4 py-2.5">
                  <div className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: sys.c, boxShadow: sys.status === "Fault" ? `0 0 5px ${sys.c}` : "none" }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] font-semibold text-cortai-text">{sys.id}</span>
                    <span className="text-[9px] text-cortai-text3 ml-1.5">· {sys.zone}</span>
                  </div>
                  <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                    style={{
                      background: sys.status === "Running" ? "rgba(16,185,129,.1)" : sys.status === "Fault" ? "rgba(239,68,68,.1)" : "rgba(77,112,136,.1)",
                      color:      sys.status === "Running" ? "#10b981" : sys.status === "Fault" ? "#ef4444" : "#4d7088",
                    }}>
                    {sys.status.toUpperCase()}
                  </span>
                  <span className="font-mono text-[10px] text-cortai-text2 min-w-[32px] text-right">{sys.load}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Energy 24h (demo) */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#f59e0b" fill="none" strokeWidth="1.5">
                <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              <span className="text-[13px] font-semibold text-cortai-text">HVAC Energy — 24h</span>
              <span className="ml-auto text-[9px] text-cortai-text3">demo</span>
            </div>
            <div className="px-4 pb-3 pt-3">
              {/* Bar chart */}
              <div className="flex items-end gap-[2px]" style={{ height: 56 }}>
                {DEMO_ENERGY.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm"
                    style={{
                      height: `${(h / 112) * 100}%`,
                      background: h > 100 ? "#ef4444" : h > 85 ? "#f59e0b" : "#00c4a3",
                      opacity: i >= 18 ? 1 : 0.55,
                    }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between">
                {["12am", "6am", "12pm", "Now"].map((l) => (
                  <span key={l} className="font-mono text-[9px] text-cortai-text3">{l}</span>
                ))}
              </div>
              {/* Summary chips */}
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { v: "1,840", label: "kWh Today",     c: "text-cortai-text" },
                  { v: "112 kW", label: "Current Peak", c: "text-red-400" },
                  { v: "−8%",    label: "vs Avg Day",   c: "text-green-400" },
                ].map(({ v, label, c }) => (
                  <div key={label} className="rounded-lg py-2 text-center"
                    style={{ background: "rgba(255,255,255,.04)" }}>
                    <div className={`font-mono text-[13px] font-bold ${c}`}>{v}</div>
                    <div className="text-[9px] text-cortai-text3">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Control Modal ─────────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        title={t("control.title", { room: selected?.room_id?.slice(0, 8) ?? "" })}
        closeLabel={t("control.close")}
        onClose={() => setModalOpen(false)}
      >
        {!selected ? null : (
          <div className="grid gap-3" data-testid="hvac-control-modal">
            {/* Current state */}
            <div className="overflow-hidden rounded-xl border border-cortai-border px-4 py-3" style={{ background: "rgba(255,255,255,.02)" }}>
              <div className="text-[11px] font-semibold text-cortai-text mb-2">{t("control.subtitle")}</div>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-cortai-text2">
                <div>{t("control.currentLine", { value: fmtTemp(selected.current_temp_c) })}</div>
                <div>Target: {fmtTemp(selected.target_temp_c)}</div>
                <div>Mode: {selected.mode ?? "—"}</div>
                <div>Fan: {selected.fan_speed ?? "—"}</div>
              </div>
              {selected.fault_code ? (
                <div className="mt-2 text-[10px] font-semibold" style={{ color: "#ef4444" }}>
                  ⚠ Fault: {selected.fault_code}
                </div>
              ) : null}
            </div>

            {/* Target temp */}
            <label className="grid gap-1.5 text-xs text-cortai-text2">
              <span className="font-medium">{t("control.targetTemp")}</span>
              <input
                type="number"
                step="0.5"
                value={targetTemp}
                onChange={(e) => setTargetTemp(e.target.value)}
                className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none focus:border-cortai-teal"
                placeholder={t("control.targetTempPlaceholder")}
              />
            </label>

            {/* Mode select */}
            <label className="grid gap-1.5 text-xs text-cortai-text2">
              <span className="font-medium">{t("control.mode")}</span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none focus:border-cortai-teal"
                style={{ colorScheme: "dark" }}
              >
                {(["auto", "cooling", "heating", "off"] as const).map((m) => (
                  <option key={m} value={m}>{t(`control.modes.${m}`)}</option>
                ))}
              </select>
            </label>

            {/* Fan speed slider */}
            <label className="grid gap-1.5 text-xs text-cortai-text2">
              <span className="flex items-center justify-between gap-2 font-medium">
                <span>{t("control.fanSpeed")}</span>
                <span className="font-mono text-[10px]" style={{ color: "#00c4a3" }}>{t(`control.fans.${fanSpeed}`)}</span>
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[9px] text-cortai-text3">Auto</span>
                <input
                  type="range" min={0} max={3} step={1} value={fanIndex}
                  onChange={(e) => setFanIndex(Number.parseInt(e.target.value, 10))}
                  className="flex-1 accent-cortai-teal"
                />
                <span className="text-[9px] text-cortai-text3">High</span>
              </div>
            </label>

            <div className="flex items-center gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setModalOpen(false)} disabled={loading}
                data-testid="hvac-control-cancel">{t("control.cancel")}</Button>
              <Button type="button" onClick={() => void submitControl()} disabled={loading}
                data-testid="hvac-control-send">{t("control.send")}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
