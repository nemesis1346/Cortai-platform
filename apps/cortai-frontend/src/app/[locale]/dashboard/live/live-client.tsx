"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";

type LiveMsg = {
  type: string;
  org_id?: string;
  property_id?: string;
  topic_type?: string;
  device_id?: string;
  ts?: string;
  payload?: unknown;
  _broker_received_at_ms?: number;
  _ingested_at_ms?: number;
  _server_published_at_ms?: number;
};

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function toWsUrl(apiBaseUrl: string) {
  // Prefer same-origin WebSocket when apiBaseUrl is empty (production default).
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

export function LiveClient() {
  const { user } = useAuth();
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [mode, setMode] = useState<"property" | "org_alerts">("property");
  const [messages, setMessages] = useState<LiveMsg[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const wsUrl = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
    return toWsUrl(base);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (mode === "property" && !propertyId) return;

    setStatus("connecting");
    setError(null);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      if (mode === "property") {
        ws.send(JSON.stringify({ type: "subscribe", scope: "property", property_id: propertyId }));
      } else {
        ws.send(JSON.stringify({ type: "subscribe", scope: "org_alerts" }));
      }
    };
    ws.onerror = () => {
      setStatus("error");
      setError("websocket_error");
    };
    ws.onclose = () => {
      setStatus((s) => (s === "error" ? s : "idle"));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as LiveMsg;
        setMessages((prev) => [msg, ...prev].slice(0, 200));
      } catch {
        // ignore
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [propertyId, user, wsUrl, mode]);

  const metrics = useMemo(() => {
    const e2e = messages
      .map((m) => {
        if (typeof m._server_published_at_ms !== "number") return null;
        if (typeof m._broker_received_at_ms !== "number") return null;
        return m._server_published_at_ms - m._broker_received_at_ms;
      })
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
    const p50 = percentile(e2e, 50);
    const p95 = percentile(e2e, 95);
    const under500 = e2e.filter((v) => v < 500).length;
    return {
      n: e2e.length,
      p50,
      p95,
      pctUnder500: e2e.length ? (under500 / e2e.length) * 100 : null
    };
  }, [messages]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Live</h1>
          <p className="text-xs text-cortai-text2">WebSocket: {wsUrl}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-cortai-text2">
          <span>Status: {status}</span>
          {error ? <span className="text-cortai-red">{error}</span> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-xs text-cortai-text2">
          <span>Mode</span>
          <select
            className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs text-cortai-text outline-none focus:border-cortai-teal"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="property">Property events</option>
            <option value="org_alerts">Org alerts</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-xs text-cortai-text2">
          <span>Property ID (UUID)</span>
          <input
            className="w-[360px] rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs text-cortai-text outline-none focus:border-cortai-teal"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value.trim())}
            placeholder="e.g. 80b6c65b-554b-4ab0-aba0-f42bcd7ee610"
            disabled={mode !== "property"}
          />
        </label>
        <button
          className="rounded-md border border-cortai-teal/25 bg-cortai-teal/10 px-3 py-2 text-xs text-cortai-teal"
          type="button"
          onClick={() => {
            setMessages([]);
          }}
        >
          Clear
        </button>
      </div>

      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-3 text-xs text-cortai-text2">
        <div className="font-semibold text-cortai-text">Latency (approx)</div>
        <div className="mt-1">
          End-to-end is computed as:{" "}
          <span className="text-cortai-text">_server_published_at_ms - _broker_received_at_ms</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <span>samples={metrics.n}</span>
          <span>p50={metrics.p50 ?? "—"}ms</span>
          <span>p95={metrics.p95 ?? "—"}ms</span>
          <span>
            under500ms={metrics.pctUnder500 !== null ? `${metrics.pctUnder500.toFixed(1)}%` : "—"}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-3">
        <div className="mb-2 text-xs text-cortai-text2">Latest messages (max 200)</div>
        <div className="grid gap-2">
          {messages.length === 0 ? (
            <div className="text-xs text-cortai-text3">No messages yet.</div>
          ) : null}
          {messages.map((m, idx) => {
            const now = Date.now();
            const latencyMs =
              typeof m._server_published_at_ms === "number" ? now - m._server_published_at_ms : null;
            const e2eMs =
              typeof m._server_published_at_ms === "number" && typeof m._broker_received_at_ms === "number"
                ? m._server_published_at_ms - m._broker_received_at_ms
                : null;
            return (
              <div key={idx} className="rounded-md border border-cortai-border bg-cortai-bg p-2">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-cortai-text2">
                  <span>type={m.type}</span>
                  <span>device={m.device_id}</span>
                  <span>topic_type={m.topic_type}</span>
                  {latencyMs !== null ? <span>ws_latency_ms≈{latencyMs}</span> : null}
                  {e2eMs !== null ? <span>e2e_ms≈{e2eMs}</span> : null}
                </div>
                <pre className="mt-2 overflow-auto text-[11px] text-cortai-text">
                  {JSON.stringify(m, null, 2)}
                </pre>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

