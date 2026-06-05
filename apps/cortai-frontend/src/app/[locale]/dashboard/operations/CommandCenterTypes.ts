export type OperationsKpis = {
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

export type ActionQueueItem = {
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

export type ActionQueueList = { items: ActionQueueItem[]; next_cursor: string | null };

export type FrontDeskStats = {
  served_today: number;
  in_queue_now: number;
  queue_avg_seconds: number;
  checkin_avg_seconds: number;
};

export type HousekeepingSummary = {
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

export type OperationsHeader = {
  property_id: string;
  ai_live: boolean;
  occupancy_pct: number;
  active_alerts: number;
  rating: number;
};

export type AiInsightCard = {
  id: string;
  kind: string;
  title: string;
  body_md: string;
  severity: string;
  action_label?: string | null;
  action_payload?: unknown;
};

export type AiInsights = { generated_at: string; cards: AiInsightCard[] };

export type ElevatorState = {
  id: string;
  name: string;
  status: string;
  direction: string | null;
  current_floor: number | null;
  riders_today: number | null;
  last_seen_at?: string | null;
};

export type LiveMsg = {
  type: string;
  org_id?: string;
  property_id?: string;
  payload?: unknown;
  item?: ActionQueueItem;
  _server_published_at_ms?: number;
};
