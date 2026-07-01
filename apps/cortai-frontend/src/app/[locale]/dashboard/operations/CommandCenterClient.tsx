"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { useRealtimeSocket } from "@/hooks/use-realtime-socket";
import { Button } from "@/components/ui/Button";
import {
  ActionQueueTable,
  AmenitiesOverviewPanel,
  AiInsightsBanner,
  ElevatorsPanel,
  FrontDeskPanel,
  HousekeepingSummaryPanel,
  KpiTilesPanel,
  LobbyWashroomPanel
} from "./CommandCenterComponents";
import type {
  ActionQueueItem,
  ActionQueueList,
  AiInsights,
  ElevatorState,
  FbStatus,
  FitnessCapacity,
  FrontDeskStats,
  HousekeepingSummary,
  LiveMsg,
  MeetingBookingList,
  OperationsHeader,
  OperationsKpis,
  PoolSpaStatus
} from "./CommandCenterTypes";

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

function fmtSeconds(n: number, labels: { dash: string; seconds: string; minutes: string }) {
  if (!Number.isFinite(n) || n < 0) return labels.dash;
  if (n < 60) return `${Math.round(n)}${labels.seconds}`;
  const m = Math.round(n / 60);
  return `${m}${labels.minutes}`;
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
  const [fbStatus, setFbStatus] = useState<FbStatus | null>(null);
  const [fitnessCapacity, setFitnessCapacity] = useState<FitnessCapacity | null>(null);
  const [poolSpaStatus, setPoolSpaStatus] = useState<PoolSpaStatus | null>(null);
  const [meetingBookings, setMeetingBookings] = useState<MeetingBookingList | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastKpiRef = useRef<number>(0);

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
    setAiInsights(await apiFetch<AiInsights>(`/api/ai/v1/operations/insights?locale=${encodeURIComponent(t("common.locale"))}`));
  }, [t]);

  const refreshElevators = useCallback(async () => {
    if (!propertyId) return;
    const items = await apiFetch<ElevatorState[]>(`/api/iot/v1/elevators`);
    setElevators(Object.fromEntries(items.map((e) => [e.id, e])));
  }, [propertyId]);

  const assignToMe = useCallback(
    async (item: ActionQueueItem) => {
      if (!user) return;
      const updated = await apiFetch<ActionQueueItem>(`/api/operations/action-queue/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_to_user_id: user.id, status: "assigned" })
      });
      setQueue((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
    },
    [user]
  );

  const refreshAll = useCallback(async () => {
    setError(null);
    try {
      if (!propertyId) return;
      const pid = encodeURIComponent(propertyId);
      const [hdr, k, aq, fd, hk, ai, elv, fb, fit, pool, meetings] = await Promise.all([
        apiFetch<OperationsHeader>(`/api/operations/header?property_id=${pid}`),
        apiFetch<OperationsKpis>(`/api/operations/kpis?property_id=${pid}`),
        apiFetch<ActionQueueList>(`/api/operations/action-queue?limit=50&property_id=${pid}`),
        apiFetch<FrontDeskStats>(`/api/operations/front-desk/stats?property_id=${pid}`),
        apiFetch<HousekeepingSummary>(`/api/operations/housekeeping/summary?property_id=${pid}`),
        apiFetch<AiInsights>(`/api/ai/v1/operations/insights?locale=${encodeURIComponent(t("common.locale"))}`),
        apiFetch<ElevatorState[]>(`/api/iot/v1/elevators`),
        apiFetch<FbStatus>(`/api/operations/fb/breakfast/status?property_id=${pid}`),
        apiFetch<FitnessCapacity>(`/api/operations/fitness/capacity?property_id=${pid}`),
        apiFetch<PoolSpaStatus>(`/api/operations/pool/status?property_id=${pid}`),
        apiFetch<MeetingBookingList>(`/api/operations/meetings/bookings?property_id=${pid}&page_size=10`)
      ]);
      setHeader(hdr);
      setKpis(k);
      setQueue(aq.items);
      setFrontDesk(fd);
      setHousekeeping(hk);
      setAiInsights(ai);
      setElevators(Object.fromEntries(elv.map((e) => [e.id, e])));
      setFbStatus(fb);
      setFitnessCapacity(fit);
      setPoolSpaStatus(pool);
      setMeetingBookings(meetings);
      lastKpiRef.current = Date.now();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId, t]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleLiveMessage = useCallback(
    (message: Record<string, unknown>) => {
      const msg = message as LiveMsg;
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
      }
    },
    [refreshAiInsights, refreshElevators, refreshFrontDesk, refreshHousekeeping, refreshKpis]
  );

  useRealtimeSocket({
    enabled: Boolean(user && propertyId),
    propertyId,
    onMessage: handleLiveMessage,
    onReconnect: refreshAll
  });

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
    <div className="grid gap-4" data-testid="command-center-page">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-cortai-border bg-cortai-bg2 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-cortai-text2">
          <span className="rounded-pill border border-cortai-teal/25 bg-cortai-teal/10 px-3 py-1 text-[10px] font-semibold text-cortai-teal">
            AI Live / 30s
          </span>
          {header ? (
            <>
              <span className="rounded-md border border-cortai-border bg-cortai-bg3 px-2 py-1 font-mono">{header.occupancy_pct.toFixed(0)}%</span>
              <span className="rounded-md border border-cortai-border bg-cortai-bg3 px-2 py-1 font-mono">{header.active_alerts}</span>
              <span className="rounded-md border border-cortai-border bg-cortai-bg3 px-2 py-1 font-mono">{header.rating.toFixed(1)}</span>
            </>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => void refreshAll()} data-testid="command-center-refresh">
            {t("refresh")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-cortai-red/25 bg-cortai-red/10 p-3 text-xs text-cortai-red">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4">
          <AiInsightsBanner
            aiInsights={aiInsights}
            emptyLabel={t("ai.empty")}
            header={header}
            labels={{ live: t("ai.live"), stub: t("ai.stub") }}
            loading={loading}
            loadingLabel={t("ai.loading")}
            severityLabel={severityLabel}
            severityTone={severityTone}
            title={t("ai.title")}
          />

          <ActionQueueTable
            assignLabel={t("queue.assignToMe")}
            canAssign={Boolean(user)}
            columnHeaders={[
              t("queue.cols.severity"),
              t("queue.cols.title"),
              t("queue.cols.room"),
              t("queue.cols.status"),
              t("queue.cols.assigned"),
              t("queue.cols.actions")
            ]}
            dash={dash}
            emptyLabel={t("queue.empty")}
            loading={loading}
            loadingLabel={t("queue.loading")}
            onAssign={(item) => void assignToMe(item)}
            queue={queue}
            severityLabel={severityLabel}
            severityTone={severityTone}
            statusLabel={statusLabel}
            statusTone={statusTone}
            title={t("queue.title")}
            typeLabel={typeLabel}
          />

          <HousekeepingSummaryPanel
            dash={dash}
            fmtDuration={fmtDuration}
            housekeeping={housekeeping}
            labels={{
              avgClean: t("housekeeping.avgClean"),
              donePct: t("housekeeping.donePct"),
              roomsAssigned: t("housekeeping.roomsAssigned"),
              staffCount: t("housekeeping.staffCount"),
              title: t("housekeeping.title")
            }}
            loading={loading}
          />
        </div>

        <div className="grid gap-4">
          <KpiTilesPanel
            dash={dash}
            kpis={kpis}
            labels={{
              alerts: t("kpis.alerts"),
              arrived: t("kpis.arrived"),
              arrivals: t("kpis.arrivals"),
              cleaning: t("kpis.cleaning"),
              departed: t("kpis.departed"),
              departures: t("kpis.departures"),
              guests: t("kpis.guests"),
              housekeeping: t("kpis.housekeeping"),
              occupancy: t("kpis.occupancy"),
              onSite: t("kpis.onSite"),
              operations: t("kpis.operations"),
              progress: t("kpis.progress"),
              rating: t("kpis.rating"),
              staff: t("kpis.staff"),
              today: t("kpis.today")
            }}
            loading={loading}
          />

          <FrontDeskPanel
            dash={dash}
            frontDesk={frontDesk}
            fmtDuration={fmtDuration}
            labels={{
              avgCheckin: t("frontDesk.avgCheckin"),
              avgQueue: t("frontDesk.avgQueue"),
              inQueueNow: t("frontDesk.inQueueNow"),
              servedToday: t("frontDesk.servedToday"),
              title: t("frontDesk.title")
            }}
            loading={loading}
          />

          <ElevatorsPanel
            dash={dash}
            directionLabel={directionLabel}
            elevators={elevators}
            labels={{
              direction: t("elevators.direction"),
              empty: t("elevators.empty"),
              floor: t("elevators.floor"),
              riders: t("elevators.riders"),
              title: t("elevators.title")
            }}
            statusLabel={statusLabel}
          />
        </div>
      </div>

      <LobbyWashroomPanel />
      <AmenitiesOverviewPanel
        fbStatus={fbStatus}
        fitnessCapacity={fitnessCapacity}
        poolSpaStatus={poolSpaStatus}
        meetingBookings={meetingBookings}
        loading={loading}
        dash={dash}
      />
    </div>
  );
}

