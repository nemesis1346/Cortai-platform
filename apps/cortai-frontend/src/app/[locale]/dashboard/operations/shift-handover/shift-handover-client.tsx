"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type ShiftLabel = "morning" | "afternoon" | "night";

type ShiftHandover = {
  id: string;
  org_id: string;
  property_id: string;
  shift_date: string;
  shift_label: ShiftLabel;
  summary_md: string | null;
  checklist_json: Record<string, unknown>;
  signed_by_user_id: string | null;
  signed_at: string | null;
  carry_forward_from_id: string | null;
  created_at: string;
  updated_at: string;
};

type ShiftHandoverCurrent = {
  property_id: string;
  shift_date: string;
  shift_label: ShiftLabel;
  handover: ShiftHandover | null;
};

type ShiftHandoverSignoffResponse = {
  signed: ShiftHandover;
  next: ShiftHandover | null;
};

type OperationsKpis = {
  occupancy_pct: number;
  occupancy_rooms: { used: number; total: number };
  guests_in_hotel: number;
  guests_total_capacity: number;
  staff_on_site: number;
  staff_on_duty: number;
  arrivals_today: { count: number; arrived: number };
  departures_today: { count: number; departed: number };
  rooms_ready: number;
  rooms_cleaning: number;
};

type Incident = {
  id: string;
  property_id: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  created_at: string;
};

type IncidentList = { items: Incident[] };

type GuestServiceRequest = {
  id: string;
  property_id: string;
  room_id: string | null;
  type: string;
  status: string;
  note: string | null;
  created_at: string;
};

type GuestServiceList = { items: GuestServiceRequest[] };

type ChecklistItem = { id: string; text: string; done: boolean };
type ChecklistJson  = { open_items?: ChecklistItem[]; [key: string]: unknown };

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
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function fmtTime(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function isChecklistItem(v: unknown): v is ChecklistItem {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.text === "string" && typeof r.done === "boolean";
}

function checklistFromJson(value: Record<string, unknown> | null | undefined): ChecklistItem[] {
  const raw = (value as ChecklistJson | null | undefined)?.open_items;
  return Array.isArray(raw) ? raw.filter(isChecklistItem) : [];
}

function fallbackChecklist(incidents: Incident[], requests: GuestServiceRequest[]): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const inc of incidents.slice(0, 5))
    items.push({ id: `incident:${inc.id}`, text: `[${inc.severity}] ${inc.title}`, done: false });
  for (const req of requests.slice(0, 5))
    items.push({ id: `req:${req.id}`, text: `${req.type}${req.room_id ? ` rm ${req.room_id.slice(0, 8)}` : ""}${req.note ? ` — ${req.note}` : ""}`, done: false });
  return items;
}

function buildSummary(
  t: (key: string) => string,
  kpis: OperationsKpis | null,
  incidents: Incident[],
  requests: GuestServiceRequest[],
): string {
  const lines = [`## ${t("auto.heading.shiftSummary")}`, ""];
  if (kpis) {
    lines.push(
      `- ${t("auto.kpi.occupancy")}: ${Math.round(kpis.occupancy_pct)}% (${kpis.occupancy_rooms.used}/${kpis.occupancy_rooms.total} ${t("auto.kpi.rooms")})`,
      `- ${t("auto.kpi.guestsInHotel")}: ${kpis.guests_in_hotel}/${kpis.guests_total_capacity}`,
      `- ${t("auto.kpi.arrivals")}: ${kpis.arrivals_today.arrived}/${kpis.arrivals_today.count}`,
      `- ${t("auto.kpi.departures")}: ${kpis.departures_today.departed}/${kpis.departures_today.count}`,
      `- ${t("auto.kpi.roomsReadyCleaning")}: ${kpis.rooms_ready} / ${kpis.rooms_cleaning}`,
      `- ${t("auto.kpi.staffOnSiteDuty")}: ${kpis.staff_on_site} / ${kpis.staff_on_duty}`,
    );
  }
  lines.push("", `## ${t("auto.heading.openWork")}`, `- ${t("auto.openIncidents")}: ${incidents.length}`, `- ${t("auto.pendingGuestRequests")}: ${requests.length}`);
  if (incidents.length > 0) {
    lines.push("", `## ${t("auto.heading.priorityIncidents")}`);
    for (const inc of incidents.slice(0, 5)) lines.push(`- [${inc.severity}] ${inc.title}`);
  }
  if (requests.length > 0) {
    lines.push("", `## ${t("auto.heading.pendingGuestRequests")}`);
    for (const req of requests.slice(0, 5)) lines.push(`- ${req.type}${req.note ? `: ${req.note}` : ""}`);
  }
  return lines.join("\n");
}

function shiftColor(label: ShiftLabel | string): { col: string; bg: string } {
  if (label === "morning")   return { col: "#f59e0b", bg: "rgba(245,158,11,.15)" };
  if (label === "afternoon") return { col: "#3b82f6", bg: "rgba(59,130,246,.15)" };
  return                            { col: "#8b5cf6", bg: "rgba(139,92,246,.15)" };
}

function incidentDotColor(severity: string): string {
  const s = severity.toUpperCase();
  if (s === "CRITICAL") return "#ef4444";
  if (s === "HIGH")     return "#f59e0b";
  if (s === "MEDIUM")   return "#3b82f6";
  return "#4d7088";
}

// Section header accent colours
const SEC = {
  crit: { bar: "#ef4444", bg: "rgba(239,68,68,.06)",  icon: "⚠", label: "Critical" },
  warn: { bar: "#f59e0b", bg: "rgba(245,158,11,.06)", icon: "⏱", label: "Pending" },
  info: { bar: "#3b82f6", bg: "rgba(59,130,246,.06)", icon: "✓", label: "Info" },
  nite: { bar: "#8b5cf6", bg: "rgba(139,92,246,.06)", icon: "☾", label: "Night SOP" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ShiftHandoverClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t  = useTranslations("operations.shiftHandover");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [loading,   setLoading]   = useState(false);
  const [current,   setCurrent]   = useState<ShiftHandoverCurrent | null>(null);
  const [kpis,      setKpis]      = useState<OperationsKpis | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [requests,  setRequests]  = useState<GuestServiceRequest[]>([]);
  const [notes,     setNotes]     = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newItem,   setNewItem]   = useState("");
  const [dirty,     setDirty]     = useState(false);

  const signed = Boolean(current?.handover?.signed_at);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const pid = encodeURIComponent(propertyId);
      const [cur, k, inc, req] = await Promise.all([
        apiFetch<ShiftHandoverCurrent>(`/api/operations/shift-handover/current?property_id=${pid}`),
        apiFetch<OperationsKpis>(`/api/operations/kpis?property_id=${pid}`),
        apiFetch<IncidentList>(`/api/operations/incidents?property_id=${pid}&status=OPEN&page_size=100`),
        apiFetch<GuestServiceList>(`/api/operations/guest-services?property_id=${pid}&status=pending`),
      ]);
      setCurrent(cur);
      setKpis(k);
      setIncidents(inc.items);
      setRequests(req.items);
      const generated = fallbackChecklist(inc.items, req.items);
      const handoverChecklist = checklistFromJson(cur.handover?.checklist_json);
      setChecklist(handoverChecklist.length > 0 ? handoverChecklist : generated);
      setNotes(cur.handover?.summary_md ?? buildSummary(t, k, inc.items, req.items));
      setDirty(false);
    } finally {
      setLoading(false);
    }
  }, [propertyId, t]);

  useEffect(() => { void load(); }, [load]);

  async function saveDraft() {
    if (!current?.handover || current.handover.signed_at) return;
    setLoading(true);
    try {
      const updated = await apiFetch<ShiftHandover>(`/api/operations/shift-handover/${current.handover.id}`, {
        method: "PATCH",
        body: JSON.stringify({ summary_md: notes, checklist_json: { open_items: checklist } }),
      });
      setCurrent((prev) => (prev ? { ...prev, handover: updated } : prev));
      setDirty(false);
      notify({ title: t("toast.saved.title"), description: t("toast.saved.description"), tone: "success" });
    } catch {
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function signOff() {
    if (!propertyId || !current) return;
    setLoading(true);
    try {
      const resp = await apiFetch<ShiftHandoverSignoffResponse>("/api/operations/shift-handover", {
        method: "POST",
        body: JSON.stringify({
          property_id: propertyId,
          shift_date: current.shift_date,
          shift_label: current.shift_label,
          summary_md: notes,
          checklist_json: { open_items: checklist },
          start_next: true,
        }),
      });
      setCurrent({ property_id: propertyId, shift_date: resp.next?.shift_date ?? current.shift_date, shift_label: resp.next?.shift_label ?? current.shift_label, handover: resp.next });
      setNotes(resp.next?.summary_md ?? "");
      setChecklist(checklistFromJson(resp.next?.checklist_json));
      setDirty(false);
      notify({ title: t("toast.signed.title"), description: t("toast.signed.description"), tone: "success" });
    } catch {
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  function toggleItem(id: string) {
    setChecklist((prev) => prev.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
    setDirty(true);
  }
  function addItem() {
    const text = newItem.trim();
    if (!text) return;
    setChecklist((prev) => [...prev, { id: `manual:${Date.now()}`, text, done: false }]);
    setNewItem("");
    setDirty(true);
  }
  function removeItem(id: string) {
    setChecklist((prev) => prev.filter((it) => it.id !== id));
    setDirty(true);
  }

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-xs text-cortai-text2">{t("selectProperty")}</p>
      </div>
    );
  }

  const shiftLabel = current?.shift_label ?? "morning";
  const sc         = shiftColor(shiftLabel);
  const dateLabel  = current?.shift_date
    ? new Date(current.shift_date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const critIncidents  = incidents.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH");
  const otherIncidents = incidents.filter((i) => i.severity !== "CRITICAL" && i.severity !== "HIGH");
  const doneCount      = checklist.filter((c) => c.done).length;

  return (
    <div className="grid gap-4" data-testid="shift-handover-page">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-cortai-text">{t("title")}</h1>
          <p className="text-[11px] text-cortai-text3">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => void load()} disabled={loading}>
            {t("refresh")}
          </Button>
          {current?.handover && !signed && dirty ? (
            <button type="button" onClick={() => void saveDraft()} disabled={loading}
              className="rounded-lg px-3 py-1.5 text-[11px] font-semibold transition hover:opacity-90"
              style={{ background: "rgba(255,255,255,.06)", color: "#c8dce8", border: "1px solid rgba(255,255,255,.1)" }}>
              {t("saveDraft")}
            </button>
          ) : null}
          <button type="button" onClick={() => void signOff()} disabled={loading || signed}
            data-testid="shift-sign-off"
            className="rounded-lg px-4 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={{ background: signed ? "rgba(16,185,129,.3)" : "#00c4a3" }}>
            {signed ? "✓ Shift Signed Off" : "Acknowledge & Sign Off"}
          </button>
        </div>
      </div>

      {/* ── Hero: Outgoing → Incoming ────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
        <div className="grid items-center gap-0" style={{ gridTemplateColumns: "1fr 120px 1fr" }}>

          {/* Outgoing */}
          <div className="px-6 py-5">
            <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-cortai-text3 mb-2">
              Outgoing · {shiftLabel.charAt(0).toUpperCase() + shiftLabel.slice(1)} Shift
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-bold shrink-0"
                style={{ background: sc.bg, color: sc.col }}>
                {shiftLabel === "morning" ? "AM" : shiftLabel === "afternoon" ? "PM" : "NT"}
              </div>
              <div>
                <div className="text-[14px] font-semibold text-cortai-text">
                  {current?.shift_label ? `${shiftLabel.charAt(0).toUpperCase() + shiftLabel.slice(1)} Shift` : "Current Shift"}
                </div>
                <div className="text-[10px] text-cortai-text3">{dateLabel}</div>
              </div>
            </div>
            {current?.handover?.signed_at ? (
              <div className="mt-3 flex items-center gap-1.5 text-[10px]" style={{ color: "#10b981" }}>
                <span>✓ Signed off</span>
                <span className="text-cortai-text3">{fmtTime(current.handover.signed_at)}</span>
              </div>
            ) : (
              <div className="mt-3 text-[10px]" style={{ color: signed ? "#10b981" : "#f59e0b" }}>
                {current?.handover ? "Open — awaiting sign-off" : "Not started"}
              </div>
            )}
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center justify-center gap-1 py-5">
            <div className="text-[22px]" style={{ color: "#00c4a3" }}>→</div>
            <div className="font-mono text-[9px] text-cortai-text3 text-center">Handoff</div>
            <div className="font-mono text-[9px] text-cortai-text3 text-center">{fmtTime(new Date().toISOString())}</div>
          </div>

          {/* Incoming */}
          <div className="border-l border-cortai-border px-6 py-5">
            <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-cortai-text3 mb-2">
              Incoming · Next Shift
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full text-[12px] font-bold shrink-0"
                style={{ background: "rgba(59,130,246,.12)", color: "#3b82f6" }}>
                ?
              </div>
              <div>
                <div className="text-[14px] font-semibold text-cortai-text">Incoming Shift</div>
                <div className="text-[10px] text-cortai-text3">Awaiting acknowledgement</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[10px]" style={{ color: "#f59e0b" }}>
              <span>⚠ Not yet signed</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          {
            tid:   "occupancy",
            label: t("summary.occupancy"),
            v:     kpis ? `${Math.round(kpis.occupancy_pct)}%` : "—",
            sub:   kpis ? `${kpis.occupancy_rooms.used} / ${kpis.occupancy_rooms.total} rooms` : "",
            c:     kpis && kpis.occupancy_pct >= 85 ? "#10b981" : kpis && kpis.occupancy_pct >= 70 ? "#f59e0b" : "#ef4444",
          },
          {
            tid:   "arrivals-pending",
            label: "Arrivals Pending",
            v:     kpis ? Math.max(0, kpis.arrivals_today.count - kpis.arrivals_today.arrived) : "—",
            sub:   kpis ? `${kpis.arrivals_today.arrived} of ${kpis.arrivals_today.count} arrived` : "",
            c:     kpis && (kpis.arrivals_today.count - kpis.arrivals_today.arrived) > 0 ? "#f59e0b" : "#10b981",
          },
          {
            tid:   "incidents",
            label: t("summary.incidents"),
            v:     incidents.length,
            sub:   `${critIncidents.length} critical / high`,
            c:     critIncidents.length > 0 ? "#ef4444" : incidents.length > 0 ? "#f59e0b" : "#10b981",
          },
          {
            tid:   "requests",
            label: t("summary.requests"),
            v:     requests.length,
            sub:   `${checklist.filter((c) => !c.done).length} checklist items open`,
            c:     requests.length > 0 ? "#f59e0b" : "#10b981",
          },
        ].map(({ tid, label, v, sub, c }) => (
          <div key={label} data-testid={`kpi-tile-${tid}`} className="rounded-xl border border-cortai-border px-4 py-3" style={{ background: "rgba(255,255,255,.02)" }}>
            <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">{label}</div>
            <div className="mt-1 font-mono text-[26px] font-bold leading-none" style={{ color: c }}>{v}</div>
            <div className="mt-1 text-[9px] text-cortai-text3">{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Main body: 2-col ────────────────────────────────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 340px" }}>

        {/* ── Left column: incidents + requests + checklist ──────────── */}
        <div className="flex flex-col gap-4">

          {/* Critical / High incidents */}
          <SHSection
            kind="crit"
            title="Critical — Needs Attention"
            count={critIncidents.length}
            empty="No critical or high incidents."
          >
            {critIncidents.slice(0, 8).map((inc) => (
              <SHItem key={inc.id} dot={incidentDotColor(inc.severity)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-cortai-text">{inc.title}</div>
                    {inc.description ? (
                      <div className="mt-0.5 text-[10px] text-cortai-text2 line-clamp-2">{inc.description}</div>
                    ) : null}
                    <div className="mt-1 text-[9px] text-cortai-text3">{fmtTs(inc.created_at)}</div>
                  </div>
                  <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold shrink-0"
                    style={{ background: inc.severity === "CRITICAL" ? "rgba(239,68,68,.12)" : "rgba(245,158,11,.12)", color: inc.severity === "CRITICAL" ? "#ef4444" : "#f59e0b" }}>
                    {inc.severity}
                  </span>
                </div>
              </SHItem>
            ))}
          </SHSection>

          {/* Other incidents */}
          {otherIncidents.length > 0 ? (
            <SHSection kind="warn" title={t("openWork.title")} count={otherIncidents.length} empty="">
              {otherIncidents.slice(0, 8).map((inc) => (
                <SHItem key={inc.id} dot={incidentDotColor(inc.severity)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium text-cortai-text">{inc.title}</div>
                      <div className="text-[9px] text-cortai-text3 mt-0.5">{fmtTs(inc.created_at)}</div>
                    </div>
                    <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold shrink-0"
                      style={{ background: "rgba(148,163,184,.1)", color: "#94a3b8" }}>{inc.severity}</span>
                  </div>
                </SHItem>
              ))}
            </SHSection>
          ) : null}

          {/* Open guest requests */}
          <SHSection
            kind="warn"
            title="Promised / Pending Guest Requests"
            count={requests.length}
            empty={t("openWork.noRequests")}
          >
            {requests.slice(0, 8).map((req) => (
              <SHItem key={req.id} dot="#f59e0b">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium text-cortai-text">
                      {req.room_id ? `Rm ${req.room_id.slice(0, 8)} — ` : ""}{req.type}
                    </div>
                    {req.note ? <div className="mt-0.5 text-[10px] text-cortai-text2">{req.note}</div> : null}
                    <div className="text-[9px] text-cortai-text3 mt-0.5">{fmtTs(req.created_at)}</div>
                  </div>
                  <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold shrink-0"
                    style={{ background: "rgba(245,158,11,.12)", color: "#f59e0b" }}>PENDING</span>
                </div>
              </SHItem>
            ))}
          </SHSection>

        </div>

        {/* ── Right column: checklist + notes + sign-off ─────────────── */}
        <div className="flex flex-col gap-4">

          {/* Carry-forward Checklist */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
              </svg>
              <span className="text-[13px] font-semibold text-cortai-text">{t("checklist.title")}</span>
              {checklist.length > 0 ? (
                <span className="ml-auto font-mono text-[9px]" style={{ color: doneCount === checklist.length ? "#10b981" : "#f59e0b" }}>
                  {doneCount} / {checklist.length} done
                </span>
              ) : null}
            </div>

            <div className="max-h-64 overflow-y-auto">
              {checklist.length === 0 ? (
                <EmptyState message={t("checklist.empty")} className="px-4 py-6" testId="checklist-empty" />
              ) : checklist.map((item) => (
                <div key={item.id}
                  data-testid={`checklist-item-${item.id}`}
                  className="flex items-start gap-2 border-b border-cortai-border/30 px-4 py-2.5 last:border-0">
                  <input
                    type="checkbox"
                    checked={item.done}
                    disabled={signed}
                    data-testid={`checklist-check-${item.id}`}
                    onChange={() => toggleItem(item.id)}
                    className="mt-0.5 shrink-0 accent-cortai-teal"
                  />
                  <span className={`min-w-0 flex-1 text-[11px] ${item.done ? "text-cortai-text3 line-through" : "text-cortai-text"}`}>
                    {item.text}
                  </span>
                  <button type="button" disabled={signed} onClick={() => removeItem(item.id)}
                    data-testid={`checklist-remove-${item.id}`}
                    className="shrink-0 text-[9px] transition hover:text-cortai-red disabled:opacity-40"
                    style={{ color: "#4d7088" }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {!signed ? (
              <div className="border-t border-cortai-border/50 flex gap-2 px-3 py-2.5">
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addItem(); }}
                  data-testid="checklist-add-input"
                  placeholder={t("checklist.placeholder")}
                  className="min-w-0 flex-1 rounded-md border border-cortai-border bg-cortai-bg2 px-2.5 py-1.5 text-[11px] text-cortai-text outline-none focus:border-cortai-teal"
                />
                <button type="button" onClick={addItem}
                  data-testid="checklist-add-button"
                  className="rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition hover:opacity-80"
                  style={{ background: "rgba(0,196,163,.12)", color: "#00c4a3", border: "1px solid rgba(0,196,163,.2)" }}>
                  {t("checklist.add")}
                </button>
              </div>
            ) : null}
          </div>

          {/* Notes / Summary textarea */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              <span className="text-[13px] font-semibold text-cortai-text">{t("summary.notes")}</span>
              <span className="ml-auto text-[9px]" style={{ color: dirty ? "#f59e0b" : "#4d7088" }}>
                {dirty ? t("unsaved") : t("saved")}
              </span>
            </div>
            <div className="p-3">
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
                rows={10}
                disabled={signed}
                data-testid="notes-textarea"
                className="w-full rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 font-mono text-[11px] text-cortai-text outline-none transition placeholder:text-cortai-text3 focus:border-cortai-teal disabled:opacity-60"
              />
              {!signed && current?.handover ? (
                <button type="button" onClick={() => void saveDraft()} disabled={loading || !dirty}
                  data-testid="notes-save-draft"
                  className="mt-2 rounded-md px-3 py-1.5 text-[10px] font-semibold transition hover:opacity-80 disabled:opacity-40"
                  style={{ background: "rgba(0,196,163,.10)", color: "#00c4a3", border: "1px solid rgba(0,196,163,.2)" }}>
                  {t("saveDraft")}
                </button>
              ) : null}
            </div>
          </div>

          {/* Sign-off panel */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" data-testid="signoff-panel" style={{ background: "#080f1d" }}>
            <div className="border-b border-cortai-border px-4 py-3">
              <div className="text-[12px] font-semibold text-cortai-text">Handoff Sign-Off</div>
              <div className="text-[9px] text-cortai-text3">Electronic · audit-logged · cannot be deleted</div>
            </div>
            <div className="grid gap-0 divide-x divide-cortai-border" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {/* Outgoing */}
              <div className="px-4 py-4">
                <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3 mb-2">
                  Outgoing — Submitted By
                </div>
                <div className="text-[11px] font-semibold text-cortai-text mb-1">
                  {shiftLabel.charAt(0).toUpperCase() + shiftLabel.slice(1)} Shift
                </div>
                {signed ? (
                  <>
                    <div className="font-mono text-[11px] italic" style={{ color: "#00c4a3" }}>Signed</div>
                    <div className="mt-2 text-[9px] text-cortai-text3">
                      ✓ {fmtTs(current?.handover?.signed_at ?? null)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-mono text-[11px] italic opacity-30">Pending…</div>
                    <div className="mt-2 text-[9px]" style={{ color: "#f59e0b" }}>⚠ Not yet signed</div>
                  </>
                )}
              </div>
              {/* Incoming */}
              <div className="px-4 py-4">
                <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3 mb-2">
                  Incoming — Reviewed By
                </div>
                <div className="text-[11px] font-semibold text-cortai-text mb-1">Next Shift</div>
                <div className="font-mono text-[11px] italic opacity-30">Awaiting sign-on…</div>
                <div className="mt-2 text-[9px]" style={{ color: "#f59e0b" }}>
                  ⚠ Click &apos;Acknowledge & Sign Off&apos;
                </div>
              </div>
            </div>
            <div className="border-t border-cortai-border px-4 py-3">
              <button type="button" onClick={() => void signOff()} disabled={loading || signed}
                data-testid="shift-sign-off-2"
                className="w-full rounded-lg py-2 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                style={{ background: signed ? "rgba(16,185,129,.3)" : "#00c4a3" }}>
                {signed ? "✓ Shift Signed Off" : "Acknowledge & Sign Off →"}
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SHSection({
  kind,
  title,
  count,
  empty,
  children,
}: {
  kind: keyof typeof SEC;
  title: string;
  count: number;
  empty: string;
  children?: React.ReactNode;
}) {
  const cfg = SEC[kind];
  return (
    <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
      {/* Section header */}
      <div
        className="flex items-center gap-2 border-b border-cortai-border px-4 py-2.5"
        style={{ background: cfg.bg, borderLeft: `3px solid ${cfg.bar}` }}
      >
        <span className="text-[14px]">{cfg.icon}</span>
        <span className="text-[12px] font-semibold text-cortai-text">{title}</span>
        {count > 0 ? (
          <span className="ml-auto rounded-full px-2 py-0.5 font-mono text-[9px]"
            style={{ background: `${cfg.bar}22`, color: cfg.bar }}>{count} items</span>
        ) : null}
      </div>
      {count === 0 ? (
        <EmptyState message={empty} className="px-4 py-6" />
      ) : (
        <div>{children}</div>
      )}
    </div>
  );
}

function SHItem({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-cortai-border/30 px-4 py-3 last:border-0">
      <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
