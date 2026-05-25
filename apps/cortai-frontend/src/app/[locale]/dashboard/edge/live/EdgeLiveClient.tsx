"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";

type DevicePublic = {
  id: string;
  property_id: string | null;
  device_id: string;
  type: string;
  capabilities: string[];
  last_seen_at: string | null;
  is_offline: boolean;
  offline_since: string | null;
};

type LiveMsg = {
  type: string;
  org_id?: string;
  property_id?: string;
  topic_type?: string;
  device_id?: string;
  ts?: string;
  payload?: unknown;
  _broker_received_at_ms?: number;
  _server_published_at_ms?: number;
  _device_last_seen_at?: string;
  last_seen_at?: string;
  offline_since?: string;
};

type DeviceCardState = {
  device_id: string;
  last_seen_at: string | null;
  is_offline: boolean;
  offline_since: string | null;
  lastDetections: LiveMsg[];
  msgRate: number; // msg/s approx
  p50LatencyMs: number | null;
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

function fmtAgo(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function StatusBadge({ state }: { state: "ok" | "warn" | "bad" }) {
  const styles =
    state === "ok"
      ? "border-cortai-green/25 bg-cortai-green/10 text-cortai-green"
      : state === "warn"
        ? "border-cortai-amber/25 bg-cortai-amber/10 text-cortai-amber"
        : "border-cortai-red/25 bg-cortai-red/10 text-cortai-red";
  const label = state === "ok" ? "ONLINE" : state === "warn" ? "STALE" : "OFFLINE";
  return <span className={`rounded-pill border px-2 py-0.5 text-[10px] font-semibold ${styles}`}>{label}</span>;
}

function DetectionLine({ msg }: { msg: LiveMsg }) {
  const payload = msg.payload ? JSON.stringify(msg.payload) : "";
  return (
    <div className="flex gap-2 text-[11px] text-cortai-text2">
      <span className="font-mono text-cortai-text3">{msg.topic_type ?? msg.type}</span>
      <span className="truncate">{payload}</span>
    </div>
  );
}

export function EdgeLiveClient() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<DevicePublic[]>([]);
  const [cards, setCards] = useState<Record<string, DeviceCardState>>({});
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const propertyId = useMemo(() => getCookie("cortai_property_id") ?? "", []);
  const wsUrl = useMemo(() => toWsUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? ""), []);

  // Fetch devices for the selected property
  useEffect(() => {
    if (!propertyId) return;
    apiFetch<DevicePublic[]>(`/api/devices?property_id=${encodeURIComponent(propertyId)}`)
      .then((items) => {
        setDevices(items);
        setCards((prev) => {
          const next = { ...prev };
          for (const d of items) {
            next[d.device_id] = next[d.device_id] ?? {
              device_id: d.device_id,
              last_seen_at: d.last_seen_at,
              is_offline: Boolean(d.is_offline),
              offline_since: d.offline_since,
              lastDetections: [],
              msgRate: 0,
              p50LatencyMs: null
            };
          }
          return next;
        });
      })
      .catch((e) => setError(String(e)));
  }, [propertyId]);

  // Track message timestamps per device for msg/s and latency
  const msgTimesRef = useRef<Record<string, number[]>>({});
  const latencyRef = useRef<Record<string, number[]>>({});

  useEffect(() => {
    if (!user) return;
    if (!propertyId) return;

    setWsStatus("connecting");
    setError(null);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const interval = window.setInterval(() => {
      const now = Date.now();
      setCards((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          const times = (msgTimesRef.current[key] ?? []).filter((t) => now - t <= 5000);
          msgTimesRef.current[key] = times;
          const rate = times.length / 5;

          const lat = (latencyRef.current[key] ?? []).filter((v) => Number.isFinite(v) && v >= 0).slice(-50);
          latencyRef.current[key] = lat;
          const p50 = percentile(lat, 50);

          next[key] = { ...next[key], msgRate: Number.isFinite(rate) ? rate : 0, p50LatencyMs: p50 };
        }
        return next;
      });
    }, 1000);

    ws.onopen = () => {
      setWsStatus("connected");
      ws.send(JSON.stringify({ type: "subscribe", scope: "property", property_id: propertyId }));
    };
    ws.onerror = () => {
      setWsStatus("error");
      setError("websocket_error");
    };
    ws.onclose = () => {
      setWsStatus((s) => (s === "error" ? s : "idle"));
    };
    ws.onmessage = (event) => {
      let msg: LiveMsg | null = null;
      try {
        msg = JSON.parse(String(event.data)) as LiveMsg;
      } catch {
        return;
      }
      if (!msg) return;
      const did = msg.device_id ?? "";
      if (!did) return;

      const now = Date.now();
      msgTimesRef.current[did] = [...(msgTimesRef.current[did] ?? []), now].slice(-200);

      if (typeof msg._server_published_at_ms === "number" && typeof msg._broker_received_at_ms === "number") {
        const e2e = msg._server_published_at_ms - msg._broker_received_at_ms;
        latencyRef.current[did] = [...(latencyRef.current[did] ?? []), e2e].slice(-200);
      }

      setCards((prev) => {
        const base = prev[did] ?? {
          device_id: did,
          last_seen_at: null,
          is_offline: false,
          offline_since: null,
          lastDetections: [],
          msgRate: 0,
          p50LatencyMs: null
        };

        const nextLastSeen =
          msg._device_last_seen_at ?? msg.last_seen_at ?? base.last_seen_at;
        const offline = msg.type === "device_offline" ? true : base.is_offline;
        const offlineSince = msg.offline_since ?? base.offline_since;

        const isDetection = msg.topic_type === "detection";
        const nextDetections = isDetection ? [msg, ...base.lastDetections].slice(0, 10) : base.lastDetections;

        return {
          ...prev,
          [did]: {
            ...base,
            last_seen_at: nextLastSeen,
            is_offline: offline,
            offline_since: offlineSince,
            lastDetections: nextDetections
          }
        };
      });
    };

    return () => {
      window.clearInterval(interval);
      ws.close();
      wsRef.current = null;
    };
  }, [propertyId, user, wsUrl]);

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">Edge Live</h1>
        <p className="mt-1 text-xs text-cortai-text2">Select a property to view devices.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="edge-live-page">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Edge Live</h1>
          <p className="text-xs text-cortai-text2">
            WebSocket: {wsStatus} · target &lt;500ms
          </p>
        </div>
        {error ? <div className="ml-auto text-xs text-cortai-red">{error}</div> : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {devices.map((d) => {
          const c = cards[d.device_id];
          const lastSeen = c?.last_seen_at ?? d.last_seen_at;
          const offline = Boolean(c?.is_offline ?? d.is_offline);
          const offlineSince = c?.offline_since ?? d.offline_since;
          const stale = !offline && lastSeen ? Date.now() - new Date(lastSeen).getTime() > 60_000 : false;
          const status: "ok" | "warn" | "bad" = offline ? "bad" : stale ? "warn" : "ok";

          return (
            <div key={d.device_id} className="rounded-lg border border-cortai-border bg-cortai-bg2 p-3">
              <div className="flex items-center gap-2">
                <div className="font-semibold">{d.device_id}</div>
                <div className="ml-auto flex items-center gap-2">
                  <StatusBadge state={status} />
                  <span className="text-[11px] text-cortai-text3">
                    {c?.p50LatencyMs !== null ? `p50 ${Math.round(c.p50LatencyMs)}ms` : "p50 —"}
                  </span>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-cortai-text2">
                <span>last_seen: {fmtAgo(lastSeen)}</span>
                {offlineSince ? <span className="text-cortai-red">offline: {fmtAgo(offlineSince)}</span> : null}
                <span>rate: {(c?.msgRate ?? 0).toFixed(1)}/s</span>
              </div>

              <div className="mt-3">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-cortai-text3">
                  last 10 detections
                </div>
                <div className="grid gap-1">
                  {(c?.lastDetections ?? []).length === 0 ? (
                    <div className="text-[11px] text-cortai-text3">—</div>
                  ) : (
                    (c?.lastDetections ?? []).map((m, idx) => <DetectionLine key={idx} msg={m} />)
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

