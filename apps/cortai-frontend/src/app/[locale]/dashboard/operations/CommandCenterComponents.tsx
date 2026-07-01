"use client";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Table, Td } from "@/components/ui/Table";
import type {
  ActionQueueItem,
  AiInsights,
  ElevatorState,
  FbStatus,
  FitnessCapacity,
  FrontDeskStats,
  HousekeepingSummary,
  MeetingBookingList,
  OperationsHeader,
  OperationsKpis,
  PoolSpaStatus
} from "./CommandCenterTypes";

type Tone = "teal" | "blue" | "amber" | "red" | "green";

function toneText(tone: Tone | "neutral") {
  const styles = {
    amber: "text-cortai-amber",
    blue: "text-cortai-blue",
    green: "text-cortai-green",
    neutral: "text-cortai-text2",
    red: "text-cortai-red",
    teal: "text-cortai-teal"
  };
  return styles[tone];
}

function toneBg(tone: Tone | "neutral") {
  const styles = {
    amber: "bg-cortai-amber",
    blue: "bg-cortai-blue",
    green: "bg-cortai-green",
    neutral: "bg-cortai-text3",
    red: "bg-cortai-red",
    teal: "bg-cortai-teal"
  };
  return styles[tone];
}

function toneHex(tone: Tone | "neutral") {
  const map: Record<string, string> = {
    amber: "#f59e0b",
    blue: "#3b82f6",
    green: "#10b981",
    neutral: "#4d607e",
    red: "#ef4444",
    teal: "#00c4a3"
  };
  return map[tone] ?? "#00c4a3";
}

function RingGauge({
  percent,
  tone = "teal",
  size = 44
}: {
  percent: number;
  tone?: Tone;
  size?: number;
}) {
  const safePercent = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const r = size / 2 - 4;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference - (safePercent / 100) * circumference;
  const color = toneHex(tone);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#243552"
          strokeWidth="3.5"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center font-mono font-semibold"
        style={{ fontSize: size < 48 ? 9 : 11, color }}
      >
        {safePercent.toFixed(0)}%
      </div>
    </div>
  );
}

function MiniStat({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div>
      <div className="text-[10px] text-cortai-text2">{label}</div>
      <div
        className="mt-0.5 font-mono text-[17px] font-bold leading-none text-cortai-text"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[9px]" style={{ color: valueColor ?? "#4d607e" }}>{sub}</div> : null}
    </div>
  );
}

export function KpiTile({
  label,
  value,
  sub,
  percent,
  testId
}: {
  label: string;
  value: string;
  sub?: string;
  percent?: number;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-cortai-border bg-cortai-bg3 p-3" {...(testId ? { "data-testid": testId } : {})}>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-cortai-text2">{label}</div>
        <div className="mt-0.5 font-mono text-xl font-bold leading-none text-cortai-text">{value}</div>
        {sub ? <div className="mt-0.5 text-[10px] text-cortai-text3">{sub}</div> : null}
      </div>
      {typeof percent === "number" ? <RingGauge percent={percent} /> : null}
    </div>
  );
}

export function KpiTilesPanel({
  dash,
  kpis,
  labels,
  loading
}: {
  dash: string;
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
    <div className="grid grid-cols-2 gap-2.5">
      <KpiTile
        label={labels.occupancy}
        value={kpis ? `${kpis.occupancy_pct.toFixed(0)}%` : fallback}
        sub={kpis ? `${kpis.occupancy_rooms.used}/${kpis.occupancy_rooms.total}` : labels.today}
        percent={kpis?.occupancy_pct}
        testId="kpi-tile-occupancy"
      />
      <KpiTile
        label={labels.guests}
        value={kpis ? String(kpis.guests_in_hotel) : fallback}
        sub={kpis ? `${kpis.guests_in_hotel}/${kpis.guests_total_capacity}` : labels.operations}
        percent={kpis ? (kpis.guests_in_hotel / Math.max(kpis.guests_total_capacity, 1)) * 100 : undefined}
        testId="kpi-tile-guests"
      />
      <KpiTile
        label={labels.arrivals}
        value={kpis ? String(kpis.arrivals_today.count) : fallback}
        sub={kpis ? `${labels.arrived}: ${kpis.arrivals_today.arrived}` : labels.today}
        percent={kpis ? (kpis.arrivals_today.arrived / Math.max(kpis.arrivals_today.count, 1)) * 100 : undefined}
        testId="kpi-tile-arrivals"
      />
      <KpiTile
        label={labels.departures}
        value={kpis ? String(kpis.departures_today.count) : fallback}
        sub={kpis ? `${labels.departed}: ${kpis.departures_today.departed}` : labels.today}
        percent={kpis ? (kpis.departures_today.departed / Math.max(kpis.departures_today.count, 1)) * 100 : undefined}
        testId="kpi-tile-departures"
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
  const badgeLabel = header ? (header.ai_live ? labels.live : labels.stub) : null;

  return (
    <section
      className="overflow-hidden rounded-[10px]"
      style={{ background: "linear-gradient(135deg, #0f1d35, #112040)", border: "1px solid #1e3050" }}
    >
      <header className="flex items-center gap-2.5 px-4 pb-2 pt-3">
        <div
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ background: "rgba(0,196,163,0.12)" }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" stroke="#00c4a3" fill="none" strokeWidth="2" aria-hidden="true">
            <polygon points="13,2 3,14 12,14 11,22 21,10 12,10" />
          </svg>
        </div>
        <h2 className="flex-1 text-sm font-semibold text-cortai-text">{title}</h2>
        {badgeLabel ? (
          <span className="rounded-[10px] border border-cortai-border bg-cortai-bg4 px-2 py-0.5 text-[10px] text-cortai-text3">
            {badgeLabel}
          </span>
        ) : null}
      </header>

      {aiInsights?.cards?.length ? (
        <>
          <div className="px-4 pb-2 text-xs text-cortai-text2">
            {aiInsights.cards[0]?.body_md?.split("\n")[0] ?? ""}
          </div>
          <div className="grid gap-2.5 px-4 pb-3.5 sm:grid-cols-3">
            {aiInsights.cards.slice(0, 3).map((card) => {
              const tone = severityTone(String(card.severity ?? ""));
              const color = toneHex(tone);
              return (
                <div
                  key={card.id}
                  className="rounded-lg p-2.5"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <div
                    className="mb-1 text-[9px] font-bold uppercase tracking-[0.08em]"
                    style={{ color }}
                  >
                    {card.title}
                  </div>
                  <div className="text-[11px] leading-[1.55] text-cortai-text2">
                    {card.body_md}
                  </div>
                  {card.action_label ? (
                    <div className="mt-1.5 text-[10px]" style={{ color }}>
                      {card.action_label}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="px-4 pb-4 text-xs text-cortai-text3">
          {loading ? loadingLabel : emptyLabel}
        </div>
      )}
    </section>
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
  const guestCount = queue.filter((item) => item.guest_id || item.type === "request" || item.type === "vip").length;
  const alertCount = queue.filter((item) => item.severity === "urgent" || item.severity === "high" || item.type === "system_alert").length;

  return (
    <Card
      title={title}
      action={
        <div className="flex items-center gap-1.5">
          <Badge tone="neutral">{queue.length} queue</Badge>
          <Badge tone="teal">{guestCount} guests</Badge>
          <Badge tone="red">{alertCount} alerts</Badge>
        </div>
      }
    >
      <Table headers={columnHeaders}>
        {queue.length === 0 ? (
          <tr>
            <Td className="text-cortai-text3" colSpan={6}>
              {loading ? loadingLabel : emptyLabel}
            </Td>
          </tr>
        ) : null}
        {queue.slice(0, 8).map((item) => {
          const svTone = severityTone(item.severity);
          const accentColor = toneHex(svTone);
          return (
            <tr key={item.id}>
              <Td>
                <div className="flex items-center gap-2">
                  <div
                    className="h-8 w-0.5 shrink-0 rounded-sm"
                    style={{ background: accentColor }}
                    aria-hidden="true"
                  />
                  <Badge tone={svTone}>{severityLabel(item.severity)}</Badge>
                </div>
              </Td>
              <Td className="max-w-[420px]">
                <div className="text-xs font-medium text-cortai-text">{item.title}</div>
                <div className="text-[10px] text-cortai-text3">{typeLabel(item.type)}</div>
              </Td>
              <Td>
                <span className="font-mono text-[11px] font-semibold text-cortai-text">
                  {item.room_id ? item.room_id.slice(0, 8) : dash}
                </span>
              </Td>
              <Td>
                <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
              </Td>
              <Td className="text-[11px] text-cortai-text2">
                {item.assigned_to_user_id ? item.assigned_to_user_id.slice(0, 8) : dash}
              </Td>
              <Td>
                {!item.assigned_to_user_id && canAssign ? (
                  <button
                    type="button"
                    onClick={() => onAssign(item)}
                    data-testid={`command-center-assign-${item.id}`}
                    className="rounded-md border border-cortai-border2 bg-cortai-bg4 px-3 py-1 text-[11px] font-medium text-cortai-text hover:bg-cortai-bg5"
                  >
                    {assignLabel}
                  </button>
                ) : null}
              </Td>
            </tr>
          );
        })}
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
    <Card
      title={labels.title}
      action={
        frontDesk ? (
          <Badge tone="teal">{frontDesk.in_queue_now} in queue</Badge>
        ) : undefined
      }
    >
      {frontDesk ? (
        <div className="grid grid-cols-2 gap-0">
          <div className="pr-4">
            <div className="font-mono text-[26px] font-bold leading-none text-cortai-text">
              {frontDesk.served_today}
            </div>
            <div className="mt-1 text-[10px] text-cortai-text2">{labels.servedToday}</div>
            <div className="mt-3 font-mono text-[18px] font-semibold leading-none text-cortai-text">
              {fmtDuration(frontDesk.queue_avg_seconds)}
            </div>
            <div className="mt-1 text-[10px] text-cortai-text2">{labels.avgQueue}</div>
          </div>
          <div className="border-l border-cortai-border pl-4">
            <div className="font-mono text-[26px] font-bold leading-none text-cortai-text">
              {frontDesk.in_queue_now}
            </div>
            <div className="mt-1 text-[10px] text-cortai-text2">{labels.inQueueNow}</div>
            <div className="mt-3 font-mono text-[18px] font-semibold leading-none text-cortai-text">
              {fmtDuration(frontDesk.checkin_avg_seconds)}
            </div>
            <div className="mt-1 text-[10px] text-cortai-text2">{labels.avgCheckin}</div>
          </div>
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
  const items = Object.values(elevators).slice(0, 3);
  const offlineCount = Object.values(elevators).filter((e) => e.status === "offline").length;
  const ridersTotal = Object.values(elevators).reduce((sum, e) => sum + (e.riders_today ?? 0), 0);

  return (
    <Card
      title={labels.title}
      action={
        offlineCount ? (
          <Badge tone="red">{offlineCount} offline</Badge>
        ) : (
          <Badge tone="teal">Running</Badge>
        )
      }
    >
      {items.length ? (
        <div>
          <div className="grid grid-cols-3 gap-3.5">
            {items.map((elevator) => {
              const isOffline = elevator.status === "offline";
              const floorNum = typeof elevator.current_floor === "number" ? elevator.current_floor : 1;
              const maxFloors = 12;
              const positionPct = Math.min(Math.max(((floorNum - 1) / (maxFloors - 1)) * 100, 2), 90);
              const shaftBorder = isOffline ? "rgba(239,68,68,0.35)" : "#243552";
              const carBg = isOffline ? "rgba(239,68,68,0.15)" : "rgba(0,196,163,0.1)";
              const carBorder = isOffline ? "rgba(239,68,68,0.4)" : "#1e2d44";
              const carColor = isOffline ? "#ef4444" : "#00c4a3";

              return (
                <div key={elevator.id} className="text-center">
                  <div className="mb-1 font-mono text-[11px] font-semibold text-cortai-text2">
                    {elevator.name}
                  </div>
                  <div
                    className="text-[9px] inline-block rounded-lg px-2 py-0.5 mb-1.5"
                    style={{
                      background: isOffline ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.12)",
                      color: isOffline ? "#ef4444" : "#10b981"
                    }}
                  >
                    {statusLabel(elevator.status)}
                  </div>
                  {/* elevator shaft */}
                  <div
                    className="relative mx-auto rounded-md"
                    style={{
                      width: 64,
                      height: 110,
                      background: "#1a2540",
                      border: `1px solid ${shaftBorder}`,
                      overflow: "hidden"
                    }}
                  >
                    {/* car */}
                    <div
                      className="absolute left-1 right-1 flex items-center justify-center rounded font-mono text-[10px] font-bold transition-all duration-[2000ms]"
                      style={{
                        height: 22,
                        bottom: `${positionPct}%`,
                        background: carBg,
                        border: `1px solid ${carBorder}`,
                        color: carColor
                      }}
                    >
                      {elevator.current_floor ?? dash}
                      {elevator.direction === "up" ? " ↑" : elevator.direction === "down" ? " ↓" : ""}
                    </div>
                  </div>
                  <div className="mt-1.5 text-[10px] text-cortai-text3">
                    {labels.riders}: {elevator.riders_today ?? dash}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-0 border-t border-cortai-border pt-3">
            <div className="pr-2.5">
              <div className="font-mono text-xl font-bold text-cortai-text">{ridersTotal}</div>
              <div className="text-[10px] text-cortai-text2">{labels.riders} today</div>
            </div>
            <div className="border-l border-cortai-border pl-2.5">
              <div className="font-mono text-xl font-bold text-cortai-text">
                {items[0] ? directionLabel(items[0].direction) : dash}
              </div>
              <div className="text-[10px] text-cortai-text2">{labels.direction}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-cortai-text3">{labels.empty}</div>
      )}
    </Card>
  );
}

function ProgressBar({ value, tone = "teal" }: { value: number; tone?: Tone }) {
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: "#243552" }}>
      <div
        className={`h-full rounded-full ${toneBg(tone)}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
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
    <Card
      title={labels.title}
      action={
        housekeeping ? (
          <div className="flex items-center gap-1.5">
            <Badge tone="neutral">{housekeeping.rooms_assigned} rooms</Badge>
            <Badge tone="amber">{housekeeping.staff_count} staff</Badge>
          </div>
        ) : undefined
      }
    >
      {housekeeping ? (
        <div className="flex items-center gap-5">
          {/* ring gauges */}
          <div className="flex shrink-0 flex-col items-center gap-1">
            <RingGauge percent={housekeeping.done_pct} tone="teal" size={52} />
            <div className="text-[9px] text-cortai-text2 text-center">Done {housekeeping.rooms_assigned}</div>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-1">
            <RingGauge
              percent={Math.min(100, (housekeeping.rooms_assigned / Math.max(housekeeping.staff_count, 1)) * 10)}
              tone="amber"
              size={52}
            />
            <div className="text-[9px] text-cortai-text2 text-center">Efficiency</div>
          </div>
          {/* stats */}
          <div className="flex flex-1 gap-4">
            <MiniStat label={labels.avgClean} value={fmtDuration(housekeeping.avg_clean_seconds)} />
            <MiniStat
              label={labels.donePct}
              value={`${housekeeping.done_pct.toFixed(0)}%`}
              valueColor="#00c4a3"
            />
            <MiniStat label={labels.roomsAssigned} value={String(housekeeping.rooms_assigned)} />
            <MiniStat label={labels.staffCount} value={String(housekeeping.staff_count)} />
          </div>
        </div>
      ) : (
        <div className="text-xs text-cortai-text3">{loading ? dash : dash}</div>
      )}
    </Card>
  );
}

export function LobbyWashroomPanel() {
  const washrooms = [
    { name: "Men's", uses: 16, trigger: 15, percent: 100, last: "1:15 PM · Rashid D.", tone: "red" as Tone },
    { name: "Women's", uses: 14, trigger: 15, percent: 92, last: "1:20 PM · Ana M.", tone: "red" as Tone },
    { name: "Accessible", uses: 8, trigger: 15, percent: 53, last: "2:00 PM · Elena T.", tone: "teal" as Tone }
  ];

  return (
    <Card
      title="Lobby Washroom"
      action={
        <div className="flex items-center gap-3 text-[10px] text-cortai-text3">
          <span>/ 15 use trigger</span>
          <span className="cursor-pointer text-cortai-teal">All washrooms ›</span>
        </div>
      }
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: "1fr 1px 1fr 1px 1fr",
          gap: 0
        }}
      >
        {washrooms.map((w, i) => (
          <>
            {i > 0 ? (
              <div key={`sep-${i}`} className="bg-cortai-border" />
            ) : null}
            <div key={w.name} style={{ padding: i === 1 ? "0 16px" : i === 2 ? "0 0 0 16px" : "0 16px 0 0" }}>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-cortai-text3">
                  {w.name}
                </div>
                {w.percent >= 90 ? (
                  <div
                    className="rounded px-1.5 py-0.5 text-[9px] font-bold text-cortai-red"
                    style={{ background: "rgba(239,68,68,0.12)" }}
                  >
                    CLEAN NOW
                  </div>
                ) : null}
              </div>
              <div className="mb-2 flex items-center gap-2.5">
                <RingGauge percent={w.percent} tone={w.tone} size={38} />
                <div>
                  <div className={`font-mono text-[22px] font-extrabold leading-none ${toneText(w.tone)}`}>
                    {w.uses}
                    <span className="text-[13px] font-normal text-cortai-text3">/{w.trigger}</span>
                  </div>
                  <div className="mt-0.5 text-[9px] text-cortai-text3">
                    {w.trigger - w.uses <= 0 ? (
                      <span className="font-semibold text-cortai-red">Threshold reached</span>
                    ) : (
                      `${w.trigger - w.uses} remaining`
                    )}
                  </div>
                </div>
              </div>
              <ProgressBar value={w.percent} tone={w.tone} />
              <div className="mt-1.5 text-[10px] text-cortai-text3">
                Last: <span className="text-cortai-text2">{w.last}</span>
              </div>
              {w.percent >= 90 ? (
                <button
                  type="button"
                  className="mt-2 w-full rounded border px-2 py-1 text-[9px] font-semibold text-cortai-red"
                  style={{ background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.3)" }}
                >
                  Dispatch HK
                </button>
              ) : null}
            </div>
          </>
        ))}
      </div>
    </Card>
  );
}

function setupStatusTone(s: string): Tone | "neutral" {
  if (s === "in_use") return "green";
  if (s === "ready") return "teal";
  if (s === "setup") return "amber";
  if (s === "breakdown") return "blue";
  return "neutral";
}

function fmtMeetingTime(startsAt: string, endsAt: string): string {
  const now = new Date();
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (now >= start && now <= end) {
    const minsLeft = Math.round((end.getTime() - now.getTime()) / 60000);
    return `${minsLeft}m left`;
  }
  return start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isTodayOrFuture(startsAt: string): boolean {
  const start = new Date(startsAt);
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return start < todayEnd;
}

export function AmenitiesOverviewPanel({
  fbStatus,
  fitnessCapacity,
  poolSpaStatus,
  meetingBookings,
  loading,
  dash
}: {
  fbStatus: FbStatus | null;
  fitnessCapacity: FitnessCapacity | null;
  poolSpaStatus: PoolSpaStatus | null;
  meetingBookings: MeetingBookingList | null;
  loading: boolean;
  dash: string;
}) {
  const todayBookings = (meetingBookings?.items ?? []).filter((b) => isTodayOrFuture(b.starts_at)).slice(0, 5);

  return (
    <div className="grid gap-3.5 xl:grid-cols-3">
      {/* F&B + Fitness stacked */}
      <div className="flex flex-col gap-3.5">
        <Card title="Food & Breakfast">
          <div className="grid" style={{ gridTemplateColumns: "1fr 1px 1fr", gap: 0 }}>
            <div className="pr-3.5">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">Breakfast</div>
              <div className="flex gap-3.5">
                <MiniStat label="Served" value={fbStatus ? String(fbStatus.served_today) : dash} />
                <MiniStat label="Dwell" value={fbStatus ? `${fbStatus.dwell_avg_min}m` : dash} />
              </div>
            </div>
            <div className="bg-cortai-border" />
            <div className="pl-3.5">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">Café</div>
              <div className="flex gap-3.5">
                <MiniStat label="Served" value={fbStatus ? String(fbStatus.cafe_served_today) : dash} />
                <MiniStat label="Dine-in" value={fbStatus ? `${fbStatus.cafe_dwell_avg_min}m` : dash} />
              </div>
            </div>
          </div>
        </Card>

        <Card
          title="Fitness Today"
          action={
            fitnessCapacity ? (
              <Badge tone="neutral">{fitnessCapacity.capacity} capacity</Badge>
            ) : undefined
          }
        >
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <MiniStat label="Now" value={fitnessCapacity ? String(fitnessCapacity.count) : dash} />
            <MiniStat label="Total" value={fitnessCapacity ? String(fitnessCapacity.total_today) : dash} />
            <MiniStat label="Avg Session" value={fitnessCapacity ? `${fitnessCapacity.avg_session_min}m` : dash} />
            {fitnessCapacity?.temp_f != null ? (
              <MiniStat label="Temp" value={`${fitnessCapacity.temp_f}°F`} valueColor="#10b981" />
            ) : null}
            {fitnessCapacity?.humidity_pct != null ? (
              <MiniStat label="Humidity" value={`${fitnessCapacity.humidity_pct}%`} valueColor="#00c4a3" />
            ) : null}
          </div>
        </Card>
      </div>

      {/* Pool & Spa */}
      <Card title="Pool & Spa">
        <div className="grid" style={{ gridTemplateColumns: "1fr 1px 1fr", gap: 0 }}>
          <div className="pr-3.5">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">Pool</div>
            <div className="mb-2.5 flex gap-3">
              <MiniStat label="Now" value={poolSpaStatus ? String(poolSpaStatus.pool_count) : dash} />
              <MiniStat label="Total" value={poolSpaStatus ? String(poolSpaStatus.pool_total_today) : dash} />
              <MiniStat label="Avg" value={poolSpaStatus ? `${poolSpaStatus.pool_avg_dwell_min}m` : dash} />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <MiniStat label="Temp" value={poolSpaStatus ? `${poolSpaStatus.pool_temp_f}°F` : dash} valueColor="#10b981" />
              <MiniStat label="Humidity" value={poolSpaStatus ? `${poolSpaStatus.pool_humidity_pct}%` : dash} valueColor="#00c4a3" />
              <MiniStat label="Dwell" value={poolSpaStatus ? `${poolSpaStatus.pool_avg_dwell_min}m` : dash} />
              <MiniStat label="Room" value={poolSpaStatus ? `${poolSpaStatus.pool_room_temp_f}°F` : dash} valueColor="#10b981" />
            </div>
          </div>
          <div className="bg-cortai-border" />
          <div className="pl-3.5">
            <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">Spa / Hot Tub</div>
            <div className="mb-2.5 flex gap-3">
              <MiniStat label="Now" value={poolSpaStatus ? String(poolSpaStatus.spa_count) : dash} />
              <MiniStat label="Total" value={poolSpaStatus ? String(poolSpaStatus.spa_total_today) : dash} />
              <MiniStat label="Avg" value={poolSpaStatus ? `${poolSpaStatus.spa_avg_session_min}m` : dash} />
            </div>
            {poolSpaStatus ? (
              <>
                <div
                  className="font-mono text-[22px] font-bold"
                  style={{ color: poolSpaStatus.hot_tub_temp_f > 100 ? "#f59e0b" : "#10b981" }}
                >
                  {poolSpaStatus.hot_tub_temp_f}°F
                </div>
                <div className="mt-0.5 text-[10px] text-cortai-text2">Temp</div>
                {poolSpaStatus.hot_tub_temp_f > 100 ? (
                  <div
                    className="mt-1.5 rounded-md px-2 py-1.5 text-[9px] text-cortai-amber"
                    style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
                  >
                    Above optimal — monitor
                  </div>
                ) : null}
              </>
            ) : (
              <div className="text-[10px] text-cortai-text3">{loading ? dash : dash}</div>
            )}
          </div>
        </div>
      </Card>

      {/* Today's Meetings & Events */}
      <Card
        title="Today's Meetings & Events"
        action={<Badge tone="blue">{todayBookings.length} events</Badge>}
      >
        <div>
          <div
            className="grid border-b border-cortai-border px-3.5 py-1.5"
            style={{ gridTemplateColumns: "1fr auto auto", background: "#1a2540" }}
          >
            <div className="text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3">Event</div>
            <div className="pr-3.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3">Time</div>
            <div className="text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3">Status</div>
          </div>
          {todayBookings.length === 0 ? (
            <div className="px-3.5 py-3 text-[11px] text-cortai-text3">
              {loading ? dash : "No events today"}
            </div>
          ) : null}
          {todayBookings.map((booking) => (
            <div
              key={booking.id}
              className="grid items-center border-b border-cortai-border/50 px-3.5 py-2.5 last:border-0"
              style={{ gridTemplateColumns: "1fr auto auto" }}
            >
              <div>
                <div className="text-xs font-medium text-cortai-text">{booking.title}</div>
                <div className="mt-0.5 text-[10px] text-cortai-text3">
                  {booking.attendees_count} attendees
                </div>
              </div>
              <div className="pr-3.5 text-[11px] text-cortai-text2 whitespace-nowrap">
                {fmtMeetingTime(booking.starts_at, booking.ends_at)}
              </div>
              <div>
                <Badge tone={setupStatusTone(booking.setup_status)}>
                  {booking.setup_status.replace("_", " ")}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
