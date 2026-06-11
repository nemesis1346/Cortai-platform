"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Table, Td } from "@/components/ui/Table";
import type {
  ActionQueueItem,
  AiInsights,
  ElevatorState,
  FrontDeskStats,
  HousekeepingSummary,
  OperationsHeader,
  OperationsKpis
} from "./CommandCenterTypes";

type Tone = "teal" | "blue" | "amber" | "red" | "green";

export function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-cortai-text3">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-cortai-text">{value}</div>
      {sub ? <div className="mt-1 text-xs text-cortai-text2">{sub}</div> : null}
    </div>
  );
}

export function KpiTilesPanel({
  dash,
  header,
  kpis,
  labels,
  loading
}: {
  dash: string;
  header: OperationsHeader | null;
  kpis: OperationsKpis | null;
  labels: {
    alerts: string;
    arrived: string;
    arrivals: string;
    cleaning: string;
    departed: string;
    departures: string;
    guests: string;
    housekeeping: string;
    occupancy: string;
    onSite: string;
    operations: string;
    progress: string;
    rating: string;
    staff: string;
    today: string;
  };
  loading: boolean;
}) {
  const fallback = loading ? dash : dash;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiTile
        label={labels.occupancy}
        value={kpis ? `${kpis.occupancy_pct.toFixed(0)}%` : fallback}
        sub={kpis ? `${kpis.occupancy_rooms.used}/${kpis.occupancy_rooms.total}` : labels.today}
      />
      <KpiTile
        label={labels.arrivals}
        value={kpis ? String(kpis.arrivals_today.count) : fallback}
        sub={kpis ? `${labels.arrived}: ${kpis.arrivals_today.arrived}` : labels.today}
      />
      <KpiTile
        label={labels.departures}
        value={kpis ? String(kpis.departures_today.count) : fallback}
        sub={kpis ? `${labels.departed}: ${kpis.departures_today.departed}` : labels.today}
      />
      <KpiTile
        label={labels.guests}
        value={kpis ? String(kpis.guests_in_hotel) : fallback}
        sub={kpis ? `${kpis.guests_in_hotel}/${kpis.guests_total_capacity}` : labels.operations}
      />
      <KpiTile
        label={labels.housekeeping}
        value={kpis ? String(kpis.rooms_ready) : fallback}
        sub={labels.progress}
      />
      <KpiTile label={labels.cleaning} value={kpis ? String(kpis.rooms_cleaning) : fallback} sub={labels.operations} />
      <KpiTile
        label={labels.staff}
        value={kpis ? String(kpis.staff_on_duty) : fallback}
        sub={kpis ? `${labels.onSite}: ${kpis.staff_on_site}` : labels.operations}
      />
      <KpiTile
        label={labels.alerts}
        value={header ? String(header.active_alerts) : fallback}
        sub={header ? `${labels.rating}: ${header.rating.toFixed(1)}` : labels.operations}
      />
    </div>
  );
}

export function AiInsightsBanner({
  aiInsights,
  emptyLabel,
  header,
  labels,
  loading,
  loadingLabel,
  severityLabel,
  severityTone,
  title
}: {
  aiInsights: AiInsights | null;
  emptyLabel: string;
  header: OperationsHeader | null;
  labels: { live: string; stub: string };
  loading: boolean;
  loadingLabel: string;
  severityLabel: (severity: string) => string;
  severityTone: (severity: string) => Tone;
  title: string;
}) {
  return (
    <Card title={title} action={header ? <Badge tone={header.ai_live ? "green" : "amber"}>{header.ai_live ? labels.live : labels.stub}</Badge> : null}>
      {aiInsights?.cards?.length ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {aiInsights.cards.slice(0, 3).map((card) => (
            <div key={card.id} className="rounded-md border border-cortai-border bg-cortai-bg2 p-3">
              <div className="flex items-center gap-2">
                <div className="text-xs font-semibold text-cortai-text">{card.title}</div>
                <div className="ml-auto">
                  <Badge tone={severityTone(String(card.severity ?? ""))}>{severityLabel(String(card.severity ?? "info"))}</Badge>
                </div>
              </div>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-cortai-text2">{card.body_md}</pre>
              {card.action_label ? <div className="mt-2 text-[11px] text-cortai-text3">{card.action_label}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-cortai-text3">{loading ? loadingLabel : emptyLabel}</div>
      )}
    </Card>
  );
}

export function ActionQueueTable({
  assignLabel,
  canAssign,
  columnHeaders,
  dash,
  loading,
  loadingLabel,
  emptyLabel,
  onAssign,
  queue,
  severityLabel,
  severityTone,
  statusLabel,
  statusTone,
  title,
  typeLabel
}: {
  assignLabel: string;
  canAssign: boolean;
  columnHeaders: string[];
  dash: string;
  loading: boolean;
  loadingLabel: string;
  emptyLabel: string;
  onAssign: (item: ActionQueueItem) => void;
  queue: ActionQueueItem[];
  severityLabel: (severity: string) => string;
  severityTone: (severity: string) => Tone;
  statusLabel: (status: string) => string;
  statusTone: (status: string) => Tone;
  title: string;
  typeLabel: (type: string) => string;
}) {
  return (
    <Card title={title}>
      <Table headers={columnHeaders}>
        {queue.length === 0 ? (
          <tr>
            <Td className="text-cortai-text3" colSpan={6}>
              {loading ? loadingLabel : emptyLabel}
            </Td>
          </tr>
        ) : null}
        {queue.map((item) => (
          <tr key={item.id}>
            <Td>
              <Badge tone={severityTone(item.severity)}>{severityLabel(item.severity)}</Badge>
            </Td>
            <Td className="max-w-[520px]">
              <div className="font-semibold">{item.title}</div>
              <div className="text-[11px] text-cortai-text3">{typeLabel(item.type)}</div>
            </Td>
            <Td>{item.room_id ? item.room_id.slice(0, 8) : dash}</Td>
            <Td>
              <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
            </Td>
            <Td className="text-cortai-text2">{item.assigned_to_user_id ? item.assigned_to_user_id.slice(0, 8) : dash}</Td>
            <Td>
              {!item.assigned_to_user_id && canAssign ? (
                <Button type="button" variant="ghost" onClick={() => onAssign(item)} data-testid={`command-center-assign-${item.id}`}>
                  {assignLabel}
                </Button>
              ) : null}
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

export function FrontDeskPanel({
  dash,
  frontDesk,
  fmtDuration,
  labels,
  loading
}: {
  dash: string;
  frontDesk: FrontDeskStats | null;
  fmtDuration: (seconds: number) => string;
  labels: { avgCheckin: string; avgQueue: string; inQueueNow: string; servedToday: string; title: string };
  loading: boolean;
}) {
  return (
    <Card title={labels.title}>
      {frontDesk ? (
        <div className="grid grid-cols-2 gap-3">
          <KpiTile label={labels.servedToday} value={String(frontDesk.served_today)} />
          <KpiTile label={labels.inQueueNow} value={String(frontDesk.in_queue_now)} />
          <KpiTile label={labels.avgQueue} value={fmtDuration(frontDesk.queue_avg_seconds)} />
          <KpiTile label={labels.avgCheckin} value={fmtDuration(frontDesk.checkin_avg_seconds)} />
        </div>
      ) : (
        <div className="text-xs text-cortai-text3">{loading ? dash : dash}</div>
      )}
    </Card>
  );
}

export function ElevatorsPanel({
  dash,
  directionLabel,
  elevators,
  labels,
  statusLabel
}: {
  dash: string;
  directionLabel: (direction: string | null) => string;
  elevators: Record<string, ElevatorState>;
  labels: { direction: string; empty: string; floor: string; riders: string; title: string };
  statusLabel: (status: string) => string;
}) {
  return (
    <Card title={labels.title}>
      {Object.keys(elevators).length ? (
        <div className="grid gap-2">
          {Object.values(elevators).slice(0, 4).map((elevator) => (
            <div key={elevator.id} className="rounded-md border border-cortai-border bg-cortai-bg2 p-3 text-xs">
              <div className="flex items-center gap-2">
                <div className="font-semibold text-cortai-text">{elevator.name}</div>
                <div className="ml-auto">
                  <Badge tone={elevator.status === "offline" ? "red" : "teal"}>{statusLabel(String(elevator.status))}</Badge>
                </div>
              </div>
              <div className="mt-1 text-cortai-text2">
                {labels.floor}: {elevator.current_floor ?? dash} · {labels.direction}: {directionLabel(elevator.direction)} ·{" "}
                {labels.riders}: {elevator.riders_today ?? dash}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-cortai-text3">{labels.empty}</div>
      )}
    </Card>
  );
}

export function HousekeepingSummaryPanel({
  dash,
  fmtDuration,
  housekeeping,
  labels,
  loading
}: {
  dash: string;
  fmtDuration: (seconds: number) => string;
  housekeeping: HousekeepingSummary | null;
  labels: { avgClean: string; donePct: string; roomsAssigned: string; staffCount: string; title: string };
  loading: boolean;
}) {
  return (
    <Card title={labels.title}>
      {housekeeping ? (
        <div className="grid grid-cols-2 gap-3">
          <KpiTile label={labels.roomsAssigned} value={String(housekeeping.rooms_assigned)} />
          <KpiTile label={labels.staffCount} value={String(housekeeping.staff_count)} />
          <KpiTile label={labels.donePct} value={`${housekeeping.done_pct.toFixed(0)}%`} />
          <KpiTile label={labels.avgClean} value={fmtDuration(housekeeping.avg_clean_seconds)} />
        </div>
      ) : (
        <div className="text-xs text-cortai-text3">{loading ? dash : dash}</div>
      )}
    </Card>
  );
}
