"use client";

import { useEffect, useRef, useState } from "react";

type Scope = "property" | "org_alerts";

type RealtimeMessage = {
  type?: string;
  sequence?: number;
  [key: string]: unknown;
};

type UseRealtimeSocketArgs = {
  enabled: boolean;
  propertyId?: string | null;
  scope?: Scope;
  onMessage: (message: RealtimeMessage) => void;
  onReconnect?: () => void;
};

function getWsUrl() {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";
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

export function useRealtimeSocket({
  enabled,
  propertyId,
  scope = "property",
  onMessage,
  onReconnect
}: UseRealtimeSocketArgs) {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const lastSequenceRef = useRef<number>(0);
  const onMessageRef = useRef(onMessage);
  const onReconnectRef = useRef(onReconnect);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onReconnectRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    if (!enabled) return;
    if (scope === "property" && !propertyId) return;

    let closed = false;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: number | null = null;

    function connect() {
      if (closed) return;
      setStatus("connecting");
      ws = new WebSocket(getWsUrl());

      ws.onopen = () => {
        retry = 0;
        setStatus("connected");
        onReconnectRef.current?.();
        ws?.send(
          JSON.stringify({
            type: "subscribe",
            scope,
            property_id: propertyId,
            last_sequence: lastSequenceRef.current || undefined
          })
        );
      };

      ws.onmessage = (event) => {
        let msg: RealtimeMessage | null = null;
        try {
          msg = JSON.parse(String(event.data)) as RealtimeMessage;
        } catch {
          return;
        }
        if (!msg) return;
        if (typeof msg.sequence === "number" && Number.isFinite(msg.sequence)) {
          lastSequenceRef.current = Math.max(lastSequenceRef.current, msg.sequence);
        }
        onMessageRef.current(msg);
      };

      ws.onerror = () => {
        setStatus("error");
      };

      ws.onclose = () => {
        if (closed) return;
        const base = Math.min(30000, 1000 * 2 ** retry);
        retry += 1;
        const jitter = Math.floor(Math.random() * 250);
        timer = window.setTimeout(connect, base + jitter);
      };
    }

    connect();

    return () => {
      closed = true;
      if (timer !== null) window.clearTimeout(timer);
      ws?.close();
      setStatus("idle");
    };
  }, [enabled, propertyId, scope]);

  return { status, lastSequenceRef };
}

