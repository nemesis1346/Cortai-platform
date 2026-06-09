"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Table, Td } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";

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

type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
};

type ChecklistJson = {
  open_items?: ChecklistItem[];
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

function fmtDate(value: string | null, dash: string) {
  if (!value) return dash;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function isChecklistItem(value: unknown): value is ChecklistItem {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.id === "string" && typeof rec.text === "string" && typeof rec.done === "boolean";
}

function checklistFromJson(value: Record<string, unknown> | null | undefined): ChecklistItem[] {
  const raw = (value as ChecklistJson | null | undefined)?.open_items;
  return Array.isArray(raw) ? raw.filter(isChecklistItem) : [];
}

function fallbackChecklist(incidents: Incident[], requests: GuestServiceRequest[]) {
  const items: ChecklistItem[] = [];
  for (const inc of incidents.slice(0, 5)) {
    items.push({
      id: `incident:${inc.id}`,
      text: `[${inc.severity}] ${inc.title}`,
      done: false
    });
  }
  for (const req of requests.slice(0, 5)) {
    items.push({
      id: `guest-request:${req.id}`,
      text: `${req.type}${req.room_id ? ` ${req.room_id.slice(0, 8)}` : ""}${req.note ? ` - ${req.note}` : ""}`,
      done: false
    });
  }
  return items;
}

function buildSummary(
  t: (key: string) => string,
  kpis: OperationsKpis | null,
  incidents: Incident[],
  requests: GuestServiceRequest[]
) {
  const lines = [`## ${t("auto.heading.shiftSummary")}`, ""];
  if (kpis) {
    lines.push(
      `- ${t("auto.kpi.occupancy")}: ${Math.round(kpis.occupancy_pct)}% (${kpis.occupancy_rooms.used}/${kpis.occupancy_rooms.total} ${t(
        "auto.kpi.rooms"
      )})`,
      `- ${t("auto.kpi.guestsInHotel")}: ${kpis.guests_in_hotel}/${kpis.guests_total_capacity}`,
      `- ${t("auto.kpi.arrivals")}: ${kpis.arrivals_today.arrived}/${kpis.arrivals_today.count}`,
      `- ${t("auto.kpi.departures")}: ${kpis.departures_today.departed}/${kpis.departures_today.count}`,
      `- ${t("auto.kpi.roomsReadyCleaning")}: ${kpis.rooms_ready}/${kpis.rooms_cleaning}`,
      `- ${t("auto.kpi.staffOnSiteDuty")}: ${kpis.staff_on_site}/${kpis.staff_on_duty}`
    );
  }
  lines.push(
    "",
    `## ${t("auto.heading.openWork")}`,
    `- ${t("auto.openIncidents")}: ${incidents.length}`,
    `- ${t("auto.pendingGuestRequests")}: ${requests.length}`
  );
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

function signedLabel(t: (key: string) => string, handover: ShiftHandover | null) {
  if (!handover) return t("status.notStarted");
  return handover.signed_at ? t("status.signed") : t("status.open");
}

export function ShiftHandoverClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.shiftHandover");
  const tc = useTranslations("operations.common");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<ShiftHandoverCurrent | null>(null);
  const [kpis, setKpis] = useState<OperationsKpis | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [requests, setRequests] = useState<GuestServiceRequest[]>([]);
  const [notes, setNotes] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newItem, setNewItem] = useState("");
  const [dirty, setDirty] = useState(false);

  const open = Boolean(current?.handover && !current.handover.signed_at);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const pid = encodeURIComponent(propertyId);
      const [cur, k, inc, req] = await Promise.all([
        apiFetch<ShiftHandoverCurrent>(`/api/operations/shift-handover/current?property_id=${pid}`),
        apiFetch<OperationsKpis>(`/api/operations/kpis?property_id=${pid}`),
        apiFetch<IncidentList>(`/api/operations/incidents?property_id=${pid}&status=OPEN&page_size=100`),
        apiFetch<GuestServiceList>(`/api/operations/guest-services?property_id=${pid}&status=pending`)
      ]);

      setCurrent(cur);
      setKpis(k);
      setIncidents(inc.items);
      setRequests(req.items);

      const generatedChecklist = fallbackChecklist(inc.items, req.items);
      const handoverChecklist = checklistFromJson(cur.handover?.checklist_json);
      setChecklist(handoverChecklist.length > 0 ? handoverChecklist : generatedChecklist);
      setNotes(cur.handover?.summary_md ?? buildSummary(t, k, inc.items, req.items));
      setDirty(false);
    } finally {
      setLoading(false);
    }
  }, [propertyId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveDraft() {
    if (!current?.handover || current.handover.signed_at) return;
    setLoading(true);
    try {
      const updated = await apiFetch<ShiftHandover>(`/api/operations/shift-handover/${current.handover.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          summary_md: notes,
          checklist_json: { open_items: checklist }
        })
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
          start_next: true
        })
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

  return (
    <div className="grid gap-4" data-testid="shift-handover-page">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{t("title")}</h1>
            {open ? (
              <Badge tone="green">{t("live")}</Badge>
            ) : (
              <Badge tone="neutral">{signedLabel(t, current?.handover ?? null)}</Badge>
            )}
          </div>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => void load()} disabled={loading}>
            {t("refresh")}
          </Button>
          <Button type="button" onClick={() => void signOff()} disabled={loading}>
            {t("signOff")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card title={t("summary.title")}>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-3">
              <div className="text-[10px] uppercase tracking-wide text-cortai-text3">{t("summary.shift")}</div>
              <div className="mt-1 text-sm font-semibold">
                {current ? `${current.shift_label} · ${current.shift_date}` : tc("dash")}
              </div>
            </div>
            <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-3">
              <div className="text-[10px] uppercase tracking-wide text-cortai-text3">{t("summary.occupancy")}</div>
              <div className="mt-1 text-sm font-semibold">
                {kpis ? `${Math.round(kpis.occupancy_pct)}%` : tc("dash")}
              </div>
            </div>
            <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-3">
              <div className="text-[10px] uppercase tracking-wide text-cortai-text3">{t("summary.incidents")}</div>
              <div className="mt-1 text-sm font-semibold">{incidents.length}</div>
            </div>
            <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-3">
              <div className="text-[10px] uppercase tracking-wide text-cortai-text3">{t("summary.requests")}</div>
              <div className="mt-1 text-sm font-semibold">{requests.length}</div>
            </div>
          </div>
          <label className="grid gap-1.5 text-xs text-cortai-text2">
            <span className="font-medium">{t("summary.notes")}</span>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
              rows={15}
              disabled={Boolean(current?.handover?.signed_at)}
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 font-mono text-sm text-cortai-text outline-none transition placeholder:text-cortai-text3 focus:border-cortai-teal disabled:opacity-60"
            />
          </label>
          <div className="mt-3 flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => void saveDraft()} disabled={loading || !dirty || !current?.handover || Boolean(current.handover.signed_at)}>
              {t("saveDraft")}
            </Button>
            <span className="text-xs text-cortai-text3">{dirty ? t("unsaved") : t("saved")}</span>
          </div>
        </Card>

        <Card title={t("checklist.title")}>
          <div className="grid gap-2">
            {checklist.length === 0 ? <p className="text-xs text-cortai-text3">{t("checklist.empty")}</p> : null}
            {checklist.map((item) => (
              <div key={item.id} className="flex items-start gap-2 rounded-md border border-cortai-border bg-cortai-bg2 p-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={Boolean(current?.handover?.signed_at)}
                  onChange={() => toggleItem(item.id)}
                  className="mt-1"
                />
                <span className={`min-w-0 flex-1 text-sm ${item.done ? "text-cortai-text3 line-through" : "text-cortai-text"}`}>{item.text}</span>
                <button
                  type="button"
                  disabled={Boolean(current?.handover?.signed_at)}
                  onClick={() => removeItem(item.id)}
                  className="text-xs text-cortai-text3 hover:text-cortai-red disabled:opacity-40"
                >
                  {t("checklist.remove")}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              disabled={Boolean(current?.handover?.signed_at)}
              placeholder={t("checklist.placeholder")}
              className="min-w-0 flex-1 rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none focus:border-cortai-teal disabled:opacity-60"
            />
            <Button type="button" variant="ghost" onClick={addItem} disabled={Boolean(current?.handover?.signed_at)}>
              {t("checklist.add")}
            </Button>
          </div>
        </Card>
      </div>

      <Card title={t("openWork.title")}>
        <div className="grid gap-4 xl:grid-cols-2">
          <Table headers={[t("openWork.incident"), t("openWork.status"), t("openWork.created")]}>
            {incidents.length === 0 ? (
              <tr>
                <Td colSpan={3} className="text-cortai-text3">{t("openWork.noIncidents")}</Td>
              </tr>
            ) : null}
            {incidents.slice(0, 8).map((inc) => (
              <tr key={inc.id}>
                <Td>{inc.title}</Td>
                <Td><Badge tone={inc.severity === "CRITICAL" || inc.severity === "HIGH" ? "red" : "amber"}>{inc.status}</Badge></Td>
                <Td className="text-cortai-text2">{fmtDate(inc.created_at, tc("dash"))}</Td>
              </tr>
            ))}
          </Table>
          <Table headers={[t("openWork.request"), t("openWork.status"), t("openWork.created")]}>
            {requests.length === 0 ? (
              <tr>
                <Td colSpan={3} className="text-cortai-text3">{t("openWork.noRequests")}</Td>
              </tr>
            ) : null}
            {requests.slice(0, 8).map((req) => (
              <tr key={req.id}>
                <Td>{req.note ?? req.type}</Td>
                <Td><Badge tone="amber">{req.status}</Badge></Td>
                <Td className="text-cortai-text2">{fmtDate(req.created_at, tc("dash"))}</Td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
    </div>
  );
}
