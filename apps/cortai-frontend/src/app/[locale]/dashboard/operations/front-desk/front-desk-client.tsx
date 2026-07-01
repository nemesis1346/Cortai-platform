"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Tabs } from "@/components/ui/Tabs";
import { useRealtimeSocket } from "@/hooks/use-realtime-socket";

type TabKey = "arrivals" | "in_hotel" | "departures" | "queue";
type ArrivalFilter = "all" | "pending" | "vip";

type GuestSummary = { first_name: string; last_name: string; vip: boolean };

type ReservationListItem = {
  reservation_id: string;
  property_id: string;
  status: string;
  check_in_at: string;
  check_out_at: string;
  guest: GuestSummary;
  room_id: string | null;
  room_number: string | null;
};

type Arrivals = { date: string; items: ReservationListItem[] };
type Departures = { date: string; items: ReservationListItem[] };
type InHotel = { items: ReservationListItem[] };

type QueueItem = {
  event_id: string;
  reservation_id: string;
  queue_position: number;
  started_at: string;
  guest: GuestSummary;
};
type QueueList = { items: QueueItem[] };

type WalkInResult = { reservation_id: string; guest_id: string; room_id: string; status: string };

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}

function fmtShortDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function calcNights(checkIn: string, checkOut: string): number {
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.round(diff / 86400000));
}

function guestLabel(g: GuestSummary): string {
  return `${g.last_name}, ${g.first_name}`;
}

type StatusCfg = { col: string; bg: string; lbl: string; icon: string };
const STATUS_CFG: Record<string, StatusCfg> = {
  checked_in:  { col: "#10b981", bg: "rgba(16,185,129,.15)",  lbl: "✓ CHECKED-IN", icon: "✓" },
  checked_out: { col: "#94a3b8", bg: "rgba(148,163,184,.10)", lbl: "CHECKED-OUT",   icon: "○" },
  no_show:     { col: "#ef4444", bg: "rgba(239,68,68,.12)",   lbl: "NO-SHOW",       icon: "✕" },
  booked:      { col: "#00c4a3", bg: "rgba(0,196,163,.12)",   lbl: "ETA",           icon: "●" },
};
function getStatusCfg(status: string): StatusCfg {
  return STATUS_CFG[status] ?? STATUS_CFG.booked;
}

const SPECIAL_REQUESTS = [
  { ico: "🕐", label: "Early check-in",   count: 6, note: "Before 3 PM standard" },
  { ico: "🌙", label: "Late check-in",    count: 4, note: "After 9 PM" },
  { ico: "🛏",  label: "Extra bed / crib", count: 4, note: "3 cribs · 1 rollaway" },
  { ico: "♿", label: "ADA accessible",    count: 2, note: "Roll-in shower required" },
  { ico: "🐕", label: "Pet policy",        count: 1, note: "$25/night fee applied" },
  { ico: "🛗",  label: "High floor req",   count: 3, note: "Floor 5–6 preferred" },
  { ico: "🔇", label: "Quiet room",        count: 2, note: "Away from ice/elevator" },
  { ico: "🤝", label: "Connecting rooms",  count: 1, note: "Adjacent rooms paired" },
] as const;

export function FrontDeskClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.frontDesk");
  const { user } = useAuth();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [tab, setTab] = useState<TabKey>("arrivals");
  const [arrivalFilter, setArrivalFilter] = useState<ArrivalFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [arrivals, setArrivals] = useState<Arrivals | null>(null);
  const [departures, setDepartures] = useState<Departures | null>(null);
  const [inHotel, setInHotel] = useState<InHotel | null>(null);
  const [queue, setQueue] = useState<QueueList | null>(null);

  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInFirstName, setWalkInFirstName] = useState("");
  const [walkInLastName, setWalkInLastName] = useState("");
  const [walkInRoomId, setWalkInRoomId] = useState("");
  const [checkInReservation, setCheckInReservation] = useState<ReservationListItem | null>(null);
  const [checkInRoomId, setCheckInRoomId] = useState("");

  const queueCount = queue?.items?.length ?? 0;

  const loadAll = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const [a, d, ih, q] = await Promise.all([
        apiFetch<Arrivals>(`/api/operations/front-desk/arrivals?property_id=${pid}`),
        apiFetch<Departures>(`/api/operations/front-desk/departures?property_id=${pid}`),
        apiFetch<InHotel>(`/api/operations/front-desk/in-hotel?property_id=${pid}`),
        apiFetch<QueueList>(`/api/operations/front-desk/queue?property_id=${pid}`),
      ]);
      setArrivals(a);
      setDepartures(d);
      setInHotel(ih);
      setQueue(q);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useRealtimeSocket({
    enabled: Boolean(user && propertyId),
    propertyId,
    onReconnect: useCallback(() => { void loadAll(); }, [loadAll]),
    onMessage: useCallback((msg: { type?: string }) => {
      if (msg.type === "front_desk.event") void loadAll();
    }, [loadAll]),
  });

  // ── Derived stats ────────────────────────────────────────────────────────
  const arrivalsItems   = useMemo(() => arrivals?.items ?? [], [arrivals]);
  const checkedInCount  = arrivalsItems.filter((r) => r.status === "checked_in").length;
  const pendingCount    = arrivalsItems.filter((r) => r.status === "booked").length;
  const vipArrivalCount = arrivalsItems.filter((r) => r.guest.vip).length;

  const inHouseItems    = useMemo(() => inHotel?.items ?? [], [inHotel]);
  const inHouseVipCount = inHouseItems.filter((r) => r.guest.vip).length;

  const departuresItems = useMemo(() => departures?.items ?? [], [departures]);
  const departedCount   = departuresItems.filter((r) => r.status === "checked_out").length;
  const stillInCount    = departuresItems.filter((r) => r.status !== "checked_out").length;

  const filteredArrivals = useMemo(() => {
    if (arrivalFilter === "pending") return arrivalsItems.filter((r) => r.status === "booked");
    if (arrivalFilter === "vip")     return arrivalsItems.filter((r) => r.guest.vip);
    return arrivalsItems;
  }, [arrivalsItems, arrivalFilter]);

  // ── Actions ──────────────────────────────────────────────────────────────
  async function submitWalkIn() {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch<WalkInResult>("/api/operations/front-desk/walk-in", {
        method: "POST",
        body: JSON.stringify({
          property_id: propertyId,
          room_id: walkInRoomId,
          guest: { first_name: walkInFirstName, last_name: walkInLastName, vip: false, language: "en" },
        }),
      });
      setWalkInOpen(false);
      setWalkInFirstName("");
      setWalkInLastName("");
      setWalkInRoomId("");
      await loadAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function submitCheckIn() {
    if (!checkInReservation) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch<unknown>(
        `/api/operations/front-desk/check-in/${encodeURIComponent(checkInReservation.reservation_id)}`,
        { method: "POST", body: JSON.stringify({ room_id: checkInRoomId }) },
      );
      setCheckInReservation(null);
      setCheckInRoomId("");
      await loadAll();
    } catch (e) {
      setError(String(e));
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

  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="grid gap-4" data-testid="front-desk-page">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-cortai-text">{t("title")}</h1>
          <p className="text-[11px] text-cortai-text3">
            {todayLabel} · {arrivalsItems.length} arrivals · {inHouseItems.length} in-house · {departuresItems.length} departures
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {queueCount > 0 && (
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ background: "rgba(0,196,163,.15)", color: "#00c4a3", border: "1px solid rgba(0,196,163,.3)" }}
              data-testid="front-desk-queue-count"
            >
              {t("queueCount", { count: queueCount })}
            </span>
          )}
          <Button type="button" variant="ghost" onClick={() => void loadAll()} disabled={loading}>
            {t("refresh")}
          </Button>
          <button
            type="button"
            onClick={() => setWalkInOpen(true)}
            data-testid="front-desk-walkin-open"
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90"
            style={{ background: "#00c4a3" }}
          >
            + Walk-in
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-cortai-red">{error}</div>
      ) : null}

      {/* ── Tab Bar ────────────────────────────────────────────────────── */}
      <Tabs
        value={tab}
        onChange={(v) => setTab(v as TabKey)}
        testId="front-desk-tabs"
        rightSlot={
          <input
            type="text"
            placeholder="Search guest, confirm #, room…"
            className="rounded-lg border border-cortai-border bg-cortai-bg3 px-3 py-1.5 text-[11px] text-cortai-text outline-none focus:border-cortai-teal/50"
            style={{ width: 220 }}
          />
        }
        tabs={[
          {
            value: "arrivals",
            label: "Arrivals",
            sub: `${arrivalsItems.length} today · ${checkedInCount} in`,
            icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><path d="M5 12h14M12 5l7 7-7 7"/></svg>,
            testId: "tab-arrivals",
          },
          {
            value: "in_hotel",
            label: "In-House",
            sub: `${inHouseItems.length} rooms · ${inHouseVipCount} VIPs`,
            icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
            testId: "tab-in-hotel",
          },
          {
            value: "departures",
            label: "Departures",
            sub: `${departuresItems.length} today · ${stillInCount} to go`,
            icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>,
            testId: "tab-departures",
          },
          {
            value: "queue",
            label: "Queue",
            sub: `${queueCount} waiting`,
            icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
            testId: "tab-queue",
          },
        ]}
      />

      {/* ═══════════════════════════════════════════════════════════════════
          ARRIVALS TAB
      ═══════════════════════════════════════════════════════════════════ */}
      {tab === "arrivals" ? (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Arrivals Today",     v: arrivalsItems.length,       sub: `${checkedInCount} checked-in · ${pendingCount} pending`, c: "#3b82f6" },
              { label: "ETA Next 2 Hours",   v: Math.min(pendingCount, 8),  sub: "per schedule",                                            c: "#00c4a3" },
              { label: "VIP Arrivals",       v: vipArrivalCount,            sub: "Marked VIP guests",                                       c: "#c9a84c" },
              { label: "Group Arrivals",     v: 8,                          sub: "Thompson Wedding",                                        c: "#8b5cf6" },
              { label: "Extended Stay (7+)", v: 6,                          sub: "2 already long-staying",                                  c: "#00c4a3" },
            ].map(({ label, v, sub, c }) => (
              <div
                key={label}
                className="rounded-xl border border-cortai-border px-4 py-3"
                style={{ background: "rgba(255,255,255,.02)" }}
              >
                <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">{label}</div>
                <div className="mt-1 font-mono text-[24px] font-bold leading-none" style={{ color: c }}>{v}</div>
                <div className="mt-1 text-[9px] text-cortai-text3">{sub}</div>
              </div>
            ))}
          </div>

          {/* Main layout: board + side panels */}
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 330px" }}>

            {/* Arrivals Board */}
            <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
              <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <span className="text-[13px] font-semibold text-cortai-text">Arrivals Board — {todayLabel}</span>
                <div className="ml-auto flex gap-1.5">
                  {(["all", "pending", "vip"] as const).map((f) => {
                    const label = f === "all" ? `All (${arrivalsItems.length})` : f === "pending" ? `Pending (${pendingCount})` : `VIP (${vipArrivalCount})`;
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setArrivalFilter(f)}
                        className="rounded-md px-2.5 py-1 text-[10px] font-semibold transition"
                        style={{
                          background: arrivalFilter === f ? "rgba(0,196,163,.15)" : "rgba(255,255,255,.04)",
                          color: arrivalFilter === f ? "#00c4a3" : "#4d7088",
                          border: `1px solid ${arrivalFilter === f ? "rgba(0,196,163,.3)" : "rgba(255,255,255,.06)"}`,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Table header */}
              <div
                className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
                style={{ gridTemplateColumns: "22px 1fr 72px 96px 76px 36px 60px 100px", background: "rgba(255,255,255,.02)" }}
              >
                <div />
                <div>Guest / Confirm #</div>
                <div>Room</div>
                <div>ETA / Arrived</div>
                <div>Check-out</div>
                <div className="text-center">Nts</div>
                <div>Tier</div>
                <div className="text-center">Status</div>
              </div>

              {/* Rows */}
              {filteredArrivals.length === 0 ? (
                <EmptyState
                  message={loading ? "Loading arrivals…" : "No arrivals for this filter"}
                  testId="arrivals-empty"
                />
              ) : filteredArrivals.map((a) => {
                const sc = getStatusCfg(a.status);
                const isVip = a.guest.vip;
                const nights = calcNights(a.check_in_at, a.check_out_at);
                const etaDisplay = a.status === "checked_in" ? `Arrived ${fmtTime(a.check_in_at)}` : fmtTime(a.check_in_at);
                return (
                  <div
                    key={a.reservation_id}
                    className="grid items-center border-b border-cortai-border/30 px-4 py-2.5 text-[11px] last:border-0"
                    style={{
                      gridTemplateColumns: "22px 1fr 72px 96px 76px 36px 60px 100px",
                      background: isVip ? "linear-gradient(90deg,rgba(201,168,76,.05),transparent 60%)" : "transparent",
                      borderLeft: isVip ? "3px solid rgba(201,168,76,.5)" : "3px solid transparent",
                    }}
                  >
                    <div
                      className="flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px]"
                      style={{ border: `1.5px solid ${sc.col}`, color: sc.col }}
                    >
                      {sc.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-semibold text-cortai-text">{guestLabel(a.guest)}</span>
                        {isVip ? <span className="text-[10px]">⭐</span> : null}
                      </div>
                      <div className="font-mono text-[9px] text-cortai-text3">{a.reservation_id.slice(0, 12).toUpperCase()}</div>
                    </div>
                    <div className="font-mono font-bold" style={{ color: a.room_number ? "#00c4a3" : "#4d7088" }}>
                      {a.room_number ?? "—"}
                    </div>
                    <div className="font-mono text-[10px]" style={{ color: a.status === "checked_in" ? "#10b981" : "#94a3b8" }}>
                      {etaDisplay}
                    </div>
                    <div className="text-[10px] text-cortai-text3">{fmtShortDate(a.check_out_at)}</div>
                    <div className="text-center font-mono text-[10px] text-cortai-text2">{nights}</div>
                    <div>
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                        style={isVip
                          ? { background: "rgba(201,168,76,.14)", color: "#c9a84c" }
                          : { background: "rgba(148,163,184,.08)", color: "#94a3b8" }
                        }
                      >
                        {isVip ? "VIP" : "GUEST"}
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                        style={{ background: sc.bg, color: sc.col }}
                      >
                        {sc.lbl}
                      </span>
                      {a.status === "booked" ? (
                        <button
                          type="button"
                          onClick={() => { setCheckInReservation(a); setCheckInRoomId(a.room_id ?? ""); }}
                          className="rounded px-1.5 py-0.5 text-[8px] font-semibold text-white transition hover:opacity-80"
                          style={{ background: "#3b82f6" }}
                        >
                          Check-in
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              <div
                className="flex items-center border-t border-cortai-border px-4 py-2.5 text-[10px] text-cortai-text3"
                style={{ background: "rgba(255,255,255,.02)" }}
              >
                <span>Showing {filteredArrivals.length} of {arrivalsItems.length} arrivals</span>
              </div>
            </div>

            {/* Side panels */}
            <div className="flex min-w-0 flex-col gap-3">

              {/* Group Arrivals */}
              <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
                <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#8b5cf6" fill="none" strokeWidth="1.5">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                  </svg>
                  <span className="text-[12px] font-semibold text-cortai-text">Group Arrivals</span>
                </div>
                <div className="space-y-2 p-3">
                  <div className="rounded-lg border p-3" style={{ background: "rgba(139,92,246,.06)", borderColor: "rgba(139,92,246,.25)" }}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-[11px] font-bold text-cortai-text">Thompson Wedding</span>
                      <span className="ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] font-bold" style={{ background: "rgba(139,92,246,.2)", color: "#8b5cf6" }}>8 ROOMS</span>
                    </div>
                    <div className="text-[10px] leading-relaxed text-cortai-text2">
                      Guests arriving 3:00 PM – 6:00 PM<br />
                      <span className="font-mono" style={{ color: "#f59e0b" }}>6 / 8 not yet arrived</span>
                    </div>
                    <div className="mt-2 border-t pt-2 text-[9px] text-cortai-text3" style={{ borderColor: "rgba(139,92,246,.2)" }}>
                      Coordinator: Sara K. · Master folio
                    </div>
                  </div>
                  <div className="rounded-lg border p-3" style={{ background: "rgba(201,168,76,.05)", borderColor: "rgba(201,168,76,.2)" }}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-[11px] font-bold text-cortai-text">Magellan Pharma <span className="text-[9px] font-normal text-cortai-text3">(5d away)</span></span>
                      <span className="ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] font-bold" style={{ background: "rgba(201,168,76,.2)", color: "#c9a84c" }}>30 ROOMS</span>
                    </div>
                    <div className="text-[10px] leading-relaxed text-cortai-text2">
                      Begins arrivals Mon · 2 VIP scouts today
                    </div>
                    <div className="mt-2 border-t pt-2 text-[9px] text-cortai-text3" style={{ borderColor: "rgba(201,168,76,.2)" }}>
                      Suite 601+602 held · 28 std to assign
                    </div>
                  </div>
                </div>
              </div>

              {/* Special Requests */}
              <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
                <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#f59e0b" fill="none" strokeWidth="1.5">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                  <span className="text-[12px] font-semibold text-cortai-text">Today&apos;s Special Requests</span>
                  <span
                    className="ml-auto rounded-full px-2 py-0.5 text-[9px] font-semibold"
                    style={{ background: "rgba(245,158,11,.15)", color: "#f59e0b" }}
                  >
                    {SPECIAL_REQUESTS.reduce((s, r) => s + r.count, 0)} total
                  </span>
                </div>
                <div>
                  {SPECIAL_REQUESTS.map((r) => (
                    <div key={r.label} className="flex items-center gap-3 border-b border-cortai-border/30 px-4 py-2.5 last:border-0">
                      <div className="text-[14px]">{r.ico}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-cortai-text">{r.label}</div>
                        <div className="text-[9px] text-cortai-text3">{r.note}</div>
                      </div>
                      <div className="font-mono text-[13px] font-bold" style={{ color: "#f59e0b" }}>{r.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Pre-arrival comms strip */}
          <div className="rounded-xl border border-cortai-border p-4" style={{ background: "#080f1d" }}>
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em] text-cortai-text3">Pre-Arrival Communications</div>
            <div className="grid grid-cols-4 gap-3">
              {[
                { v: "28", l: "Welcome Sent",      c: "#10b981" },
                { v: "14", l: "Mobile Key",         c: "#00c4a3" },
                { v: "6",  l: "No Opt-in",          c: "#f59e0b" },
                { v: "3",  l: "Upgrades Accepted",  c: "#3b82f6" },
              ].map(({ v, l, c }) => (
                <div key={l} className="rounded-lg border border-cortai-border p-3 text-center">
                  <div className="font-mono text-[22px] font-bold leading-none" style={{ color: c }}>{v}</div>
                  <div className="mt-1.5 text-[9px] uppercase tracking-[0.07em] text-cortai-text3">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {/* ═══════════════════════════════════════════════════════════════════
          IN-HOUSE TAB
      ═══════════════════════════════════════════════════════════════════ */}
      {tab === "in_hotel" ? (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Rooms Occupied",     v: inHouseItems.length,    sub: "checked-in now",              c: "#3b82f6" },
              { label: "VIP / Elite Guests", v: inHouseVipCount,        sub: "marked VIP",                  c: "#c9a84c" },
              { label: "Departing Today",    v: departuresItems.length,  sub: `${departedCount} already out`, c: "#f59e0b" },
              { label: "Checked In Today",   v: checkedInCount,          sub: "arrived today",               c: "#10b981" },
            ].map(({ label, v, sub, c }) => (
              <div key={label} className="rounded-xl border border-cortai-border px-4 py-3" style={{ background: "rgba(255,255,255,.02)" }}>
                <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">{label}</div>
                <div className="mt-1 font-mono text-[24px] font-bold leading-none" style={{ color: c }}>{v}</div>
                <div className="mt-1 text-[9px] text-cortai-text3">{sub}</div>
              </div>
            ))}
          </div>

          {/* In-House Table */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#3b82f6" fill="none" strokeWidth="1.5">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              </svg>
              <span className="text-[13px] font-semibold text-cortai-text">In-House Guests</span>
              <span className="ml-auto text-[10px] text-cortai-text3">{inHouseItems.length} rooms occupied</span>
            </div>
            <div
              className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
              style={{ gridTemplateColumns: "70px 1fr 90px 90px 44px 60px", background: "rgba(255,255,255,.02)" }}
            >
              <div>Room</div>
              <div>Guest</div>
              <div>Arr.</div>
              <div>Due Out</div>
              <div className="text-center">Nts</div>
              <div>Tier</div>
            </div>
            {inHouseItems.length === 0 ? (
              <EmptyState
                message={loading ? "Loading…" : "No guests currently in-house"}
                testId="in-hotel-empty"
              />
            ) : inHouseItems.map((r) => {
              const isVip = r.guest.vip;
              const nights = calcNights(r.check_in_at, r.check_out_at);
              return (
                <div
                  key={r.reservation_id}
                  className="grid items-center border-b border-cortai-border/30 px-4 py-2.5 text-[11px] last:border-0"
                  style={{
                    gridTemplateColumns: "70px 1fr 90px 90px 44px 60px",
                    background: isVip ? "linear-gradient(90deg,rgba(201,168,76,.04),transparent 60%)" : "transparent",
                    borderLeft: isVip ? "3px solid rgba(201,168,76,.4)" : "3px solid transparent",
                  }}
                >
                  <div className="font-mono font-bold" style={{ color: r.room_number ? "#00c4a3" : "#4d7088" }}>
                    {r.room_number ?? "—"}
                  </div>
                  <div>
                    <div className="flex items-center gap-1 font-semibold text-cortai-text">
                      {guestLabel(r.guest)}
                      {isVip ? <span className="text-[10px]">⭐</span> : null}
                    </div>
                    <div className="font-mono text-[9px] text-cortai-text3">{r.reservation_id.slice(0, 8)}</div>
                  </div>
                  <div className="text-[10px] text-cortai-text2">{fmtShortDate(r.check_in_at)}</div>
                  <div className="font-mono text-[10px]" style={{ color: "#f59e0b" }}>{fmtShortDate(r.check_out_at)}</div>
                  <div className="text-center font-mono text-[10px] text-cortai-text2">{nights}</div>
                  <div>
                    <span
                      className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                      style={isVip
                        ? { background: "rgba(201,168,76,.14)", color: "#c9a84c" }
                        : { background: "rgba(148,163,184,.08)", color: "#94a3b8" }
                      }
                    >
                      {isVip ? "VIP" : "GUEST"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {/* ═══════════════════════════════════════════════════════════════════
          DEPARTURES TAB
      ═══════════════════════════════════════════════════════════════════ */}
      {tab === "departures" ? (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Departures Today", v: departuresItems.length, sub: "total checkouts",        c: "#3b82f6" },
              { label: "Checked Out",      v: departedCount,           sub: "completed departures",   c: "#10b981" },
              { label: "Still In Hotel",   v: stillInCount,            sub: "expected by 11 AM",      c: "#f59e0b" },
            ].map(({ label, v, sub, c }) => (
              <div key={label} className="rounded-xl border border-cortai-border px-4 py-3" style={{ background: "rgba(255,255,255,.02)" }}>
                <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">{label}</div>
                <div className="mt-1 font-mono text-[24px] font-bold leading-none" style={{ color: c }}>{v}</div>
                <div className="mt-1 text-[9px] text-cortai-text3">{sub}</div>
              </div>
            ))}
          </div>

          {/* Departures table */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
              <span className="text-[13px] font-semibold text-cortai-text">Departures — {todayLabel}</span>
            </div>
            <div
              className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
              style={{ gridTemplateColumns: "70px 1fr 90px 90px 44px 90px", background: "rgba(255,255,255,.02)" }}
            >
              <div>Room</div>
              <div>Guest</div>
              <div>Checked In</div>
              <div>Due Out</div>
              <div className="text-center">Nts</div>
              <div>Status</div>
            </div>
            {departuresItems.length === 0 ? (
              <EmptyState
                message={loading ? "Loading…" : "No departures today"}
                testId="departures-empty"
              />
            ) : departuresItems.map((r) => {
              const sc = getStatusCfg(r.status);
              const isVip = r.guest.vip;
              const nights = calcNights(r.check_in_at, r.check_out_at);
              return (
                <div
                  key={r.reservation_id}
                  className="grid items-center border-b border-cortai-border/30 px-4 py-2.5 text-[11px] last:border-0"
                  style={{
                    gridTemplateColumns: "70px 1fr 90px 90px 44px 90px",
                    background: r.status === "checked_out" ? "rgba(16,185,129,.02)" : "transparent",
                  }}
                >
                  <div className="font-mono font-bold" style={{ color: r.room_number ? "#00c4a3" : "#4d7088" }}>
                    {r.room_number ?? "—"}
                  </div>
                  <div>
                    <div className="flex items-center gap-1 font-semibold text-cortai-text">
                      {guestLabel(r.guest)}
                      {isVip ? <span className="text-[10px]">⭐</span> : null}
                    </div>
                    <div className="font-mono text-[9px] text-cortai-text3">{r.reservation_id.slice(0, 8)}</div>
                  </div>
                  <div className="text-[10px] text-cortai-text2">{fmtShortDate(r.check_in_at)}</div>
                  <div className="font-mono text-[10px]" style={{ color: r.status === "checked_out" ? "#10b981" : "#f59e0b" }}>
                    {fmtTime(r.check_out_at)}
                  </div>
                  <div className="text-center font-mono text-[10px] text-cortai-text2">{nights}</div>
                  <div>
                    <span
                      className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                      style={{ background: sc.bg, color: sc.col }}
                    >
                      {sc.lbl}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {/* ═══════════════════════════════════════════════════════════════════
          QUEUE TAB
      ═══════════════════════════════════════════════════════════════════ */}
      {tab === "queue" ? (
        <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
          <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
            </svg>
            <span className="text-[13px] font-semibold text-cortai-text">Queue</span>
            <span className="ml-2 text-[11px] text-cortai-text3">{t("queueCount", { count: queueCount })}</span>
          </div>
          <div
            className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
            style={{ gridTemplateColumns: "44px 1fr 140px 100px", background: "rgba(255,255,255,.02)" }}
          >
            <div>#</div>
            <div>Guest</div>
            <div>Started</div>
            <div>Action</div>
          </div>
          {(queue?.items ?? []).length === 0 ? (
            <EmptyState
              message={loading ? t("loading") : t("queue.empty")}
              testId="queue-empty"
            />
          ) : (queue?.items ?? []).map((item) => (
            <div
              key={item.event_id}
              className="grid items-center border-b border-cortai-border/30 px-4 py-3 text-[11px] last:border-0"
              style={{ gridTemplateColumns: "44px 1fr 140px 100px" }}
            >
              <div className="font-mono font-bold" style={{ color: "#00c4a3" }}>#{item.queue_position}</div>
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-cortai-text">
                  {item.guest.first_name} {item.guest.last_name}
                  {item.guest.vip ? (
                    <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "rgba(201,168,76,.15)", color: "#c9a84c" }}>
                      {t("vip")}
                    </span>
                  ) : null}
                </div>
                <div className="font-mono text-[9px] text-cortai-text3">{item.reservation_id.slice(0, 8)}</div>
              </div>
              <div className="text-[10px] text-cortai-text3">
                {new Date(item.started_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </div>
              <div>
                <button
                  type="button"
                  className="rounded-md px-2.5 py-1 text-[10px] font-semibold text-white transition hover:opacity-80"
                  style={{ background: "#10b981" }}
                  onClick={async () => {
                    await apiFetch<unknown>("/api/operations/front-desk/queue/serve", {
                      method: "POST",
                      body: JSON.stringify({ property_id: propertyId }),
                    });
                    await loadAll();
                  }}
                >
                  {t("queue.serve")}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Walk-In Modal ──────────────────────────────────────────────── */}
      <Modal open={walkInOpen} title={t("walkInModal.title")} closeLabel={t("close")} onClose={() => setWalkInOpen(false)}>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <label className="text-xs text-cortai-text2">{t("walkInModal.firstName")}</label>
            <input
              value={walkInFirstName}
              onChange={(e) => setWalkInFirstName(e.target.value)}
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs outline-none focus:border-cortai-teal"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs text-cortai-text2">{t("walkInModal.lastName")}</label>
            <input
              value={walkInLastName}
              onChange={(e) => setWalkInLastName(e.target.value)}
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs outline-none focus:border-cortai-teal"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs text-cortai-text2">{t("walkInModal.roomId")}</label>
            <input
              value={walkInRoomId}
              onChange={(e) => setWalkInRoomId(e.target.value)}
              placeholder="e.g. 8339ad2c-..."
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs outline-none focus:border-cortai-teal"
            />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setWalkInOpen(false)}>
              {t("close")}
            </Button>
            <Button
              type="button"
              className="ml-auto"
              onClick={() => void submitWalkIn()}
              disabled={!walkInFirstName.trim() || !walkInLastName.trim() || !walkInRoomId.trim() || loading}
            >
              {t("walkInModal.submit")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Check-In Modal ─────────────────────────────────────────────── */}
      <Modal
        open={checkInReservation !== null}
        title={t("checkInModal.title")}
        closeLabel={t("close")}
        onClose={() => { setCheckInReservation(null); setCheckInRoomId(""); }}
      >
        <div className="grid gap-3">
          {checkInReservation ? (
            <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-3 text-xs text-cortai-text2">
              <div className="font-semibold text-cortai-text">
                {checkInReservation.guest.first_name} {checkInReservation.guest.last_name}
              </div>
              <div className="mt-0.5">{checkInReservation.reservation_id}</div>
              <div className="mt-0.5">
                {fmtShortDate(checkInReservation.check_in_at)} → {fmtShortDate(checkInReservation.check_out_at)}
                {" · "}{calcNights(checkInReservation.check_in_at, checkInReservation.check_out_at)} nights
              </div>
            </div>
          ) : null}
          <div className="grid gap-1">
            <label className="text-xs text-cortai-text2">{t("checkInModal.roomId")}</label>
            <input
              value={checkInRoomId}
              onChange={(e) => setCheckInRoomId(e.target.value)}
              placeholder="e.g. 8339ad2c-..."
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs outline-none focus:border-cortai-teal"
            />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setCheckInReservation(null); setCheckInRoomId(""); }}
            >
              {t("close")}
            </Button>
            <Button
              type="button"
              className="ml-auto"
              onClick={() => void submitCheckIn()}
              disabled={!checkInRoomId.trim() || loading}
            >
              {t("checkInModal.submit")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
