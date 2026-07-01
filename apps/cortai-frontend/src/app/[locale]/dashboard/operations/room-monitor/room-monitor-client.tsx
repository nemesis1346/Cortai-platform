"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

type RoomStatus = "vacant_clean" | "vacant_dirty" | "occupied" | "inspected" | "out_of_order";
type DetailTab = "overview" | "equipment" | "history";

type RoomListItem = {
  id: string;
  property_id: string;
  room_number: string;
  floor: number | null;
  type: string | null;
  status: RoomStatus;
  last_service_at: string | null;
  vip: boolean;
};

type RoomList = { items: RoomListItem[] };

type RoomDetail = {
  room: RoomListItem;
  current_reservation: {
    id: string;
    status: string;
    check_in_at: string;
    check_out_at: string;
    rate_cents?: number | null;
    guest: { first_name: string; last_name: string; vip: boolean };
  } | null;
  recent_incidents: Array<{ id: string; severity: string; status: string; title: string; created_at: string }>;
};

type RoomIotData = {
  hvac?: {
    current_temp_c?: number | null;
    target_temp_c?: number | null;
    mode?: string | null;
    fan_speed?: string | null;
    fault_code?: string | null;
    model?: string | null;
    serial?: string | null;
    noise_db?: number | null;
    filter_life_pct?: number | null;
    install_date?: string | null;
    last_service?: string | null;
  } | null;
  sensors?: Array<{ device_id?: string; type?: string; value?: number; unit?: string; ts?: string }> | null;
  equipment?: {
    tv_model?: string | null;
    tv_status?: string | null;
    safe_status?: string | null;
    usb_charging?: string | null;
  } | null;
  furniture?: {
    bed_type?: string | null;
    bed_last_rotated?: string | null;
    pillows?: string | null;
    extra_bedding?: string | null;
    sofa_seating?: string | null;
  } | null;
  amenities?: {
    minibar_status?: string | null;
    coffee_maker?: string | null;
    coffee_pods_remaining?: number | null;
    bathroom_kit?: string | null;
    towels?: string | null;
    iron_board?: string | null;
  } | null;
};

type CleaningLogItem = {
  id: string;
  room_id: string;
  staff_name: string;
  clean_type: string;
  notes: string | null;
  score_pct: number | null;
  cleaned_at: string;
};

type CleaningLogList = { items: CleaningLogItem[]; total: number };

type StayHistoryItem = {
  reservation_id: string;
  guest_first_name: string;
  guest_last_name: string;
  guest_vip: boolean;
  language: string;
  nights: number;
  check_in_at: string;
  check_out_at: string;
  rate_cents: number | null;
  gss: number | null;
};

type RoomStayHistory = { items: StayHistoryItem[]; total: number };

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function cToF(c: number) {
  return Math.round(c * 9 / 5 + 32);
}

type LiveMsg = {
  type: string;
  org_id?: string;
  property_id?: string;
  room?: unknown;
};

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

const ROOM_STATUS_PILLS: Array<{ status: RoomStatus; color: string }> = [
  { status: "occupied",     color: "#3b82f6" },
  { status: "vacant_clean", color: "#10b981" },
  { status: "vacant_dirty", color: "#ef4444" },
  { status: "inspected",    color: "#00c4a3" },
  { status: "out_of_order", color: "#8b5cf6" },
];

const ROOM_STATUS_CFG: Record<RoomStatus, { bg: string; border: string; color: string }> = {
  vacant_clean: { bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.2)", color: "#10b981" },
  vacant_dirty: { bg: "rgba(239,68,68,0.1)",  border: "rgba(239,68,68,0.2)",  color: "#ef4444" },
  occupied:     { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.2)", color: "#3b82f6" },
  inspected:    { bg: "rgba(0,196,163,0.1)",  border: "rgba(0,196,163,0.2)",  color: "#00c4a3" },
  out_of_order: { bg: "rgba(139,92,246,0.1)", border: "rgba(139,92,246,0.2)", color: "#8b5cf6" },
};


function DetailRow({ label, value, valueStyle }: { label: string; value: React.ReactNode; valueStyle?: React.CSSProperties }) {
  return (
    <div className="flex items-center justify-between border-b border-cortai-border/40 py-2 last:border-0">
      <span className="text-[11px] text-cortai-text3">{label}</span>
      <span className="text-[12px] text-cortai-text2" style={valueStyle}>{value}</span>
    </div>
  );
}

export function RoomMonitorClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.roomMonitor");
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const wsRef = useRef<WebSocket | null>(null);

  const wsUrl = useMemo(() => toWsUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? ""), []);

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const effective = useMemo(() => {
    const floor = clampInt(searchParams.get("floor"), 0, 0, 200);
    const status = (searchParams.get("status") ?? "") as RoomStatus | "";
    const type = (searchParams.get("type") ?? "").trim();
    const search = (searchParams.get("search") ?? "").trim();
    return { floor: String(searchParams.get("floor") ?? "") ? floor : null, status, type, search };
  }, [searchParams]);

  function pushQuery(next: { floor?: number | null; status?: RoomStatus | ""; type?: string; search?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.floor !== undefined) {
      if (next.floor === null) params.delete("floor");
      else params.set("floor", String(next.floor));
    }
    if (next.status !== undefined) {
      if (next.status) params.set("status", next.status);
      else params.delete("status");
    }
    if (next.type !== undefined) {
      const v = next.type.trim();
      if (v) params.set("type", v);
      else params.delete("type");
    }
    if (next.search !== undefined) {
      const v = next.search.trim();
      if (v) params.set("search", v);
      else params.delete("search");
    }
    router.push(`${pathname}?${params.toString()}` as unknown as Parameters<typeof router.push>[0]);
  }

  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [iot, setIot] = useState<unknown | null>(null);
  const [cleaningLog, setCleaningLog] = useState<CleaningLogList | null>(null);
  const [stayHistory, setStayHistory] = useState<RoomStayHistory | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  // Reset tabs when a different room is selected
  useEffect(() => {
    setDetailTab("overview");
    setShowStatusPicker(false);
  }, [selectedId]);

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<RoomStatus, number>> = {};
    for (const r of rooms) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
    return counts;
  }, [rooms]);

  const roomsByFloor = useMemo(() => {
    const groups = new Map<number | null, RoomListItem[]>();
    for (const r of rooms) {
      if (!groups.has(r.floor)) groups.set(r.floor, []);
      groups.get(r.floor)!.push(r);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    });
  }, [rooms]);

  const loadRooms = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("property_id", propertyId);
      if (effective.floor !== null) params.set("floor", String(effective.floor));
      if (effective.status) params.set("status", effective.status);
      if (effective.type) params.set("type", effective.type);
      if (effective.search) params.set("search", effective.search);
      const resp = await apiFetch<RoomList>(`/api/operations/rooms?${params.toString()}`);
      setRooms(resp.items);
    } catch (e) {
      setRooms([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [effective, propertyId]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    if (!user) return;
    if (!propertyId) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", scope: "property", property_id: propertyId }));
    };
    ws.onmessage = (event) => {
      let msg: LiveMsg | null = null;
      try {
        msg = JSON.parse(String(event.data)) as LiveMsg;
      } catch {
        return;
      }
      if (!msg) return;
      if (msg.type === "room.updated") {
        void loadRooms();
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [loadRooms, propertyId, user, wsUrl]);

  const openRoom = useCallback(async (roomId: string) => {
    setSelectedId(roomId);
    setDrawerLoading(true);
    setDetail(null);
    setIot(null);
    setCleaningLog(null);
    setStayHistory(null);
    try {
      const rid = encodeURIComponent(roomId);
      const [d, i, cl, sh] = await Promise.all([
        apiFetch<RoomDetail>(`/api/operations/rooms/${rid}`),
        apiFetch<unknown>(`/api/operations/rooms/${rid}/iot`),
        apiFetch<CleaningLogList>(`/api/operations/rooms/${rid}/cleaning-log?limit=20`),
        apiFetch<RoomStayHistory>(`/api/operations/rooms/${rid}/stay-history?limit=20`),
      ]);
      setDetail(d);
      setIot(i);
      setCleaningLog(cl);
      setStayHistory(sh);
    } catch (e) {
      setError(String(e));
    } finally {
      setDrawerLoading(false);
    }
  }, []);

  const patchRoom = useCallback(
    async (roomId: string, payload: unknown) => {
      await apiFetch<RoomListItem>(`/api/operations/rooms/${encodeURIComponent(roomId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      await loadRooms();
      if (selectedId === roomId) {
        const d = await apiFetch<RoomDetail>(`/api/operations/rooms/${encodeURIComponent(roomId)}`);
        setDetail(d);
      }
    },
    [loadRooms, selectedId]
  );

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-xs text-cortai-text2">{t("selectProperty")}</p>
      </div>
    );
  }

  const typedIot = iot as RoomIotData | null;
  const sensorByType = (type: string) =>
    typedIot?.sensors?.find((s) => s.type === type);

  const tempF = typedIot?.hvac?.current_temp_c != null ? cToF(typedIot.hvac.current_temp_c) : null;
  const tempColor = tempF == null ? "#4d607e" : tempF > 76 ? "#f59e0b" : tempF < 68 ? "#3b82f6" : "#10b981";

  const humiditySensor = sensorByType("humidity");
  const humidity = humiditySensor?.value ?? null;
  const humColor = humidity == null ? "#4d607e" : humidity > 60 ? "#f59e0b" : "#00c4a3";

  const noiseDb = typedIot?.hvac?.noise_db ?? null;
  const noiseColor = noiseDb == null ? "#4d607e" : noiseDb > 50 ? "#ef4444" : noiseDb > 44 ? "#f59e0b" : "#10b981";

  const filterPct = typedIot?.hvac?.filter_life_pct ?? null;
  const filterColor = filterPct == null ? "#4d607e" : filterPct < 30 ? "#ef4444" : filterPct < 50 ? "#f59e0b" : "#00c4a3";

  const occupancySensor = sensorByType("occupancy");
  const isOccupied = occupancySensor?.value === 1 || detail?.current_reservation != null;

  return (
    <div className="grid gap-3.5" data-testid="room-monitor-page">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => void loadRooms()}>
            {t("refresh")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-cortai-red/25 bg-cortai-red/10 p-3 text-xs text-cortai-red">
          {error}
        </div>
      ) : null}

      {/* Status summary pills */}
      <div className="flex flex-wrap gap-2">
        {ROOM_STATUS_PILLS.map(({ status, color }) => (
          <button
            key={status}
            type="button"
            onClick={() => pushQuery({ status: effective.status === status ? "" : status })}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 transition"
            style={{
              background: effective.status === status ? `${color}18` : "#131e2e",
              borderColor: effective.status === status ? `${color}80` : "rgba(255,255,255,0.07)",
            }}
          >
            <div className="size-2 rounded-full" style={{ background: color }} />
            <span className="text-xs text-cortai-text2">{t(`status.${status}`)}</span>
            <span className="text-[13px] font-bold" style={{ color }}>
              {statusCounts[status] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Two-column layout */}
      <div className="grid items-start gap-3.5" style={{ gridTemplateColumns: "1fr 380px" }}>
        {/* Room Grid Card */}
        <div className="rounded-[10px] border border-cortai-border" style={{ background: "#131e2e" }}>
          <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
            </svg>
            <h3 className="text-sm font-semibold text-cortai-text">{t("gridTitle")}</h3>
            <span className="ml-auto rounded-md border border-cortai-border bg-cortai-bg3 px-2 py-0.5 text-[10px] font-medium text-cortai-text2">
              {rooms.length} total
            </span>
            <span className="text-[11px] text-cortai-text3">{t("clickHint")}</span>
          </div>

          <form
            action={(formData) => {
              const floorRaw = String(formData.get("floor") ?? "").trim();
              const floor = floorRaw ? clampInt(floorRaw, 0, 0, 200) : null;
              const type = String(formData.get("type") ?? "");
              const search = String(formData.get("search") ?? "");
              pushQuery({ floor, type, search });
            }}
            className="flex flex-wrap gap-2 border-b border-cortai-border/60 px-4 py-2.5"
            data-testid="room-monitor-filters"
          >
            <input
              name="floor"
              defaultValue={effective.floor === null ? "" : String(effective.floor)}
              className="w-[80px] rounded-md border border-cortai-border bg-cortai-bg2 px-2.5 py-1 text-[11px] outline-none focus:border-cortai-teal"
              placeholder={t("filters.floor")}
            />
            <input
              name="type"
              defaultValue={effective.type}
              className="w-[100px] rounded-md border border-cortai-border bg-cortai-bg2 px-2.5 py-1 text-[11px] outline-none focus:border-cortai-teal"
              placeholder={t("filters.type")}
            />
            <input
              name="search"
              defaultValue={effective.search}
              className="w-[130px] rounded-md border border-cortai-border bg-cortai-bg2 px-2.5 py-1 text-[11px] outline-none focus:border-cortai-teal"
              placeholder={t("filters.search")}
            />
            <button
              type="submit"
              className="rounded-md border border-cortai-border bg-cortai-bg3 px-3 py-1 text-[11px] text-cortai-text2 transition hover:border-cortai-teal/40 hover:text-cortai-text"
            >
              {t("filters.apply")}
            </button>
          </form>

          <div className="space-y-4 p-4">
            {loading && rooms.length === 0 ? (
              <div className="text-xs text-cortai-text3">Loading...</div>
            ) : null}
            {roomsByFloor.map(([floor, floorRooms]) => (
              <div key={floor ?? "no-floor"}>
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">
                  {floor !== null ? `Floor ${floor}` : "—"}
                </div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(50px, 1fr))" }}>
                  {floorRooms.map((r) => {
                    const cfg = ROOM_STATUS_CFG[r.status];
                    const isSelected = r.id === selectedId;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        data-testid={`room-tile-${r.room_number}`}
                        onClick={() => void openRoom(r.id)}
                        className="rounded-lg px-1.5 py-1.5 text-left transition"
                        style={{
                          background: cfg.bg,
                          border: `1px solid ${isSelected ? "#00c4a3" : cfg.border}`,
                          outline: isSelected ? "2px solid #00c4a3" : "none",
                          outlineOffset: 1,
                          minWidth: 50,
                        }}
                      >
                        <div className="font-mono text-[11px] font-semibold" style={{ color: cfg.color }}>
                          {r.room_number}{r.vip ? " ★" : ""}
                        </div>
                        <div className="text-[9px]" style={{ color: `${cfg.color}99` }}>
                          {t(`statusCode.${r.status}`)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {rooms.length === 0 && !loading ? (
              <div className="text-xs text-cortai-text2">{t("empty")}</div>
            ) : null}
          </div>
        </div>

        {/* Sticky Detail Panel */}
        <div className="sticky top-0">
          {drawerLoading ? (
            <div className="flex items-center justify-center rounded-[10px] border border-cortai-border px-6 py-16" style={{ background: "#131e2e" }}>
              <div className="text-xs text-cortai-text3">{t("drawer.loading")}</div>
            </div>
          ) : detail ? (
            <div className="flex flex-col rounded-[10px] border border-cortai-border" style={{ background: "#131e2e", maxHeight: "calc(100vh - 96px)" }}>

              {/* Header */}
              <div className="flex shrink-0 items-center gap-2 border-b border-cortai-border px-4 py-3">
                <span className="font-mono text-xl font-bold text-cortai-text">Room {detail.room.room_number}</span>
                {detail.room.vip ? <Badge tone="amber">VIP</Badge> : null}
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: `${ROOM_STATUS_CFG[detail.room.status].color}20`,
                    color: ROOM_STATUS_CFG[detail.room.status].color,
                    border: `1px solid ${ROOM_STATUS_CFG[detail.room.status].color}40`,
                  }}
                >
                  {t(`status.${detail.room.status}`)}
                </span>
                <button
                  type="button"
                  onClick={() => { setSelectedId(null); setDetail(null); setIot(null); }}
                  className="ml-auto flex size-6 items-center justify-center rounded text-cortai-text3 transition hover:bg-cortai-bg3 hover:text-cortai-text"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {/* Subtitle */}
              <div className="shrink-0 border-b border-cortai-border px-4 py-1.5 text-[11px] text-cortai-text3">
                {detail.room.type ?? "—"} · Floor {detail.room.floor ?? "—"}
              </div>

              {/* Tabs */}
              <div className="flex shrink-0 border-b border-cortai-border">
                {(["overview", "equipment", "history"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setDetailTab(tab)}
                    className="px-4 py-2.5 text-[12px] transition"
                    style={{
                      color: detailTab === tab ? "#00c4a3" : "#4d607e",
                      fontWeight: detailTab === tab ? 600 : 400,
                      borderBottom: detailTab === tab ? "2px solid #00c4a3" : "2px solid transparent",
                    }}
                  >
                    {tab === "overview" ? "Overview" : tab === "equipment" ? "Equipment & Assets" : "Service History"}
                  </button>
                ))}
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto">

                {/* ── OVERVIEW TAB ── */}
                {detailTab === "overview" ? (
                  <>
                    {/* Stats bar */}
                    <div className="grid shrink-0 grid-cols-4 divide-x divide-cortai-border border-b border-cortai-border">
                      {[
                        { label: "Occupancy", value: isOccupied ? "1 / 1" : "0 / —", color: isOccupied ? "#3b82f6" : "#4d607e" },
                        { label: "Temperature", value: tempF != null ? `${tempF}°F` : "—", color: tempColor },
                        { label: "Humidity", value: humidity != null ? `${humidity}%` : "—", color: humColor },
                        { label: "PTAC Noise", value: noiseDb != null ? `${noiseDb} dB` : "—", color: noiseColor },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="flex flex-col items-center py-3">
                          <div className="font-mono text-[22px] font-bold leading-none" style={{ color }}>
                            {value}
                          </div>
                          <div className="mt-1 text-[9px] text-cortai-text3">{label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Lifetime Room Stats banner */}
                    <div className="border-b border-cortai-border px-4 py-3" style={{ background: "rgba(0,196,163,0.04)" }}>
                      <div className="mb-2.5 text-[9px] font-bold uppercase tracking-[0.1em] text-cortai-teal">
                        Lifetime Room Stats — Since {detail.room.floor ? `Floor ${detail.room.floor}` : "—"}
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { v: "—", l: "Total Stays",    c: "#00c4a3" },
                          { v: "—", l: "Total Nights",   c: "#3b82f6" },
                          { v: "—",  l: "Avg Rev / Night", c: "#10b981" },
                          { v: "—",  l: "Avg GSS",        c: "#f59e0b" },
                        ].map(({ v, l, c }) => (
                          <div key={l} className="rounded-lg py-2 text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                            <div className="font-mono text-[15px] font-bold leading-none" style={{ color: c }}>{v}</div>
                            <div className="mt-1 text-[9px] text-cortai-text3">{l}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Room Details */}
                    <div className="border-b border-cortai-border px-4 py-3">
                      <div className="mb-2 text-[12px] font-semibold text-cortai-text">Room Details</div>
                      <DetailRow label="Room Type" value={detail.room.type ?? "—"} />
                      <DetailRow label="Floor" value={detail.room.floor != null ? `Floor ${detail.room.floor}` : "—"} />
                      {detail.current_reservation ? (
                        <>
                          <DetailRow
                            label="Guest"
                            value={
                              <span className="flex items-center gap-1.5">
                                {detail.current_reservation.guest.first_name} {detail.current_reservation.guest.last_name}
                                {detail.current_reservation.guest.vip ? <Badge tone="amber">VIP</Badge> : null}
                              </span>
                            }
                          />
                          <DetailRow label="Check-In"  value={fmtDate(detail.current_reservation.check_in_at)}  valueStyle={{ color: "#cbd5e1" }} />
                          <DetailRow label="Check-Out" value={fmtDate(detail.current_reservation.check_out_at)} valueStyle={{ color: "#cbd5e1" }} />
                          {detail.current_reservation.rate_cents != null ? (
                            <DetailRow
                              label="Rate / Night"
                              value={`$${(detail.current_reservation.rate_cents / 100).toFixed(2)}`}
                              valueStyle={{ color: "#10b981" }}
                            />
                          ) : null}
                        </>
                      ) : (
                        <DetailRow label="Guest" value={t("drawer.noReservation")} />
                      )}
                      <DetailRow label="Last Service" value={fmtDate(detail.room.last_service_at)} />
                    </div>

                    {/* PTAC / Climate */}
                    <div className="px-4 py-3">
                      <div className="mb-2 text-[12px] font-semibold text-cortai-text">PTAC / Climate</div>
                      {typedIot?.hvac ? (
                        <>
                          {typedIot.hvac.model    ? <DetailRow label="Model"    value={typedIot.hvac.model} /> : null}
                          {typedIot.hvac.serial   ? <DetailRow label="Serial"   value={<span className="font-mono text-[11px]">{typedIot.hvac.serial}</span>} /> : null}
                          {typedIot.hvac.mode     ? <DetailRow label="Mode"     value={<span className="capitalize" style={{ color: typedIot.hvac.mode === "cooling" ? "#3b82f6" : "#f97316" }}>{typedIot.hvac.mode}</span>} /> : null}
                          {typedIot.hvac.fan_speed ? <DetailRow label="Fan Speed" value={<span className="capitalize">{typedIot.hvac.fan_speed}</span>} /> : null}
                          {noiseDb != null        ? <DetailRow label="Noise Level" value={<span style={{ color: noiseColor }}>{noiseDb} dB / 55 dB max</span>} /> : null}
                          {typedIot.hvac.last_service   ? <DetailRow label="Last Service"  value={fmtDate(typedIot.hvac.last_service)} /> : null}
                          {typedIot.hvac.install_date   ? <DetailRow label="Install Date"  value={fmtDate(typedIot.hvac.install_date)} /> : null}
                          {typedIot.hvac.fault_code     ? <DetailRow label="Fault Code"    value={<span className="font-mono text-cortai-red">{typedIot.hvac.fault_code}</span>} /> : null}
                          {filterPct != null ? (
                            <div className="py-2">
                              <div className="mb-2 flex justify-between">
                                <span className="text-[11px] text-cortai-text3">Filter Life Remaining</span>
                                <span className="text-[12px] font-semibold" style={{ color: filterColor }}>
                                  {filterPct}%
                                </span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                                <div className="h-full rounded-full transition-all" style={{ width: `${filterPct}%`, background: filterColor }} />
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="text-[11px] text-cortai-text3">No PTAC data</div>
                      )}
                    </div>
                  </>
                ) : null}

                {/* ── EQUIPMENT & ASSETS TAB ── */}
                {detailTab === "equipment" ? (
                  <>
                    {/* In-Room Technology */}
                    <div className="border-b border-cortai-border px-4 py-3">
                      <div className="mb-2 text-[12px] font-semibold text-cortai-text">In-Room Technology</div>
                      <DetailRow
                        label="Television"
                        value={typedIot?.equipment?.tv_model ?? "—"}
                      />
                      <DetailRow
                        label="TV Status"
                        value={
                          <span style={{ color: typedIot?.equipment?.tv_status === "online" ? "#10b981" : "#4d607e" }}>
                            {typedIot?.equipment?.tv_status
                              ? typedIot.equipment.tv_status.charAt(0).toUpperCase() + typedIot.equipment.tv_status.slice(1)
                              : "—"}
                          </span>
                        }
                      />
                      <DetailRow
                        label="In-Room Phone"
                        value={`Corded phone · Ext ${
                          Number.isFinite(parseInt(detail.room.room_number))
                            ? parseInt(detail.room.room_number) + 1000
                            : detail.room.room_number
                        }`}
                      />
                      <DetailRow label="WiFi Network" value="TownePlace-Rooms · Strong signal" />
                      <DetailRow
                        label="Electronic Safe"
                        value={
                          <span style={{ color: typedIot?.equipment?.safe_status === "ok" ? "#10b981" : "#f59e0b" }}>
                            {typedIot?.equipment?.safe_status?.toUpperCase() ?? "—"}
                          </span>
                        }
                      />
                      <DetailRow
                        label="USB Charging"
                        value={typedIot?.equipment?.usb_charging ?? "—"}
                      />
                    </div>

                    {/* Furniture & Bedding */}
                    <div className="border-b border-cortai-border px-4 py-3">
                      <div className="mb-2 text-[12px] font-semibold text-cortai-text">Furniture &amp; Bedding</div>
                      <DetailRow
                        label="Bed Type"
                        value={typedIot?.furniture?.bed_type ?? detail.room.type ?? "—"}
                      />
                      <DetailRow
                        label="Bed Last Rotated"
                        value={fmtDate(typedIot?.furniture?.bed_last_rotated)}
                      />
                      <DetailRow label="Pillows" value={typedIot?.furniture?.pillows ?? "—"} />
                      <DetailRow label="Extra Bedding" value={typedIot?.furniture?.extra_bedding ?? "—"} />
                      <DetailRow label="Sofa / Seating" value={typedIot?.furniture?.sofa_seating ?? "—"} />
                    </div>

                    {/* Minibar & Amenities */}
                    <div className="px-4 py-3">
                      <div className="mb-2 text-[12px] font-semibold text-cortai-text">Minibar &amp; Amenities</div>
                      <DetailRow
                        label="Minibar Status"
                        value={
                          <span style={{ color: typedIot?.amenities?.minibar_status === "stocked" ? "#10b981" : "#f59e0b" }}>
                            {typedIot?.amenities?.minibar_status
                              ? typedIot.amenities.minibar_status.charAt(0).toUpperCase() + typedIot.amenities.minibar_status.slice(1)
                              : "—"}
                          </span>
                        }
                      />
                      <DetailRow
                        label="Coffee Maker"
                        value={
                          typedIot?.amenities?.coffee_maker
                            ? `${typedIot.amenities.coffee_maker}${typedIot.amenities.coffee_pods_remaining != null ? ` · Pods: ${typedIot.amenities.coffee_pods_remaining} remaining` : ""}`
                            : "—"
                        }
                      />
                      <DetailRow label="Bathroom Amenities" value={typedIot?.amenities?.bathroom_kit ?? "—"} />
                      <DetailRow label="Towels" value={typedIot?.amenities?.towels ?? "—"} />
                      <DetailRow label="Iron &amp; Board" value={typedIot?.amenities?.iron_board ?? "—"} />
                    </div>
                  </>
                ) : null}

                {/* ── SERVICE HISTORY TAB ── */}
                {detailTab === "history" ? (() => {
                  const clItems = cleaningLog?.items ?? [];
                  const scored = clItems.filter((r) => r.score_pct != null);
                  const avgScore = scored.length > 0
                    ? Math.round(scored.reduce((s, r) => s + (r.score_pct ?? 0), 0) / scored.length)
                    : null;
                  const shItems = stayHistory?.items ?? [];
                  return (
                  <>
                    {/* Cleaning Summary banner */}
                    <div className="border-b border-cortai-border px-4 py-3" style={{ background: "rgba(0,196,163,0.05)" }}>
                      <div className="mb-2.5 text-[9px] font-bold uppercase tracking-[0.1em] text-cortai-teal">
                        Cleaning Summary — Loaded Records
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { v: cleaningLog ? String(cleaningLog.total) : "—", l: "Total Cleans",  c: "#00c4a3" },
                          { v: avgScore != null ? `${avgScore}%` : "—",       l: "Avg Score",     c: "#10b981" },
                          { v: stayHistory ? String(stayHistory.total) : "—", l: "Total Stays",   c: "#f59e0b" },
                        ].map(({ v, l, c }) => (
                          <div key={l} className="rounded-lg py-2 text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                            <div className="font-mono text-[17px] font-bold leading-none" style={{ color: c }}>{v}</div>
                            <div className="mt-1 text-[9px] leading-tight text-cortai-text3">{l}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Cleaning Log */}
                    <div className="border-b border-cortai-border px-4 py-3">
                      <div className="mb-2.5 flex items-center">
                        <span className="text-[12px] font-semibold text-cortai-text">Cleaning Log</span>
                        <button
                          type="button"
                          className="ml-auto rounded-md px-2.5 py-1 text-[10px] font-semibold text-white transition hover:opacity-90"
                          style={{ background: "#10b981" }}
                        >
                          + Log Clean
                        </button>
                      </div>
                      {clItems.length === 0 ? (
                        <EmptyState message="No cleaning logs yet" className="py-4" testId="cleaning-logs-empty" />
                      ) : (
                        <>
                          <div
                            className="mb-1 grid text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
                            style={{ gridTemplateColumns: "90px 72px 1fr auto" }}
                          >
                            <span>Date</span>
                            <span>Staff</span>
                            <span>Type · Notes</span>
                            <span className="text-right">Score</span>
                          </div>
                          {clItems.map((row) => {
                            const d = new Date(row.cleaned_at);
                            const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                            const timeStr = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
                            const typeLabel = row.clean_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                            const s = row.score_pct;
                            return (
                              <div
                                key={row.id}
                                className="grid items-start border-b border-cortai-border/40 py-2 last:border-0"
                                style={{ gridTemplateColumns: "90px 72px 1fr auto" }}
                              >
                                <div>
                                  <div className="text-[11px] text-cortai-text2">{dateStr}</div>
                                  <div className="text-[9px] text-cortai-text3">{timeStr}</div>
                                </div>
                                <div className="text-[11px] font-medium text-cortai-text">{row.staff_name}</div>
                                <div className="pr-2">
                                  <div className="text-[11px] text-cortai-text2">
                                    {typeLabel}{row.notes ? ` · ${row.notes}` : ""}
                                  </div>
                                </div>
                                <div
                                  className="font-mono text-[12px] font-bold"
                                  style={{ color: s == null ? "#4d607e" : s >= 95 ? "#10b981" : s >= 85 ? "#00c4a3" : "#f59e0b" }}
                                >
                                  {s != null ? `${s}%` : "—"}
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>

                    {/* Guest Stay History */}
                    <div className="px-4 py-3">
                      <div className="mb-2.5 flex items-center">
                        <span className="text-[12px] font-semibold text-cortai-text">Guest Stay History</span>
                        {stayHistory ? (
                          <span className="ml-auto text-[10px] text-cortai-text3">{stayHistory.total} total stays</span>
                        ) : null}
                      </div>
                      {shItems.length === 0 ? (
                        <EmptyState message="No stay history yet" className="py-4" testId="stay-history-empty" />
                      ) : (
                        <>
                          <div
                            className="mb-1 grid text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
                            style={{ gridTemplateColumns: "80px 1fr 28px 36px" }}
                          >
                            <span>Check-In</span>
                            <span>Guest</span>
                            <span className="text-right">Nts</span>
                            <span className="text-right">GSS</span>
                          </div>
                          {shItems.map((row) => {
                            const gss = row.gss;
                            return (
                              <div
                                key={row.reservation_id}
                                className="grid items-start border-b border-cortai-border/40 py-2 last:border-0"
                                style={{ gridTemplateColumns: "80px 1fr 28px 36px" }}
                              >
                                <div className="text-[11px] text-cortai-text2">{fmtDate(row.check_in_at)}</div>
                                <div>
                                  <div className="flex items-center gap-1 text-[11px] text-cortai-text">
                                    {row.guest_first_name} {row.guest_last_name}
                                    {row.guest_vip ? (
                                      <span className="text-[9px] text-cortai-teal">VIP</span>
                                    ) : null}
                                  </div>
                                  {row.language ? (
                                    <div className="text-[9px] text-cortai-text3">{row.language.toUpperCase()}</div>
                                  ) : null}
                                </div>
                                <div className="text-right font-mono text-[11px] text-cortai-text2">{row.nights}</div>
                                <div
                                  className="text-right font-mono text-[12px] font-bold"
                                  style={{ color: gss == null ? "#4d607e" : gss >= 4.5 ? "#10b981" : gss >= 4.0 ? "#00c4a3" : "#f59e0b" }}
                                >
                                  {gss != null ? gss.toFixed(1) : "—"}
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  </>
                  );
                })() : null}

              </div>

              {/* Bottom action bar */}
              <div className="relative shrink-0 border-t border-cortai-border">
                {showStatusPicker ? (
                  <div className="absolute bottom-full left-0 right-0 rounded-t-[10px] border border-b-0 border-cortai-border p-3" style={{ background: "#1a2540" }}>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-cortai-text3">Change Status</div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {ROOM_STATUS_PILLS.map(({ status, color }) => (
                        <button
                          key={status}
                          type="button"
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] transition hover:bg-white/5"
                          style={{ color: detail.room.status === status ? color : "#94a3b8" }}
                          onClick={() => {
                            if (selectedId) void patchRoom(selectedId, { status });
                            setShowStatusPicker(false);
                          }}
                        >
                          <div className="size-2 rounded-full" style={{ background: color }} />
                          {t(`status.${status}`)}
                          {detail.room.status === status ? (
                            <svg className="ml-auto" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="20,6 9,17 4,12" />
                            </svg>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    className="rounded-md border border-cortai-border px-3 py-1.5 text-[11px] text-cortai-text2 transition hover:border-cortai-teal/40 hover:text-cortai-text"
                  >
                    Cleaning Log
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-cortai-border px-3 py-1.5 text-[11px] text-cortai-text2 transition hover:border-cortai-teal/40 hover:text-cortai-text"
                  >
                    Work Order
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-cortai-border px-3 py-1.5 text-[11px] text-cortai-text2 transition hover:border-cortai-teal/40 hover:text-cortai-text"
                  >
                    Guest Message
                  </button>
                  <button
                    type="button"
                    className="ml-auto rounded-md px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90"
                    style={{ background: "#00c4a3" }}
                    onClick={() => setShowStatusPicker((v) => !v)}
                  >
                    Change Status
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Empty state */
            <div
              className="flex flex-col items-center justify-center rounded-[10px] border border-cortai-border px-6 py-16 text-center"
              style={{ background: "#131e2e" }}
            >
              <svg width="36" height="36" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1" className="mb-3 text-cortai-text3 opacity-40">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
              </svg>
              <div className="text-sm text-cortai-text3">Select a room</div>
              <div className="mt-1 text-[11px] text-cortai-text3 opacity-70">
                Click any room cell to view details, IoT status, guest info, and service history
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
