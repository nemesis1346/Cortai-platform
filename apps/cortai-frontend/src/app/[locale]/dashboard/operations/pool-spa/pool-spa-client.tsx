"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { DateTimeInput, toDatetimeLocal } from "@/components/ui/DateTimeInput";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type PoolCapacity = {
  property_id: string;
  count: number;
  capacity: number;
  status: string;
  last_updated: string | null;
};

type PoolSpaStatus = {
  property_id: string;
  pool_count: number;
  pool_capacity: number;
  pool_total_today: number;
  pool_avg_dwell_min: number;
  pool_temp_f: number;
  pool_humidity_pct: number;
  pool_room_temp_f: number;
  spa_count: number;
  spa_capacity: number;
  spa_total_today: number;
  spa_avg_session_min: number;
  hot_tub_temp_f: number;
  status: string;
  last_updated: string | null;
};

type SpaService = {
  id: string;
  org_id: string;
  property_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  available: boolean;
  created_at: string;
  updated_at: string;
};
type SpaServiceList = { items: SpaService[] };

type SpaAppointment = {
  id: string;
  org_id: string;
  property_id: string;
  guest_id: string;
  service: string;
  therapist_user_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string | null;
  created_at: string;
  updated_at: string;
};
type SpaAppointmentList = { items: SpaAppointment[]; total: number; page: number; page_size: number };

type TabKey = "today" | "services" | "appointments";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}

function dollars(cents: number) { return (cents / 100).toFixed(2); }

function fmtTs(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function fmtTime(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function statusColor(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "busy")       return "#ef4444";
  if (s === "moderate")   return "#f59e0b";
  if (s === "quiet")      return "#10b981";
  return "#94a3b8";
}

function apptStatusCfg(status: string | null): { col: string; bg: string } {
  const s = (status ?? "").toLowerCase();
  if (s === "booked")     return { col: "#3b82f6", bg: "rgba(59,130,246,.12)" };
  if (s === "confirmed")  return { col: "#00c4a3", bg: "rgba(0,196,163,.12)" };
  if (s === "completed")  return { col: "#10b981", bg: "rgba(16,185,129,.12)" };
  if (s === "cancelled")  return { col: "#ef4444", bg: "rgba(239,68,68,.12)" };
  return { col: "#94a3b8", bg: "rgba(148,163,184,.10)" };
}

function poolOccupancyPct(count: number, capacity: number) {
  if (capacity <= 0) return 0;
  return Math.min(100, Math.round((count / capacity) * 100));
}

// ── Demo traffic data (no time-series backend) ─────────────────────────────
const DEMO_POOL_POINTS = [40, 40, 60, 95, 100, 100, 85, 65, 55, 50, 45, 40, 35, 30] as const;
const DEMO_SPA_POINTS  = [10, 15, 25, 35, 50,  60,  65, 60, 55, 50, 45, 40, 35, 30] as const;
const DEMO_HOURS       = ["6am","7am","8am","9am","10am","11am","12pm","1pm","2pm","3pm","4pm","5pm","6pm","7pm"] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export function PoolSpaClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.poolSpa");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [pool, setPool]           = useState<PoolCapacity | null>(null);
  const [poolStatus, setPoolStatus] = useState<PoolSpaStatus | null>(null);
  const [services, setServices]   = useState<SpaService[]>([]);
  const [appointments, setAppointments] = useState<SpaAppointmentList | null>(null);
  const [appointmentsView, setAppointmentsView] = useState<"list" | "calendar">("list");

  const loadAll = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const [pc, ps, sv, ap] = await Promise.all([
        apiFetch<PoolCapacity>(`/api/operations/pool/capacity?property_id=${pid}`),
        apiFetch<PoolSpaStatus>(`/api/operations/pool/status?property_id=${pid}`),
        apiFetch<SpaServiceList>(`/api/operations/spa/services?property_id=${pid}`),
        apiFetch<SpaAppointmentList>(`/api/operations/spa/appointments?property_id=${pid}&page=1&page_size=50`),
      ]);
      setPool(pc);
      setPoolStatus(ps);
      setServices(sv.items);
      setAppointments(ap);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const calendarGroups = useMemo(() => {
    const items = appointments?.items ?? [];
    const m = new Map<string, SpaAppointment[]>();
    for (const a of items) {
      const d = new Date(a.starts_at);
      const key = Number.isNaN(d.getTime()) ? a.starts_at.slice(0, 10) : d.toISOString().slice(0, 10);
      m.set(key, [...(m.get(key) ?? []), a]);
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [appointments?.items]);

  const upcomingAppts = useMemo(() => {
    const now = Date.now();
    return (appointments?.items ?? [])
      .filter((a) => new Date(a.starts_at).getTime() >= now - 3600000)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, 5);
  }, [appointments?.items]);

  // ── Service form ──────────────────────────────────────────────────────────
  const [svcOpen, setSvcOpen] = useState(false);
  const svcSchema = useMemo(
    () =>
      z.object({
        name:             z.string().min(1).max(180),
        description:      z.string().max(500).optional().or(z.literal("")),
        duration_minutes: z.coerce.number().int().min(0),
        price_cents:      z.coerce.number().int().min(0),
        available:        z.boolean(),
      }),
    [],
  );
  type SvcForm = z.infer<typeof svcSchema>;
  const svcForm = useForm<SvcForm>({
    resolver: zodResolver(svcSchema),
    defaultValues: { name: "", description: "", duration_minutes: 60, price_cents: 0, available: true },
  });

  async function submitService(values: SvcForm) {
    if (!propertyId) return;
    setLoading(true);
    try {
      await apiFetch<SpaService>("/api/operations/spa/services", {
        method: "POST",
        body: JSON.stringify({
          property_id: propertyId,
          name: values.name,
          description: values.description ? values.description : null,
          duration_minutes: values.duration_minutes,
          price_cents: values.price_cents,
          available: values.available,
        }),
      });
      notify({ title: t("toast.serviceCreated.title"), description: t("toast.serviceCreated.description"), tone: "success" });
      setSvcOpen(false);
      svcForm.reset({ name: "", description: "", duration_minutes: 60, price_cents: 0, available: true });
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  // ── Appointment form ──────────────────────────────────────────────────────
  const [apptOpen, setApptOpen]         = useState(false);
  const [apptEditing, setApptEditing]   = useState<SpaAppointment | null>(null);
  const [apptDetail, setApptDetail]     = useState<SpaAppointment | null>(null);

  const apptSchema = useMemo(
    () =>
      z.object({
        guest_id:  z.string().uuid(),
        service:   z.string().min(1).max(120),
        starts_at: z.string().min(1),
        ends_at:   z.string().min(1),
        status:    z.string().max(32).optional().or(z.literal("")),
      }),
    [],
  );
  type ApptForm = z.infer<typeof apptSchema>;
  const apptForm = useForm<ApptForm>({
    resolver: zodResolver(apptSchema),
    defaultValues: { guest_id: "", service: "", starts_at: "", ends_at: "", status: "booked" },
  });

  function openNewAppt() {
    setApptEditing(null);
    apptForm.reset({ guest_id: "", service: "", starts_at: "", ends_at: "", status: "booked" });
    setApptOpen(true);
  }

  function openEditAppt(a: SpaAppointment) {
    setApptEditing(a);
    apptForm.reset({ guest_id: a.guest_id, service: a.service, starts_at: toDatetimeLocal(a.starts_at), ends_at: toDatetimeLocal(a.ends_at), status: a.status ?? "" });
    setApptOpen(true);
  }

  async function submitAppt(values: ApptForm) {
    if (!propertyId) return;
    setLoading(true);
    try {
      if (apptEditing) {
        await apiFetch<SpaAppointment>(`/api/operations/spa/appointments/${encodeURIComponent(apptEditing.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ guest_id: values.guest_id, service: values.service, starts_at: values.starts_at, ends_at: values.ends_at, status: values.status ? values.status : null }),
        });
        notify({ title: t("toast.apptUpdated.title"), description: t("toast.apptUpdated.description"), tone: "success" });
      } else {
        await apiFetch<SpaAppointment>("/api/operations/spa/appointments", {
          method: "POST",
          body: JSON.stringify({ property_id: propertyId, guest_id: values.guest_id, service: values.service, starts_at: values.starts_at, ends_at: values.ends_at, status: values.status ? values.status : null }),
        });
        notify({ title: t("toast.apptCreated.title"), description: t("toast.apptCreated.description"), tone: "success" });
      }
      setApptOpen(false);
      setApptEditing(null);
      await loadAll();
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

  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const poolPct  = poolStatus ? poolOccupancyPct(poolStatus.pool_count, poolStatus.pool_capacity) : 0;
  const spaPct   = poolStatus ? poolOccupancyPct(poolStatus.spa_count,  poolStatus.spa_capacity)  : 0;
  const sc       = statusColor(poolStatus?.status ?? pool?.status);

  // SVG chart helpers
  const chartW = 680; const chartH = 160; const chartPad = 40;
  function chartY(pct: number) { return chartH - 10 - ((pct / 100) * (chartH - 20)); }
  function chartX(i: number)   { return chartPad + (i / (DEMO_POOL_POINTS.length - 1)) * (chartW - chartPad); }
  const poolPath = DEMO_POOL_POINTS.map((p, i) => `${i === 0 ? "M" : "L"}${chartX(i)},${chartY(p)}`).join(" ");
  const spaPath  = DEMO_SPA_POINTS.map((p,  i) => `${i === 0 ? "M" : "L"}${chartX(i)},${chartY(p)}`).join(" ");
  const poolArea = `${poolPath} L${chartX(DEMO_POOL_POINTS.length - 1)},${chartH} L${chartPad},${chartH} Z`;
  const spaArea  = `${spaPath}  L${chartX(DEMO_SPA_POINTS.length  - 1)},${chartH} L${chartPad},${chartH} Z`;

  return (
    <div className="grid gap-4" data-testid="pool-spa-page">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-cortai-text">{t("title")}</h1>
          <p className="text-[11px] text-cortai-text3">{todayLabel} · {t("subtitle")}</p>
        </div>
        <div className="ml-auto">
          <Button type="button" variant="ghost" onClick={() => void loadAll()} disabled={loading}>{t("refresh")}</Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-cortai-red">{error}</div>
      ) : null}

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-xl border border-cortai-border p-1" style={{ background: "rgba(255,255,255,.02)" }}>
        {([
          { key: "today" as TabKey,        label: "Today",        count: poolStatus ? `${poolStatus.pool_count + poolStatus.spa_count} in venue` : undefined, icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg> },
          { key: "services" as TabKey,     label: "Services",     count: services.length > 0 ? `${services.length} services` : undefined,                      icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg> },
          { key: "appointments" as TabKey, label: "Appointments", count: appointments?.total ? `${appointments.total} total` : undefined,                       icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
        ] as { key: TabKey; label: string; count?: string; icon: React.ReactNode }[]).map(({ key, label, count, icon }) => (
          <button
            key={key}
            type="button"
            data-testid={`tab-${key}`}
            onClick={() => setActiveTab(key)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold transition"
            style={{
              background: activeTab === key ? "rgba(0,196,163,.12)" : "transparent",
              color:      activeTab === key ? "#00c4a3" : "#4d7088",
              border:    `1px solid ${activeTab === key ? "rgba(0,196,163,.25)" : "transparent"}`,
            }}
          >
            {icon}{label}
            {count ? (
              <span className="rounded-full px-1.5 py-0.5 font-mono text-[9px]"
                style={{ background: activeTab === key ? "rgba(0,196,163,.18)" : "rgba(255,255,255,.05)", color: activeTab === key ? "#00c4a3" : "#4d7088" }}>
                {count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          TAB: TODAY
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "today" && (
        <>
          {/* 6 KPI tiles */}
          <div className="grid grid-cols-6 gap-3">
            {[
              { label: "In Pool Now",   v: poolStatus ? `${poolStatus.pool_count}` : (pool?.count ?? "—"),                c: "#00c4a3" },
              { label: "Total Today",   v: poolStatus?.pool_total_today ?? "—",                                           c: "#c8dce8" },
              { label: "Pool Temp",     v: poolStatus ? `${poolStatus.pool_temp_f}°F` : "—",                              c: "#00c4a3" },
              { label: "Hot Tub Temp",  v: poolStatus ? `${poolStatus.hot_tub_temp_f}°F` : "—",                           c: poolStatus && poolStatus.hot_tub_temp_f > 104 ? "#ef4444" : "#f59e0b" },
              { label: "Room Temp / RH",v: poolStatus ? `${poolStatus.pool_room_temp_f}°F / ${poolStatus.pool_humidity_pct}%` : "—", c: "#3b82f6" },
              { label: "Status",        v: poolStatus?.status ?? pool?.status ?? "—",                                     c: sc },
            ].map(({ label, v, c }) => (
              <div key={label} data-testid={`kpi-tile-${label.toLowerCase().replace(/ /g, "-")}`} className="rounded-xl border border-cortai-border px-3 py-3" style={{ background: "rgba(255,255,255,.02)" }}>
                <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">{label}</div>
                <div className="mt-1 font-mono text-[18px] font-bold leading-none" style={{ color: c }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Main grid */}
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 280px" }}>

            {/* Traffic chart (demo) */}
            <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
              <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
                <span className="text-[13px] font-semibold text-cortai-text">Traffic Throughout the Day</span>
                <div className="ml-auto flex items-center gap-3">
                  <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-[#00c4a3]"/><span className="text-[10px] text-cortai-text3">Pool</span></div>
                  <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-sm bg-[#f59e0b]"/><span className="text-[10px] text-cortai-text3">Spa</span></div>
                  <span className="rounded px-1.5 py-0.5 text-[9px] text-cortai-text3" style={{ background: "rgba(255,255,255,.05)" }}>demo</span>
                </div>
              </div>
              <div className="p-4">
                <svg viewBox={`0 0 ${chartW} ${chartH + 20}`} width="100%" style={{ overflow: "visible" }}>
                  <defs>
                    <linearGradient id="poolGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00c4a3" stopOpacity="0.2"/>
                      <stop offset="100%" stopColor="#00c4a3" stopOpacity="0.01"/>
                    </linearGradient>
                    <linearGradient id="spaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.15"/>
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.01"/>
                    </linearGradient>
                  </defs>
                  {[0, 25, 50, 75, 100].map((pct) => (
                    <g key={pct}>
                      <line x1={chartPad} y1={chartY(pct)} x2={chartW} y2={chartY(pct)} stroke="rgba(255,255,255,.05)" strokeWidth="1" strokeDasharray="4,4"/>
                      <text x={chartPad - 5} y={chartY(pct) + 4} fontSize="9" fill="#4d7088" textAnchor="end" fontFamily="monospace">{pct}%</text>
                    </g>
                  ))}
                  {DEMO_HOURS.map((label, i) => (
                    <text key={label} x={chartX(i)} y={chartH + 18} fontSize="9" fill="#4d607e" textAnchor="middle" fontFamily="monospace">{label}</text>
                  ))}
                  <path d={poolArea} fill="url(#poolGrad)"/>
                  <path d={spaArea}  fill="url(#spaGrad)"/>
                  <path d={poolPath} fill="none" stroke="#00c4a3" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
                  <path d={spaPath}  fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
                  {DEMO_POOL_POINTS.map((p, i) => (
                    <circle key={i} cx={chartX(i)} cy={chartY(p)} r="3" fill="#080f1d" stroke="#00c4a3" strokeWidth="2"/>
                  ))}
                  {DEMO_SPA_POINTS.map((p, i) => (
                    <rect key={i} x={chartX(i) - 3} y={chartY(p) - 3} width="6" height="6" fill="#f59e0b" rx="1"/>
                  ))}
                </svg>
              </div>
            </div>

            {/* Right: Pool + Spa panels */}
            <div className="flex flex-col gap-3">

              {/* Pool Panel */}
              <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
                <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-2.5">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                    <path d="M2 12h20M2 12c0 5.52 4.48 10 10 10S22 17.52 22 12"/><path d="M7 12v-2a5 5 0 0110 0v2"/>
                  </svg>
                  <span className="text-[13px] font-semibold text-cortai-text">Pool</span>
                  <span className="ml-auto text-[9px] text-cortai-text3">{poolStatus ? `max ${poolStatus.pool_capacity}` : ""}</span>
                </div>
                <div className="p-4">
                  {!poolStatus ? (
                    <EmptyState message={loading ? t("loading") : t("empty")} className="py-4" testId="pool-status-empty" />
                  ) : (
                    <>
                      <div className="mb-3 flex items-center gap-4">
                        <div>
                          <div className="font-mono text-[28px] font-bold leading-none" style={{ color: "#00c4a3" }}>{poolStatus.pool_count}</div>
                          <div className="mt-1 text-[9px] text-cortai-text3">in pool now</div>
                        </div>
                        {/* Donut */}
                        <div className="relative ml-auto h-12 w-12 shrink-0">
                          <svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: "rotate(-90deg)" }}>
                            <circle cx="24" cy="24" r="18" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="5"/>
                            <circle cx="24" cy="24" r="18" fill="none" stroke="#00c4a3" strokeWidth="5"
                              strokeLinecap="round" strokeDasharray="113.1"
                              strokeDashoffset={(113.1 * (1 - poolPct / 100)).toFixed(1)}/>
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold" style={{ color: "#00c4a3" }}>{poolPct}%</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: "Temp",       v: `${poolStatus.pool_temp_f}°F`, c: "#00c4a3" },
                          { label: "Avg Dwell",  v: `${poolStatus.pool_avg_dwell_min}m`, c: "#c8dce8" },
                          { label: "Humidity",   v: `${poolStatus.pool_humidity_pct}%`,  c: "#3b82f6" },
                          { label: "Total Today",v: `${poolStatus.pool_total_today}`,    c: "#c8dce8" },
                        ].map(({ label, v, c }) => (
                          <div key={label} className="rounded-lg border border-cortai-border/40 px-2.5 py-2" style={{ background: "rgba(255,255,255,.02)" }}>
                            <div className="font-mono text-[13px] font-bold" style={{ color: c }}>{v}</div>
                            <div className="text-[9px] text-cortai-text3">{label}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Spa / Hot Tub Panel */}
              <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
                <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-2.5">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#f59e0b" fill="none" strokeWidth="1.5">
                    <path d="M8 3l4 8 5-5 5 15H2L8 3z"/>
                  </svg>
                  <span className="text-[13px] font-semibold text-cortai-text">Spa / Hot Tub</span>
                  <span className="ml-auto text-[9px] text-cortai-text3">{poolStatus ? `max ${poolStatus.spa_capacity}` : ""}</span>
                </div>
                <div className="p-4">
                  {!poolStatus ? (
                    <EmptyState message={loading ? t("loading") : t("empty")} className="py-4" testId="spa-status-empty" />
                  ) : (
                    <>
                      <div className="mb-3 flex items-center gap-4">
                        <div>
                          <div className="font-mono text-[28px] font-bold leading-none" style={{ color: "#f59e0b" }}>{poolStatus.spa_count}</div>
                          <div className="mt-1 text-[9px] text-cortai-text3">in spa now</div>
                        </div>
                        <div className="relative ml-auto h-12 w-12 shrink-0">
                          <svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: "rotate(-90deg)" }}>
                            <circle cx="24" cy="24" r="18" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="5"/>
                            <circle cx="24" cy="24" r="18" fill="none" stroke="#f59e0b" strokeWidth="5"
                              strokeLinecap="round" strokeDasharray="113.1"
                              strokeDashoffset={(113.1 * (1 - spaPct / 100)).toFixed(1)}/>
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold" style={{ color: "#f59e0b" }}>{spaPct}%</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: "Hot Tub Temp",  v: `${poolStatus.hot_tub_temp_f}°F`,   c: poolStatus.hot_tub_temp_f > 104 ? "#ef4444" : "#f59e0b" },
                          { label: "Avg Session",   v: `${poolStatus.spa_avg_session_min}m`, c: "#c8dce8" },
                          { label: "Total Today",   v: `${poolStatus.spa_total_today}`,       c: "#c8dce8" },
                          { label: "Room Temp",     v: `${poolStatus.pool_room_temp_f}°F`,    c: "#10b981" },
                        ].map(({ label, v, c }) => (
                          <div key={label} className="rounded-lg border border-cortai-border/40 px-2.5 py-2" style={{ background: "rgba(255,255,255,.02)" }}>
                            <div className="font-mono text-[13px] font-bold" style={{ color: c }}>{v}</div>
                            <div className="text-[9px] text-cortai-text3">{label}</div>
                          </div>
                        ))}
                      </div>
                      {poolStatus.hot_tub_temp_f > 104 ? (
                        <div className="mt-2 rounded-md border border-orange-500/25 bg-orange-500/08 px-3 py-2 text-[10px]" style={{ color: "#f59e0b" }}>
                          Above optimal — monitor hot tub temperature
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* Upcoming appointments */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#8b5cf6" fill="none" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <span className="text-[13px] font-semibold text-cortai-text">Upcoming Spa Appointments</span>
              <button
                type="button"
                onClick={() => setActiveTab("appointments")}
                className="ml-auto text-[10px] transition hover:text-cortai-text"
                style={{ color: "#4d7088" }}
              >
                View all →
              </button>
            </div>
            {upcomingAppts.length === 0 ? (
              <EmptyState message="No upcoming appointments" className="px-4 py-6" testId="upcoming-appts-empty" />
            ) : (
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                {upcomingAppts.map((a) => {
                  const cfg = apptStatusCfg(a.status);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setApptDetail(a)}
                      className="flex flex-col gap-1 border-r border-cortai-border/30 p-4 text-left transition last:border-r-0 hover:bg-white/[.01]"
                    >
                      <div className="text-[11px] font-semibold text-cortai-text">{a.service}</div>
                      <div className="text-[9px] text-cortai-text3">{fmtTime(a.starts_at)} → {fmtTime(a.ends_at)}</div>
                      <div className="mt-1">
                        <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                          style={{ background: cfg.bg, color: cfg.col }}>
                          {(a.status ?? "unknown").toUpperCase()}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: SERVICES
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "services" && (
        <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
          <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              <polyline points="9,22 9,12 15,12 15,22"/>
            </svg>
            <span className="text-[13px] font-semibold text-cortai-text">{t("services.title")}</span>
            {services.length > 0 ? (
              <span className="rounded-full px-2 py-0.5 font-mono text-[9px]"
                style={{ background: "rgba(0,196,163,.1)", color: "#00c4a3" }}>{services.length}</span>
            ) : null}
            <button
              type="button"
              onClick={() => setSvcOpen(true)}
              data-testid="pool-spa-service-new"
              className="ml-auto rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90"
              style={{ background: "#00c4a3" }}
            >
              + {t("services.new")}
            </button>
          </div>

          {/* Column headers */}
          <div
            className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
            style={{ gridTemplateColumns: "1.5fr 80px 80px 70px 1fr", background: "rgba(255,255,255,.02)" }}
          >
            <div>{t("services.cols.name")}</div>
            <div>{t("services.cols.duration")}</div>
            <div>{t("services.cols.price")}</div>
            <div>{t("services.cols.available")}</div>
            <div>{t("services.cols.updated")}</div>
          </div>

          {services.length === 0 ? (
            <EmptyState message={loading ? t("loading") : t("services.empty")} testId="services-empty" />
          ) : services.map((s) => (
            <div
              key={s.id}
              className="grid items-center border-b border-cortai-border/30 px-4 py-3 text-[11px] last:border-0 hover:bg-white/[.01]"
              style={{ gridTemplateColumns: "1.5fr 80px 80px 70px 1fr" }}
            >
              <div>
                <div className="font-medium text-cortai-text">{s.name}</div>
                {s.description ? <div className="text-[9px] text-cortai-text3 truncate">{s.description}</div> : null}
              </div>
              <div className="font-mono text-cortai-text2">{t("services.minutes", { minutes: s.duration_minutes })}</div>
              <div className="font-mono text-cortai-text2">${dollars(s.price_cents)}</div>
              <div>
                <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                  style={{ background: s.available ? "rgba(16,185,129,.12)" : "rgba(148,163,184,.10)", color: s.available ? "#10b981" : "#94a3b8" }}>
                  {s.available ? "YES" : "NO"}
                </span>
              </div>
              <div className="text-[10px] text-cortai-text3">{fmtTs(s.updated_at)}</div>
            </div>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: APPOINTMENTS
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "appointments" && (
        <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
          <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#8b5cf6" fill="none" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span className="text-[13px] font-semibold text-cortai-text">{t("appointments.title")}</span>
            {appointments?.total ? (
              <span className="rounded-full px-2 py-0.5 font-mono text-[9px]"
                style={{ background: "rgba(139,92,246,.12)", color: "#8b5cf6" }}>{appointments.total}</span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {(["list", "calendar"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  data-testid={`view-toggle-${v}`}
                  onClick={() => setAppointmentsView(v)}
                  className="rounded-md px-2.5 py-1 text-[10px] font-semibold transition"
                  style={{
                    background: appointmentsView === v ? "rgba(139,92,246,.15)" : "rgba(255,255,255,.04)",
                    color:      appointmentsView === v ? "#8b5cf6" : "#4d7088",
                    border:    `1px solid ${appointmentsView === v ? "rgba(139,92,246,.3)" : "rgba(255,255,255,.06)"}`,
                  }}
                >
                  {t(`appointments.view.${v}`)}
                </button>
              ))}
              <button
                type="button"
                onClick={openNewAppt}
                data-testid="pool-spa-appt-new"
                className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90"
                style={{ background: "#8b5cf6" }}
              >
                + {t("appointments.new")}
              </button>
            </div>
          </div>

          {/* List view */}
          {appointmentsView === "list" && (
            <>
              <div
                className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
                style={{ gridTemplateColumns: "1.2fr 90px 1fr 1fr 80px 1fr", background: "rgba(255,255,255,.02)" }}
              >
                <div>{t("appointments.cols.service")}</div>
                <div>{t("appointments.cols.guest")}</div>
                <div>{t("appointments.cols.starts")}</div>
                <div>{t("appointments.cols.ends")}</div>
                <div>{t("appointments.cols.status")}</div>
                <div>{t("appointments.cols.actions")}</div>
              </div>
              {(appointments?.items ?? []).length === 0 ? (
                <EmptyState message={loading ? t("loading") : t("appointments.empty")} testId="appointments-list-empty" />
              ) : (appointments?.items ?? []).map((a) => {
                const cfg = apptStatusCfg(a.status);
                return (
                  <div
                    key={a.id}
                    data-testid={`appt-row-${a.id}`}
                    className="grid items-center border-b border-cortai-border/30 px-4 py-2.5 text-[11px] last:border-0 hover:bg-white/[.01]"
                    style={{ gridTemplateColumns: "1.2fr 90px 1fr 1fr 80px 1fr" }}
                  >
                    <div>
                      <div className="font-medium text-cortai-text">{a.service}</div>
                      <div className="font-mono text-[9px] text-cortai-text3">{a.id.slice(0, 8)}</div>
                    </div>
                    <div className="font-mono text-[10px] text-cortai-text2">{a.guest_id.slice(0, 8)}</div>
                    <div className="text-[10px] text-cortai-text2">{fmtTs(a.starts_at)}</div>
                    <div className="text-[10px] text-cortai-text2">{fmtTs(a.ends_at)}</div>
                    <div>
                      <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                        style={{ background: cfg.bg, color: cfg.col }}>
                        {(a.status ?? "?").toUpperCase()}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => setApptDetail(a)}
                        data-testid="pool-spa-appt-detail"
                        className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                        style={{ background: "rgba(255,255,255,.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,.08)" }}>
                        {t("appointments.detail")}
                      </button>
                      <button type="button" onClick={() => openEditAppt(a)}
                        data-testid={`appt-edit-${a.id}`}
                        className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                        style={{ background: "rgba(139,92,246,.12)", color: "#8b5cf6", border: "1px solid rgba(139,92,246,.2)" }}>
                        {t("appointments.edit")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Calendar view */}
          {appointmentsView === "calendar" && (
            <div className="p-4">
              {calendarGroups.length === 0 ? (
                <EmptyState message={loading ? t("loading") : t("appointments.empty")} className="py-6" testId="appointments-calendar-empty" />
              ) : (
                <div className="grid gap-3">
                  {calendarGroups.map(([day, items]) => (
                    <div key={day} className="rounded-xl border border-cortai-border overflow-hidden">
                      <div className="border-b border-cortai-border px-4 py-2" style={{ background: "rgba(255,255,255,.03)" }}>
                        <span className="text-[11px] font-semibold text-cortai-text">{day}</span>
                        <span className="ml-2 text-[9px] text-cortai-text3">{items.length} appointment{items.length !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="grid gap-0">
                        {items.map((a) => {
                          const cfg = apptStatusCfg(a.status);
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => setApptDetail(a)}
                              className="flex items-center gap-3 border-b border-cortai-border/30 px-4 py-2.5 text-left last:border-0 transition hover:bg-white/[.01]"
                            >
                              <div className="text-[11px] font-medium text-cortai-text">{a.service}</div>
                              <div className="text-[9px] text-cortai-text3">{fmtTime(a.starts_at)}</div>
                              <span className="ml-auto rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                                style={{ background: cfg.bg, color: cfg.col }}>
                                {(a.status ?? "?").toUpperCase()}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════════════ */}

      {/* New service */}
      <Modal open={svcOpen} title={t("services.modal.title")} closeLabel={t("close")} onClose={() => setSvcOpen(false)}>
        <form onSubmit={svcForm.handleSubmit((v) => void submitService(v))} className="grid gap-3" data-testid="pool-spa-service-modal">
          <Input label={t("services.modal.name")}             error={svcForm.formState.errors.name?.message}             {...svcForm.register("name")} />
          <Input label={t("services.modal.description")}      error={svcForm.formState.errors.description?.message}      {...svcForm.register("description")} />
          <Input label={t("services.modal.durationMinutes")}  error={svcForm.formState.errors.duration_minutes?.message} type="number" {...svcForm.register("duration_minutes")} />
          <Input label={t("services.modal.priceCents")}       error={svcForm.formState.errors.price_cents?.message}      type="number" {...svcForm.register("price_cents")} />
          <label className="flex items-center gap-2 text-xs text-cortai-text2">
            <input type="checkbox" {...svcForm.register("available")} /><span>{t("services.modal.available")}</span>
          </label>
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setSvcOpen(false)}>{t("close")}</Button>
            <Button type="submit" className="ml-auto" data-testid="service-modal-submit" disabled={loading}>{t("services.modal.submit")}</Button>
          </div>
        </form>
      </Modal>

      {/* Create / edit appointment */}
      <Modal
        open={apptOpen}
        title={apptEditing ? t("appointments.modal.editTitle") : t("appointments.modal.newTitle")}
        closeLabel={t("close")}
        onClose={() => setApptOpen(false)}
      >
        <form onSubmit={apptForm.handleSubmit((v) => void submitAppt(v))} className="grid gap-3" data-testid="pool-spa-appt-modal">
          <Input label={t("appointments.modal.guestId")}  error={apptForm.formState.errors.guest_id?.message}  {...apptForm.register("guest_id")} />
          <Input label={t("appointments.modal.service")}  error={apptForm.formState.errors.service?.message}   {...apptForm.register("service")} />
          <DateTimeInput label={t("appointments.modal.startsAt")} error={apptForm.formState.errors.starts_at?.message} {...apptForm.register("starts_at")} />
          <DateTimeInput label={t("appointments.modal.endsAt")}   error={apptForm.formState.errors.ends_at?.message}   {...apptForm.register("ends_at")} />
          <Input label={t("appointments.modal.status")}   error={apptForm.formState.errors.status?.message}    {...apptForm.register("status")} />
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setApptOpen(false)}>{t("close")}</Button>
            <Button type="submit" className="ml-auto" data-testid="appt-modal-submit" disabled={loading}>{t("appointments.modal.submit")}</Button>
          </div>
        </form>
      </Modal>

      {/* Appointment detail */}
      <Modal
        open={apptDetail !== null}
        title={t("appointments.detailTitle", { id: apptDetail?.id?.slice(0, 8) ?? "" })}
        closeLabel={t("close")}
        onClose={() => setApptDetail(null)}
      >
        {!apptDetail ? null : (
          <div className="grid gap-3" data-testid="pool-spa-appt-detail-modal">
            <div className="rounded-xl border border-cortai-border p-4" style={{ background: "rgba(255,255,255,.02)" }}>
              <div className="text-[13px] font-semibold text-cortai-text">{apptDetail.service}</div>
              <div className="mt-2 grid gap-1 text-[11px] text-cortai-text2">
                <div>{t("appointments.detailGuest",  { guest: apptDetail.guest_id.slice(0, 8) })}</div>
                <div>{t("appointments.detailStarts", { value: fmtTs(apptDetail.starts_at) })}</div>
                <div>{t("appointments.detailEnds",   { value: fmtTs(apptDetail.ends_at) })}</div>
                <div>{t("appointments.detailStatus", { status: apptDetail.status ?? t("appointments.status.unknown") })}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openEditAppt(apptDetail)}
                className="rounded px-3 py-1.5 text-[10px] font-semibold transition hover:opacity-80"
                style={{ background: "rgba(139,92,246,.12)", color: "#8b5cf6", border: "1px solid rgba(139,92,246,.2)" }}>
                {t("appointments.edit")}
              </button>
              <button type="button"
                onClick={() => {
                  void submitAppt({ guest_id: apptDetail.guest_id, service: apptDetail.service, starts_at: apptDetail.starts_at, ends_at: apptDetail.ends_at, status: "completed" });
                  setApptDetail(null);
                }}
                className="rounded px-3 py-1.5 text-[10px] font-semibold transition hover:opacity-80"
                style={{ background: "rgba(16,185,129,.12)", color: "#10b981", border: "1px solid rgba(16,185,129,.2)" }}>
                {t("appointments.actions.markCompleted")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
