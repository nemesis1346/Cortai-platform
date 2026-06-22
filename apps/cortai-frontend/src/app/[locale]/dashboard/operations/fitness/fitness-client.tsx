"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type FitnessCapacity = {
  property_id: string;
  count: number;
  capacity: number;
  status: string;
  total_today: number | null;
  avg_session_min: number | null;
  temp_f: number | null;
  humidity_pct: number | null;
  last_updated: string | null;
};

type FitnessEquipment = {
  equipment_id: string;
  type: string;
  status: string;
  in_use: boolean;
  last_updated: string | null;
};

type FitnessClass = {
  id: string;
  org_id: string;
  property_id: string;
  name: string;
  instructor_name: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked: number;
  location: string | null;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};
type FitnessClassList = { items: FitnessClass[] };

type FitnessCheckin = {
  id: string;
  org_id: string;
  property_id: string;
  guest_id: string;
  class_id: string | null;
  checked_in_at: string;
  source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
type FitnessCheckinList = { items: FitnessCheckin[] };

type TabKey = "today" | "classes" | "checkins";

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

function capacityStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "busy")     return "#ef4444";
  if (s === "moderate") return "#f59e0b";
  if (s === "quiet")    return "#10b981";
  return "#94a3b8";
}

function equipStatusCfg(e: FitnessEquipment): { label: string; col: string; bg: string } {
  if (e.status === "maintenance" || e.status === "offline")
    return { label: "Service",   col: "#ef4444", bg: "rgba(239,68,68,.12)" };
  if (e.in_use)
    return { label: "In Use",    col: "#3b82f6", bg: "rgba(59,130,246,.12)" };
  return  { label: "Available",  col: "#10b981", bg: "rgba(16,185,129,.12)" };
}

function classFillCfg(booked: number, cap: number): { pct: number; col: string } {
  if (cap <= 0) return { pct: 0, col: "#94a3b8" };
  const pct = Math.min(100, Math.round((booked / cap) * 100));
  const col = pct >= 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#10b981";
  return { pct, col };
}

function classStatusCfg(status: string): { col: string; bg: string } {
  const s = status.toLowerCase();
  if (s === "scheduled")  return { col: "#3b82f6", bg: "rgba(59,130,246,.12)" };
  if (s === "in_progress" || s === "active") return { col: "#00c4a3", bg: "rgba(0,196,163,.12)" };
  if (s === "completed")  return { col: "#10b981", bg: "rgba(16,185,129,.12)" };
  if (s === "cancelled")  return { col: "#ef4444", bg: "rgba(239,68,68,.12)" };
  return { col: "#94a3b8", bg: "rgba(148,163,184,.10)" };
}

// Demo bar heights for "Guests by Hour" (6am–9pm, 15 bars)
const DEMO_HOUR_BARS = [2, 4, 6, 8, 5, 4, 3, 6, 8, 9, 7, 5, 3, 2, 1] as const;
const DEMO_HOUR_LABELS = ["6am", "9am", "12pm", "3pm", "6pm", "9pm"] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export function FitnessClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.fitness");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [capacity, setCapacity]   = useState<FitnessCapacity | null>(null);
  const [equipment, setEquipment] = useState<FitnessEquipment[]>([]);
  const [classes, setClasses]     = useState<FitnessClass[]>([]);
  const [checkins, setCheckins]   = useState<FitnessCheckin[]>([]);

  const [classesView, setClassesView]   = useState<"list" | "calendar">("list");
  const [classDetail, setClassDetail]   = useState<FitnessClass | null>(null);
  const [checkinDetail, setCheckinDetail] = useState<FitnessCheckin | null>(null);

  const loadAll = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const [cap, eq, cls, chk] = await Promise.all([
        apiFetch<FitnessCapacity>(`/api/operations/fitness/capacity?property_id=${pid}`),
        apiFetch<FitnessEquipment[]>(`/api/operations/fitness/equipment?property_id=${pid}`),
        apiFetch<FitnessClassList>(`/api/operations/fitness/classes?property_id=${pid}`),
        apiFetch<FitnessCheckinList>(`/api/operations/fitness/checkins?property_id=${pid}`),
      ]);
      setCapacity(cap);
      setEquipment(eq);
      setClasses(cls.items);
      setCheckins(chk.items);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const equipOnline  = useMemo(() => equipment.filter((e) => e.status !== "maintenance" && e.status !== "offline").length, [equipment]);
  const equipInUse   = useMemo(() => equipment.filter((e) => e.in_use).length, [equipment]);

  const classCalendarGroups = useMemo(() => {
    const groups = new Map<string, FitnessClass[]>();
    for (const item of classes) {
      const d = new Date(item.starts_at);
      const key = Number.isNaN(d.getTime()) ? item.starts_at.slice(0, 10) : d.toISOString().slice(0, 10);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return Array.from(groups.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [classes]);

  const todayClasses = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return classes
      .filter((c) => c.starts_at.startsWith(today))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [classes]);

  // ── Class form ────────────────────────────────────────────────────────────
  const [classOpen, setClassOpen]       = useState(false);
  const [classEditing, setClassEditing] = useState<FitnessClass | null>(null);

  const classSchema = useMemo(
    () =>
      z.object({
        name:            z.string().min(1).max(180),
        instructor_name: z.string().max(180).optional().or(z.literal("")),
        starts_at:       z.string().min(1),
        ends_at:         z.string().min(1),
        capacity:        z.coerce.number().int().min(0),
        booked:          z.coerce.number().int().min(0),
        location:        z.string().max(180).optional().or(z.literal("")),
        description:     z.string().max(500).optional().or(z.literal("")),
        status:          z.string().min(1).max(32),
      }),
    [],
  );
  type ClassForm = z.infer<typeof classSchema>;
  const classForm = useForm<ClassForm>({
    resolver: zodResolver(classSchema),
    defaultValues: { name: "", instructor_name: "", starts_at: "", ends_at: "", capacity: 0, booked: 0, location: "", description: "", status: "scheduled" },
  });

  function openNewClass() {
    setClassEditing(null);
    classForm.reset({ name: "", instructor_name: "", starts_at: "", ends_at: "", capacity: 0, booked: 0, location: "", description: "", status: "scheduled" });
    setClassOpen(true);
  }

  function openEditClass(c: FitnessClass) {
    setClassEditing(c);
    classForm.reset({ name: c.name, instructor_name: c.instructor_name ?? "", starts_at: c.starts_at, ends_at: c.ends_at, capacity: c.capacity, booked: c.booked, location: c.location ?? "", description: c.description ?? "", status: c.status });
    setClassOpen(true);
  }

  async function submitClass(values: ClassForm) {
    if (!propertyId) return;
    setLoading(true);
    try {
      const body = { name: values.name, instructor_name: values.instructor_name || null, starts_at: values.starts_at, ends_at: values.ends_at, capacity: values.capacity, booked: values.booked, location: values.location || null, description: values.description || null, status: values.status };
      if (classEditing) {
        await apiFetch<FitnessClass>(`/api/operations/fitness/classes/${encodeURIComponent(classEditing.id)}`, { method: "PATCH", body: JSON.stringify(body) });
        notify({ title: t("toast.classUpdated.title"), description: t("toast.classUpdated.description"), tone: "success" });
      } else {
        await apiFetch<FitnessClass>("/api/operations/fitness/classes", { method: "POST", body: JSON.stringify({ property_id: propertyId, ...body }) });
        notify({ title: t("toast.classCreated.title"), description: t("toast.classCreated.description"), tone: "success" });
      }
      setClassOpen(false);
      setClassEditing(null);
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  // ── Checkin form ──────────────────────────────────────────────────────────
  const [checkinOpen, setCheckinOpen] = useState(false);
  const checkinSchema = useMemo(
    () =>
      z.object({
        guest_id: z.string().uuid(),
        class_id: z.string().uuid().optional().or(z.literal("")),
        source:   z.string().min(1).max(32),
        notes:    z.string().max(500).optional().or(z.literal("")),
      }),
    [],
  );
  type CheckinForm = z.infer<typeof checkinSchema>;
  const checkinForm = useForm<CheckinForm>({
    resolver: zodResolver(checkinSchema),
    defaultValues: { guest_id: "", class_id: "", source: "manual", notes: "" },
  });

  async function submitCheckin(values: CheckinForm) {
    if (!propertyId) return;
    setLoading(true);
    try {
      await apiFetch<FitnessCheckin>("/api/operations/fitness/checkins", {
        method: "POST",
        body: JSON.stringify({ property_id: propertyId, guest_id: values.guest_id, class_id: values.class_id || null, source: values.source, notes: values.notes || null }),
      });
      notify({ title: t("toast.checkinCreated.title"), description: t("toast.checkinCreated.description"), tone: "success" });
      setCheckinOpen(false);
      checkinForm.reset({ guest_id: "", class_id: "", source: "manual", notes: "" });
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
  const capPct = capacity && capacity.capacity > 0 ? Math.min(100, Math.round((capacity.count / capacity.capacity) * 100)) : 0;
  const capColor = capacityStatusColor(capacity?.status ?? "");

  return (
    <div className="grid gap-4" data-testid="fitness-page">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-cortai-text">{t("title")}</h1>
          <p className="text-[11px] text-cortai-text3">{todayLabel} · {t("subtitle")}</p>
        </div>
        <div className="ml-auto">
          <Button type="button" variant="ghost" onClick={() => void loadAll()} disabled={loading} data-testid="fitness-refresh">
            {t("refresh")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-cortai-red">{error}</div>
      ) : null}

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-xl border border-cortai-border p-1" style={{ background: "rgba(255,255,255,.02)" }}>
        {([
          { key: "today"    as TabKey, label: "Today",    count: capacity ? `${capacity.count} / ${capacity.capacity}` : undefined, icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg> },
          { key: "classes"  as TabKey, label: "Classes",  count: classes.length > 0 ? `${classes.length}` : undefined,             icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg> },
          { key: "checkins" as TabKey, label: "Check-ins",count: checkins.length > 0 ? `${checkins.length}` : undefined,           icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><polyline points="20,6 9,17 4,12"/></svg> },
        ] as { key: TabKey; label: string; count?: string; icon: React.ReactNode }[]).map(({ key, label, count, icon }) => (
          <button
            key={key}
            type="button"
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
          {/* 4 KPI tiles */}
          <div className="grid grid-cols-4 gap-3">
            {[
              {
                label: "Current Occupancy",
                v:     capacity ? `${capacity.count} / ${capacity.capacity}` : "—",
                sub:   capacity ? `${capPct}% capacity · ${capacity.status}` : "",
                c:     capColor,
              },
              {
                label: "Equipment Online",
                v:     equipment.length > 0 ? `${equipOnline} / ${equipment.length}` : "—",
                sub:   `${equipInUse} in use · ${equipment.length - equipOnline} service`,
                c:     equipment.length - equipOnline > 0 ? "#f59e0b" : "#10b981",
              },
              {
                label: "Total Today",
                v:     capacity?.total_today ?? "—",
                sub:   capacity?.avg_session_min ? `avg session ${capacity.avg_session_min}m` : "guests",
                c:     "#c8dce8",
              },
              {
                label: "Classes Today",
                v:     todayClasses.length || classes.length,
                sub:   todayClasses.length > 0 ? `${todayClasses.filter((c) => c.booked >= c.capacity).length} full` : "total scheduled",
                c:     "#8b5cf6",
              },
            ].map(({ label, v, sub, c }) => (
              <div key={label} className="rounded-xl border border-cortai-border px-4 py-3" style={{ background: "rgba(255,255,255,.02)" }}>
                <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">{label}</div>
                <div className="mt-1 font-mono text-[24px] font-bold leading-none" style={{ color: c }}>{v}</div>
                <div className="mt-1 text-[9px] text-cortai-text3">{sub}</div>
              </div>
            ))}
          </div>

          {/* Env strip (temp + humidity from capacity fixture) */}
          {capacity?.temp_f != null ? (
            <div className="flex items-center gap-4 rounded-xl border border-cortai-border px-4 py-2.5" style={{ background: "rgba(255,255,255,.01)" }}>
              <svg viewBox="0 0 24 24" width="13" height="13" stroke="#00c4a3" fill="none" strokeWidth="1.5"><path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z"/></svg>
              <span className="text-[11px] text-cortai-text3">Gym Environment</span>
              <span className="font-mono text-[13px] font-bold" style={{ color: "#10b981" }}>{capacity.temp_f}°F</span>
              <span className="text-[10px] text-cortai-text3">Temp</span>
              {capacity.humidity_pct != null ? (
                <>
                  <span className="font-mono text-[13px] font-bold" style={{ color: "#3b82f6" }}>{capacity.humidity_pct}%</span>
                  <span className="text-[10px] text-cortai-text3">Humidity</span>
                </>
              ) : null}
              <span className="ml-auto text-[9px] text-cortai-text3">
                {capacity.last_updated ? `Updated ${new Date(capacity.last_updated).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : ""}
              </span>
            </div>
          ) : null}

          {/* Main 2-col grid */}
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 300px" }}>

            {/* Equipment status */}
            <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
              <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                  <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
                </svg>
                <span className="text-[13px] font-semibold text-cortai-text">{t("equipment.title")}</span>
                <div className="ml-auto flex items-center gap-2">
                  {equipInUse > 0 ? <span className="rounded-full px-2 py-0.5 font-mono text-[9px]" style={{ background: "rgba(59,130,246,.12)", color: "#3b82f6" }}>{equipInUse} in use</span> : null}
                  {equipment.length - equipOnline > 0 ? <span className="rounded-full px-2 py-0.5 font-mono text-[9px]" style={{ background: "rgba(239,68,68,.12)", color: "#ef4444" }}>{equipment.length - equipOnline} service</span> : null}
                </div>
              </div>

              {/* Column headers */}
              <div
                className="grid border-b border-cortai-border px-4 py-2 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
                style={{ gridTemplateColumns: "1.2fr 90px 80px 1fr", background: "rgba(255,255,255,.02)" }}
              >
                <div>{t("equipment.cols.equipment")}</div>
                <div>{t("equipment.cols.type")}</div>
                <div>{t("equipment.cols.status")}</div>
                <div>{t("equipment.cols.updated")}</div>
              </div>

              {equipment.length === 0 ? (
                <div className="px-4 py-8 text-center text-[11px] text-cortai-text3">{loading ? t("loading") : t("equipment.empty")}</div>
              ) : equipment.map((e) => {
                const sc = equipStatusCfg(e);
                return (
                  <div
                    key={e.equipment_id}
                    className="grid items-center border-b border-cortai-border/30 px-4 py-2.5 text-[11px] last:border-0"
                    style={{
                      gridTemplateColumns: "1.2fr 90px 80px 1fr",
                      borderLeft: e.status === "maintenance" || e.status === "offline" ? "3px solid rgba(239,68,68,.35)" : e.in_use ? "3px solid rgba(59,130,246,.3)" : "3px solid transparent",
                    }}
                  >
                    <div className="font-semibold text-cortai-text">{e.equipment_id}</div>
                    <div className="text-[10px] text-cortai-text3">{e.type}</div>
                    <div>
                      <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                        style={{ background: sc.bg, color: sc.col }}>{sc.label.toUpperCase()}</span>
                    </div>
                    <div className="text-[10px] text-cortai-text3">{e.last_updated ? new Date(e.last_updated).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"}</div>
                  </div>
                );
              })}
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-3">

              {/* Classes Today */}
              <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
                <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#8b5cf6" fill="none" strokeWidth="1.5">
                    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  <span className="text-[12px] font-semibold text-cortai-text">Classes Today</span>
                  <button type="button" onClick={() => setActiveTab("classes")}
                    className="ml-auto text-[9px] transition hover:text-cortai-text" style={{ color: "#4d7088" }}>
                    All →
                  </button>
                </div>
                {todayClasses.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[11px] text-cortai-text3">
                    {classes.length > 0 ? "No classes scheduled today" : loading ? t("loading") : t("classes.empty")}
                  </div>
                ) : (
                  <div>
                    {todayClasses.map((c) => {
                      const fill = classFillCfg(c.booked, c.capacity);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setClassDetail(c)}
                          className="w-full border-b border-cortai-border/30 px-4 py-2.5 text-left last:border-0 transition hover:bg-white/[.01]"
                        >
                          <div className="flex items-start gap-2">
                            <span className="font-mono text-[10px] shrink-0 pt-0.5" style={{ color: "#00c4a3" }}>{fmtTime(c.starts_at)}</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-medium text-cortai-text truncate">{c.name}</div>
                              {c.instructor_name ? <div className="text-[9px] text-cortai-text3">{c.instructor_name}</div> : null}
                              <div className="mt-1.5 flex items-center gap-2">
                                <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.07)" }}>
                                  <div className="h-full rounded-full" style={{ width: `${fill.pct}%`, background: fill.col }} />
                                </div>
                                <span className="font-mono text-[9px]" style={{ color: fill.col }}>{c.booked}/{c.capacity}</span>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Guests by Hour (demo bar chart) */}
              <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
                <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                  </svg>
                  <span className="text-[12px] font-semibold text-cortai-text">Guests by Hour</span>
                  <span className="ml-auto text-[9px] text-cortai-text3">demo</span>
                </div>
                <div className="px-4 pb-3 pt-3">
                  <div className="flex items-end gap-[3px]" style={{ height: 60 }}>
                    {DEMO_HOUR_BARS.map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t-sm"
                        style={{ height: `${h * 10}%`, background: "#00c4a3", opacity: 0.75 }}
                      />
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between">
                    {DEMO_HOUR_LABELS.map((l) => (
                      <span key={l} className="font-mono text-[9px] text-cortai-text3">{l}</span>
                    ))}
                  </div>
                </div>
              </div>

            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: CLASSES
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "classes" && (
        <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
          <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#8b5cf6" fill="none" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>
              <line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/>
            </svg>
            <span className="text-[13px] font-semibold text-cortai-text">{t("classes.title")}</span>
            {classes.length > 0 ? (
              <span className="rounded-full px-2 py-0.5 font-mono text-[9px]"
                style={{ background: "rgba(139,92,246,.12)", color: "#8b5cf6" }}>{classes.length}</span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {(["list", "calendar"] as const).map((v) => (
                <button key={v} type="button"
                  onClick={() => setClassesView(v)}
                  data-testid={`fitness-classes-view-${v}`}
                  className="rounded-md px-2.5 py-1 text-[10px] font-semibold transition"
                  style={{
                    background: classesView === v ? "rgba(139,92,246,.15)" : "rgba(255,255,255,.04)",
                    color:      classesView === v ? "#8b5cf6" : "#4d7088",
                    border:    `1px solid ${classesView === v ? "rgba(139,92,246,.3)" : "rgba(255,255,255,.06)"}`,
                  }}
                >
                  {t(`classes.view.${v}`)}
                </button>
              ))}
              <button type="button" onClick={openNewClass}
                data-testid="fitness-class-new"
                className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90"
                style={{ background: "#8b5cf6" }}
              >
                + {t("classes.new")}
              </button>
            </div>
          </div>

          {/* List view */}
          {classesView === "list" && (
            <>
              <div
                className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
                style={{ gridTemplateColumns: "1.5fr 1fr 80px 80px 1fr", background: "rgba(255,255,255,.02)" }}
              >
                <div>{t("classes.cols.name")}</div>
                <div>{t("classes.cols.time")}</div>
                <div>{t("classes.cols.capacity")}</div>
                <div>{t("classes.cols.status")}</div>
                <div>{t("classes.cols.actions")}</div>
              </div>
              {classes.length === 0 ? (
                <div className="px-4 py-8 text-center text-[11px] text-cortai-text3">{loading ? t("loading") : t("classes.empty")}</div>
              ) : classes.map((c) => {
                const fill = classFillCfg(c.booked, c.capacity);
                const sc   = classStatusCfg(c.status);
                return (
                  <div
                    key={c.id}
                    className="grid items-center border-b border-cortai-border/30 px-4 py-2.5 text-[11px] last:border-0 hover:bg-white/[.01]"
                    style={{ gridTemplateColumns: "1.5fr 1fr 80px 80px 1fr" }}
                  >
                    <div>
                      <div className="font-medium text-cortai-text">{c.name}</div>
                      {c.instructor_name ? (
                        <div className="text-[9px] text-cortai-text3">{t("classes.instructor", { name: c.instructor_name })}</div>
                      ) : null}
                    </div>
                    <div className="text-[10px] text-cortai-text2">
                      <div>{fmtTs(c.starts_at)}</div>
                      <div className="text-cortai-text3">→ {fmtTs(c.ends_at)}</div>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-mono text-[10px]" style={{ color: fill.col }}>{c.booked}/{c.capacity}</span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.07)" }}>
                        <div className="h-full rounded-full" style={{ width: `${fill.pct}%`, background: fill.col }} />
                      </div>
                    </div>
                    <div>
                      <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                        style={{ background: sc.bg, color: sc.col }}>{c.status.toUpperCase()}</span>
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => setClassDetail(c)}
                        data-testid="fitness-class-detail"
                        className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                        style={{ background: "rgba(255,255,255,.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,.08)" }}>
                        {t("classes.detail")}
                      </button>
                      <button type="button" onClick={() => openEditClass(c)}
                        data-testid="fitness-class-edit"
                        className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                        style={{ background: "rgba(139,92,246,.12)", color: "#8b5cf6", border: "1px solid rgba(139,92,246,.2)" }}>
                        {t("classes.edit")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Calendar view */}
          {classesView === "calendar" && (
            <div className="p-4" data-testid="fitness-classes-calendar">
              {classCalendarGroups.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-cortai-text3">{loading ? t("loading") : t("classes.empty")}</div>
              ) : (
                <div className="grid gap-3">
                  {classCalendarGroups.map(([day, items]) => (
                    <div key={day} className="overflow-hidden rounded-xl border border-cortai-border">
                      <div className="border-b border-cortai-border px-4 py-2" style={{ background: "rgba(255,255,255,.03)" }}>
                        <span className="text-[11px] font-semibold text-cortai-text">{day}</span>
                        <span className="ml-2 text-[9px] text-cortai-text3">{items.length} class{items.length !== 1 ? "es" : ""}</span>
                      </div>
                      {items.map((item) => {
                        const sc = classStatusCfg(item.status);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setClassDetail(item)}
                            className="flex w-full items-center gap-3 border-b border-cortai-border/30 px-4 py-2.5 text-left last:border-0 transition hover:bg-white/[.01]"
                          >
                            <span className="font-mono text-[10px] shrink-0" style={{ color: "#00c4a3" }}>{fmtTime(item.starts_at)}</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-medium text-cortai-text">{item.name}</div>
                              {item.instructor_name ? <div className="text-[9px] text-cortai-text3">{item.instructor_name}</div> : null}
                            </div>
                            <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold shrink-0"
                              style={{ background: sc.bg, color: sc.col }}>{item.status.toUpperCase()}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: CHECKINS
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "checkins" && (
        <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
          <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#10b981" fill="none" strokeWidth="1.5">
              <polyline points="20,6 9,17 4,12"/>
            </svg>
            <span className="text-[13px] font-semibold text-cortai-text">{t("checkins.title")}</span>
            {checkins.length > 0 ? (
              <span className="rounded-full px-2 py-0.5 font-mono text-[9px]"
                style={{ background: "rgba(16,185,129,.12)", color: "#10b981" }}>{checkins.length}</span>
            ) : null}
            <button type="button" onClick={() => setCheckinOpen(true)}
              data-testid="fitness-checkin-new"
              className="ml-auto rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90"
              style={{ background: "#10b981" }}
            >
              + {t("checkins.new")}
            </button>
          </div>

          <div
            className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
            style={{ gridTemplateColumns: "90px 90px 1fr 80px", background: "rgba(255,255,255,.02)" }}
          >
            <div>{t("checkins.cols.guest")}</div>
            <div>{t("checkins.cols.class")}</div>
            <div>{t("checkins.cols.time")}</div>
            <div>{t("checkins.cols.source")}</div>
          </div>

          {checkins.length === 0 ? (
            <div className="px-4 py-8 text-center text-[11px] text-cortai-text3">{loading ? t("loading") : t("checkins.empty")}</div>
          ) : checkins.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCheckinDetail(c)}
              className="grid w-full items-center border-b border-cortai-border/30 px-4 py-2.5 text-left text-[11px] last:border-0 hover:bg-white/[.01]"
              style={{ gridTemplateColumns: "90px 90px 1fr 80px" }}
            >
              <div className="font-mono text-[10px] text-cortai-text2">{c.guest_id.slice(0, 8)}</div>
              <div className="font-mono text-[10px] text-cortai-text3">{c.class_id ? c.class_id.slice(0, 8) : "—"}</div>
              <div className="text-[10px] text-cortai-text2">{fmtTs(c.checked_in_at)}</div>
              <div>
                <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                  style={{ background: "rgba(16,185,129,.12)", color: "#10b981" }}>{c.source.toUpperCase()}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════════════ */}

      {/* Class create/edit */}
      <Modal open={classOpen} title={classEditing ? t("classes.modal.editTitle") : t("classes.modal.newTitle")} closeLabel={t("close")} onClose={() => setClassOpen(false)}>
        <form onSubmit={classForm.handleSubmit((v) => void submitClass(v))} className="grid gap-3" data-testid="fitness-class-modal">
          <Input label={t("classes.modal.name")}       error={classForm.formState.errors.name?.message}            {...classForm.register("name")} />
          <Input label={t("classes.modal.instructor")} error={classForm.formState.errors.instructor_name?.message} {...classForm.register("instructor_name")} />
          <Input label={t("classes.modal.startsAt")}   error={classForm.formState.errors.starts_at?.message}       {...classForm.register("starts_at")} />
          <Input label={t("classes.modal.endsAt")}     error={classForm.formState.errors.ends_at?.message}         {...classForm.register("ends_at")} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t("classes.modal.capacity")} error={classForm.formState.errors.capacity?.message} type="number" {...classForm.register("capacity")} />
            <Input label={t("classes.modal.booked")}   error={classForm.formState.errors.booked?.message}   type="number" {...classForm.register("booked")} />
          </div>
          <Input label={t("classes.modal.location")}    error={classForm.formState.errors.location?.message}    {...classForm.register("location")} />
          <Input label={t("classes.modal.description")} error={classForm.formState.errors.description?.message} {...classForm.register("description")} />
          <Input label={t("classes.modal.status")}      error={classForm.formState.errors.status?.message}      {...classForm.register("status")} />
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setClassOpen(false)} data-testid="fitness-class-modal-close">{t("close")}</Button>
            <Button type="submit" className="ml-auto" disabled={loading} data-testid="fitness-class-modal-submit">{t("classes.modal.submit")}</Button>
          </div>
        </form>
      </Modal>

      {/* Checkin create */}
      <Modal open={checkinOpen} title={t("checkins.modal.title")} closeLabel={t("close")} onClose={() => setCheckinOpen(false)}>
        <form onSubmit={checkinForm.handleSubmit((v) => void submitCheckin(v))} className="grid gap-3" data-testid="fitness-checkin-modal">
          <Input label={t("checkins.modal.guestId")} error={checkinForm.formState.errors.guest_id?.message} {...checkinForm.register("guest_id")} />
          <Input label={t("checkins.modal.classId")} error={checkinForm.formState.errors.class_id?.message} {...checkinForm.register("class_id")} />
          <Input label={t("checkins.modal.source")}  error={checkinForm.formState.errors.source?.message}   {...checkinForm.register("source")} />
          <Input label={t("checkins.modal.notes")}   error={checkinForm.formState.errors.notes?.message}    {...checkinForm.register("notes")} />
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCheckinOpen(false)} data-testid="fitness-checkin-modal-close">{t("close")}</Button>
            <Button type="submit" className="ml-auto" disabled={loading} data-testid="fitness-checkin-modal-submit">{t("checkins.modal.submit")}</Button>
          </div>
        </form>
      </Modal>

      {/* Class detail */}
      <Modal open={classDetail !== null} title={t("classes.detailTitle", { id: classDetail?.id.slice(0, 8) ?? "" })} closeLabel={t("close")} onClose={() => setClassDetail(null)}>
        {!classDetail ? null : (
          <div className="grid gap-3" data-testid="fitness-class-detail-modal">
            <div className="rounded-xl border border-cortai-border p-4" style={{ background: "rgba(255,255,255,.02)" }}>
              <div className="text-[13px] font-semibold text-cortai-text">{classDetail.name}</div>
              <div className="mt-2 grid gap-1 text-[11px] text-cortai-text2">
                <div>{t("classes.detailInstructor", { value: classDetail.instructor_name ?? "—" })}</div>
                <div>{t("classes.detailTime", { start: fmtTs(classDetail.starts_at), end: fmtTs(classDetail.ends_at) })}</div>
                <div>{t("classes.detailCapacity", { booked: classDetail.booked, capacity: classDetail.capacity })}</div>
                <div>{t("classes.detailLocation", { value: classDetail.location ?? "—" })}</div>
                <div>{t("classes.detailStatus", { status: classDetail.status })}</div>
              </div>
            </div>
            <div>
              <button type="button" onClick={() => openEditClass(classDetail)}
                data-testid="fitness-class-detail-edit"
                className="rounded px-3 py-1.5 text-[10px] font-semibold transition hover:opacity-80"
                style={{ background: "rgba(139,92,246,.12)", color: "#8b5cf6", border: "1px solid rgba(139,92,246,.2)" }}>
                {t("classes.edit")}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Checkin detail */}
      <Modal open={checkinDetail !== null} title={t("checkins.detailTitle", { id: checkinDetail?.id.slice(0, 8) ?? "" })} closeLabel={t("close")} onClose={() => setCheckinDetail(null)}>
        {!checkinDetail ? null : (
          <div className="rounded-xl border border-cortai-border p-4" style={{ background: "rgba(255,255,255,.02)" }} data-testid="fitness-checkin-detail-modal">
            <div className="grid gap-1 text-[11px] text-cortai-text2">
              <div>{t("checkins.detailGuest",  { guest:  checkinDetail.guest_id.slice(0, 8) })}</div>
              <div>{t("checkins.detailClass",  { value:  checkinDetail.class_id?.slice(0, 8) ?? "—" })}</div>
              <div>{t("checkins.detailTime",   { value:  fmtTs(checkinDetail.checked_in_at) })}</div>
              <div>{t("checkins.detailSource", { source: checkinDetail.source })}</div>
              <div>{t("checkins.detailNotes",  { value:  checkinDetail.notes ?? "—" })}</div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
