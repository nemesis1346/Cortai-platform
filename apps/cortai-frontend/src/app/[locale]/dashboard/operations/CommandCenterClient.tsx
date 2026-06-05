"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Table, Td } from "@/components/ui/Table";

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

type ActionQueueItem = {
  id: string;
  org_id: string;
  property_id: string;
  type: string;
  source: string | null;
  room_id: string | null;
  guest_id: string | null;
  title: string;
  status: string;
  severity: string;
  assigned_to_user_id: string | null;
  sla_due_at: string | null;
  completed_at: string | null;
  parent_incident_id: string | null;
  created_at: string;
  updated_at: string;
};

type ActionQueueList = { items: ActionQueueItem[]; next_cursor: string | null };

type FrontDeskStats = {
  served_today: number;
  in_queue_now: number;
  queue_avg_seconds: number;
  checkin_avg_seconds: number;
};

type HousekeepingSummary = {
  rooms_assigned: number;
  staff_count: number;
  avg_per_staff: number;
  done_pct: number;
  efficiency_pct: number;
  avg_clean_seconds: number;
  in_process: number;
  in_transit: number;
  on_break: number;
  dnd: number;
};

type OperationsHeader = {
  property_id: string;
  ai_live: boolean;
  occupancy_pct: number;
  active_alerts: number;
  rating: number;
};

type AiInsightCard = {
  id: string;
  kind: string;
  title: string;
  body_md: string;
  severity: string;
  action_label?: string | null;
  action_payload?: unknown;
};

type AiInsights = { generated_at: string; cards: AiInsightCard[] };

type ElevatorState = {
  id: string;
  name: string;
  status: string;
  direction: string | null;
  current_floor: number | null;
  riders_today: number | null;
  last_seen_at?: string | null;
};

type LiveMsg = {
  type: string;
  org_id?: string;
  property_id?: string;
  payload?: unknown;
  item?: ActionQueueItem;
  _server_published_at_ms?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceActionQueueItem(value: unknown): ActionQueueItem | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  if (typeof id !== "string" || !id) return null;
  return value as unknown as ActionQueueItem;
}

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

function fmtSeconds(n: number, labels: { dash: string; seconds: string; minutes: string }) {
  if (!Number.isFinite(n) || n < 0) return labels.dash;
  if (n < 60) return `${Math.round(n)}${labels.seconds}`;
  const m = Math.round(n / 60);
  return `${m}${labels.minutes}`;
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-cortai-text3">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-cortai-text">{value}</div>
      {sub ? <div className="mt-1 text-xs text-cortai-text2">{sub}</div> : null}
    </div>
  );
}

function severityTone(sev: string): "teal" | "blue" | "amber" | "red" | "green" {
  if (sev === "urgent") return "red";
  if (sev === "high") return "amber";
  if (sev === "medium") return "blue";
  if (sev === "low") return "teal";
  return "teal";
}

function statusTone(st: string): "teal" | "blue" | "amber" | "red" | "green" {
  if (st === "completed") return "green";
  if (st === "urgent") return "red";
  if (st === "in_progress") return "blue";
  if (st === "assigned") return "amber";
  return "teal";
}

function pickNewer(a: ActionQueueItem, b: ActionQueueItem): ActionQueueItem {
  const ad = new Date(a.updated_at).getTime();
  const bd = new Date(b.updated_at).getTime();
  if (Number.isFinite(ad) && Number.isFinite(bd) && bd > ad) return b;
  return a;
}

export function CommandCenterClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.commandCenter");
  const { user } = useAuth();
  const [propertyId, setPropertyId] = useState(initialPropertyId);

  const [header, setHeader] = useState<OperationsHeader | null>(null);
  const [kpis, setKpis] = useState<OperationsKpis | null>(null);
  const [queue, setQueue] = useState<ActionQueueItem[]>([]);
  const [frontDesk, setFrontDesk] = useState<FrontDeskStats | null>(null);
  const [housekeeping, setHousekeeping] = useState<HousekeepingSummary | null>(null);
  const [elevators, setElevators] = useState<Record<string, ElevatorState>>({});
  const [aiInsights, setAiInsights] = useState<AiInsights | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastKpiRef = useRef<number>(0);

  const wsUrl = useMemo(() => toWsUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? ""), []);

  // Sync propertyId with cookie on soft refresh.
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const refreshKpis = useCallback(async () => {
    if (!propertyId) return;
    const data = await apiFetch<OperationsKpis>(`/api/operations/kpis?property_id=${encodeURIComponent(propertyId)}`);
    setKpis(data);
    lastKpiRef.current = Date.now();
  }, [propertyId]);

  const refreshFrontDesk = useCallback(async () => {
    if (!propertyId) return;
    setFrontDesk(
      await apiFetch<FrontDeskStats>(`/api/operations/front-desk/stats?property_id=${encodeURIComponent(propertyId)}`)
    );
  }, [propertyId]);

  const refreshHousekeeping = useCallback(async () => {
    if (!propertyId) return;
    setHousekeeping(
      await apiFetch<HousekeepingSummary>(
        `/api/operations/housekeeping/summary?property_id=${encodeURIComponent(propertyId)}`
      )
    );
  }, [propertyId]);

  const refreshAiInsights = useCallback(async () => {
    setAiInsights(await apiFetch<AiInsights>("/api/ai/v1/operations/insights"));
  }, []);

  const refreshElevators = useCallback(async () => {
    if (!propertyId) return;
    const items = await apiFetch<ElevatorState[]>(`/api/iot/v1/elevators`);
    setElevators(Object.fromEntries(items.map((e) => [e.id, e])));
  }, [propertyId]);

  const refreshAll = useCallback(async () => {
    setError(null);
    try {
      if (!propertyId) return;
      const [hdr, k, aq, fd, hk, ai, elv] = await Promise.all([
        apiFetch<OperationsHeader>(`/api/operations/header?property_id=${encodeURIComponent(propertyId)}`),
        apiFetch<OperationsKpis>(`/api/operations/kpis?property_id=${encodeURIComponent(propertyId)}`),
        apiFetch<ActionQueueList>(`/api/operations/action-queue?limit=50&property_id=${encodeURIComponent(propertyId)}`),
        apiFetch<FrontDeskStats>(`/api/operations/front-desk/stats?property_id=${encodeURIComponent(propertyId)}`),
        apiFetch<HousekeepingSummary>(`/api/operations/housekeeping/summary?property_id=${encodeURIComponent(propertyId)}`),
        apiFetch<AiInsights>("/api/ai/v1/operations/insights"),
        apiFetch<ElevatorState[]>(`/api/iot/v1/elevators`)
      ]);
      setHeader(hdr);
      setKpis(k);
      setQueue(aq.items);
      setFrontDesk(fd);
      setHousekeeping(hk);
      setAiInsights(ai);
      setElevators(Object.fromEntries(elv.map((e) => [e.id, e])));
      lastKpiRef.current = Date.now();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // WebSocket: primary live updates
  useEffect(() => {
    if (!user) return;
    if (!propertyId) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", scope: "property", property_id: propertyId }));
    };
    ws.onerror = () => {
      // fall back to periodic refresh
    };
    ws.onmessage = (event) => {
      let msg: LiveMsg | null = null;
      try {
        msg = JSON.parse(String(event.data)) as LiveMsg;
      } catch {
        return;
      }
      if (!msg) return;
      if (msg.type === "kpi.tick") {
        void refreshKpis();
        return;
      }
      if (msg.type === "front_desk.event") {
        void refreshFrontDesk();
        return;
      }
      if (msg.type === "housekeeping.assignment.updated") {
        void refreshHousekeeping();
        return;
      }
      if (msg.type === "ai.insights.refreshed") {
        void refreshAiInsights();
        return;
      }
      if (msg.type === "elevator.state") {
        const payload = isRecord(msg.payload) ? (msg.payload as Partial<ElevatorState>) : null;
        if (payload && typeof payload.id === "string" && payload.id) {
          const eid = payload.id;
          setElevators((prev) => ({
            ...prev,
            [eid]: { ...(prev[eid] ?? (payload as ElevatorState)), ...(payload as ElevatorState) }
          }));
        } else {
          void refreshElevators();
        }
        return;
      }
      if (msg.type === "action_queue.created" || msg.type === "action_queue.updated" || msg.type === "action_queue.completed") {
        const fromTop = coerceActionQueueItem(msg.item);
        const fromPayload =
          isRecord(msg.payload) && "item" in msg.payload ? coerceActionQueueItem((msg.payload as Record<string, unknown>).item) : null;
        const item = fromTop ?? fromPayload;
        if (!item) return;
        setQueue((prev) => {
          const idx = prev.findIndex((p) => p.id === item.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = pickNewer(next[idx]!, item);
            return next;
          }
          return [item, ...prev].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        });
        return;
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [
    user,
    wsUrl,
    propertyId,
    refreshAiInsights,
    refreshElevators,
    refreshFrontDesk,
    refreshHousekeeping,
    refreshKpis
  ]);

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-xs text-cortai-text2">
          {t("selectProperty")}
        </p>
      </div>
    );
  }

  const dash = t("common.dash");
  const fmtDuration = (seconds: number) =>
    fmtSeconds(seconds, { dash, seconds: t("common.seconds"), minutes: t("common.minutes") });
  const severityLabel = (severity: string) => t(`severity.${severity || "info"}`);
  const statusLabel = (status: string) => t(`status.${status || "unknown"}`);
  const typeLabel = (type: string) => t(`queue.types.${type || "unknown"}`);
  const directionLabel = (direction: string | null) =>
    direction ? t(`elevators.directions.${direction}`) : dash;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-cortai-text2">
          <Button type="button" variant="ghost" onClick={() => void refreshAll()}>
            {t("refresh")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-cortai-red/25 bg-cortai-red/10 p-3 text-xs text-cortai-red">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label={t("kpis.occupancy")}
          value={kpis ? `${kpis.occupancy_pct.toFixed(0)}%` : loading ? dash : dash}
          sub={kpis ? `${kpis.occupancy_rooms.used}/${kpis.occupancy_rooms.total}` : t("kpis.today")}
        />
        <KpiTile
          label={t("kpis.arrivals")}
          value={kpis ? String(kpis.arrivals_today.count) : loading ? dash : dash}
          sub={kpis ? `${t("kpis.arrived")}: ${kpis.arrivals_today.arrived}` : t("kpis.today")}
        />
        <KpiTile
          label={t("kpis.departures")}
          value={kpis ? String(kpis.departures_today.count) : loading ? dash : dash}
          sub={kpis ? `${t("kpis.departed")}: ${kpis.departures_today.departed}` : t("kpis.today")}
        />
        <KpiTile
          label={t("kpis.guests")}
          value={kpis ? String(kpis.guests_in_hotel) : loading ? dash : dash}
          sub={kpis ? `${kpis.guests_in_hotel}/${kpis.guests_total_capacity}` : t("kpis.operations")}
        />
        <KpiTile
          label={t("kpis.housekeeping")}
          value={kpis ? String(kpis.rooms_ready) : loading ? dash : dash}
          sub={t("kpis.progress")}
        />
        <KpiTile
          label={t("kpis.cleaning")}
          value={kpis ? String(kpis.rooms_cleaning) : loading ? dash : dash}
          sub={t("kpis.operations")}
        />
        <KpiTile
          label={t("kpis.staff")}
          value={kpis ? String(kpis.staff_on_duty) : loading ? dash : dash}
          sub={kpis ? `${t("kpis.onSite")}: ${kpis.staff_on_site}` : t("kpis.operations")}
        />
        <KpiTile
          label={t("kpis.alerts")}
          value={header ? String(header.active_alerts) : loading ? dash : dash}
          sub={header ? `${t("kpis.rating")}: ${header.rating.toFixed(1)}` : t("kpis.operations")}
        />
      </div>

      <Card title={t("ai.title")} action={header ? <Badge tone={header.ai_live ? "green" : "amber"}>{header.ai_live ? t("ai.live") : t("ai.stub")}</Badge> : null}>
        {aiInsights?.cards?.length ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {aiInsights.cards.slice(0, 3).map((c) => (
              <div key={c.id} className="rounded-md border border-cortai-border bg-cortai-bg2 p-3">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-semibold text-cortai-text">{c.title}</div>
                  <div className="ml-auto">
                    <Badge tone={severityTone(String(c.severity ?? ""))}>{severityLabel(String(c.severity ?? "info"))}</Badge>
                  </div>
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-cortai-text2">{c.body_md}</pre>
                {c.action_label ? (
                  <div className="mt-2 text-[11px] text-cortai-text3">{c.action_label}</div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-cortai-text3">{loading ? t("ai.loading") : t("ai.empty")}</div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={t("queue.title")}>
            <Table headers={[t("queue.cols.severity"), t("queue.cols.title"), t("queue.cols.room"), t("queue.cols.status"), t("queue.cols.assigned")]}>
              {queue.length === 0 ? (
                <tr>
                  <Td className="text-cortai-text3" colSpan={5}>
                    {loading ? t("queue.loading") : t("queue.empty")}
                  </Td>
                </tr>
              ) : null}
              {queue.map((q) => (
                <tr key={q.id}>
                  <Td>
                    <Badge tone={severityTone(q.severity)}>{severityLabel(q.severity)}</Badge>
                  </Td>
                  <Td className="max-w-[520px]">
                    <div className="font-semibold">{q.title}</div>
                    <div className="text-[11px] text-cortai-text3">{typeLabel(q.type)}</div>
                  </Td>
                  <Td>{q.room_id ? q.room_id.slice(0, 8) : dash}</Td>
                  <Td>
                    <Badge tone={statusTone(q.status)}>{statusLabel(q.status)}</Badge>
                  </Td>
                  <Td className="text-cortai-text2">{q.assigned_to_user_id ? q.assigned_to_user_id.slice(0, 8) : dash}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card title={t("frontDesk.title")}>
            {frontDesk ? (
              <div className="grid grid-cols-2 gap-3">
                <KpiTile label={t("frontDesk.servedToday")} value={String(frontDesk.served_today)} />
                <KpiTile label={t("frontDesk.inQueueNow")} value={String(frontDesk.in_queue_now)} />
                <KpiTile label={t("frontDesk.avgQueue")} value={fmtDuration(frontDesk.queue_avg_seconds)} />
                <KpiTile label={t("frontDesk.avgCheckin")} value={fmtDuration(frontDesk.checkin_avg_seconds)} />
              </div>
            ) : (
              <div className="text-xs text-cortai-text3">{loading ? dash : dash}</div>
            )}
          </Card>

          <Card title={t("elevators.title")}>
            {Object.keys(elevators).length ? (
              <div className="grid gap-2">
                {Object.values(elevators).slice(0, 4).map((e) => (
                  <div key={e.id} className="rounded-md border border-cortai-border bg-cortai-bg2 p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-cortai-text">{e.name}</div>
                      <div className="ml-auto">
                        <Badge tone={e.status === "offline" ? "red" : "teal"}>{statusLabel(String(e.status))}</Badge>
                      </div>
                    </div>
                    <div className="mt-1 text-cortai-text2">
                      {t("elevators.floor")}: {e.current_floor ?? dash} · {t("elevators.direction")}: {directionLabel(e.direction)} ·{" "}
                      {t("elevators.riders")}: {e.riders_today ?? dash}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-cortai-text3">{t("elevators.empty")}</div>
            )}
          </Card>

          <Card title={t("housekeeping.title")}>
            {housekeeping ? (
              <div className="grid grid-cols-2 gap-3">
                <KpiTile label={t("housekeeping.roomsAssigned")} value={String(housekeeping.rooms_assigned)} />
                <KpiTile label={t("housekeeping.staffCount")} value={String(housekeeping.staff_count)} />
                <KpiTile label={t("housekeeping.donePct")} value={`${housekeeping.done_pct.toFixed(0)}%`} />
                <KpiTile label={t("housekeeping.avgClean")} value={fmtDuration(housekeeping.avg_clean_seconds)} />
              </div>
            ) : (
              <div className="text-xs text-cortai-text3">{loading ? dash : dash}</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

