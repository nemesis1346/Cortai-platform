"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Table, Td } from "@/components/ui/Table";

type TabKey = "arrivals" | "departures" | "in_hotel" | "queue";

type GuestSummary = { first_name: string; last_name: string; vip: boolean };

type ReservationListItem = {
  reservation_id: string;
  property_id: string;
  status: string;
  check_in_at: string;
  check_out_at: string;
  guest: GuestSummary;
  room_id: string | null;
  room_number: string | null;
};
type Arrivals = { date: string; items: ReservationListItem[] };
type Departures = { date: string; items: ReservationListItem[] };
type InHotel = { items: ReservationListItem[] };

type QueueItem = {
  event_id: string;
  reservation_id: string;
  queue_position: number;
  started_at: string;
  guest: GuestSummary;
};
type QueueList = { items: QueueItem[] };

type WalkInResult = { reservation_id: string; guest_id: string; room_id: string; status: string };

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}

type LiveMsg = {
  type: string;
  property_id?: string;
};

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

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function fullName(g: GuestSummary) {
  return `${g.first_name} ${g.last_name}`.trim();
}

function toneForStatus(status: string) {
  if (status === "checked_in") return "blue";
  if (status === "checked_out") return "neutral";
  if (status === "cancelled" || status === "no_show") return "red";
  return "teal";
}

export function FrontDeskClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.frontDesk");
  const { user } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const wsUrl = useMemo(() => toWsUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? ""), []);

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [tab, setTab] = useState<TabKey>("arrivals");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [arrivals, setArrivals] = useState<Arrivals | null>(null);
  const [departures, setDepartures] = useState<Departures | null>(null);
  const [inHotel, setInHotel] = useState<InHotel | null>(null);
  const [queue, setQueue] = useState<QueueList | null>(null);

  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInFirstName, setWalkInFirstName] = useState("");
  const [walkInLastName, setWalkInLastName] = useState("");
  const [walkInRoomId, setWalkInRoomId] = useState("");
  const [checkInReservation, setCheckInReservation] = useState<ReservationListItem | null>(null);
  const [checkInRoomId, setCheckInRoomId] = useState("");

  const queueCount = queue?.items?.length ?? 0;

  const loadAll = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const [a, d, ih, q] = await Promise.all([
        apiFetch<Arrivals>(`/api/operations/front-desk/arrivals?property_id=${pid}`),
        apiFetch<Departures>(`/api/operations/front-desk/departures?property_id=${pid}`),
        apiFetch<InHotel>(`/api/operations/front-desk/in-hotel?property_id=${pid}`),
        apiFetch<QueueList>(`/api/operations/front-desk/queue?property_id=${pid}`)
      ]);
      setArrivals(a);
      setDepartures(d);
      setInHotel(ih);
      setQueue(q);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // WebSocket: refresh on any front_desk.event
  useEffect(() => {
    if (!user) return;
    if (!propertyId) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", scope: "property", property_id: propertyId }));
    };
    ws.onmessage = (event) => {
      let msg: LiveMsg | null = null;
      try {
        msg = JSON.parse(String(event.data)) as LiveMsg;
      } catch {
        return;
      }
      if (!msg) return;
      if (msg.type === "front_desk.event") {
        void loadAll();
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [loadAll, propertyId, user, wsUrl]);

  const currentItems = useMemo(() => {
    if (tab === "arrivals") return arrivals?.items ?? [];
    if (tab === "departures") return departures?.items ?? [];
    if (tab === "in_hotel") return inHotel?.items ?? [];
    return [];
  }, [arrivals, departures, inHotel, tab]);

  async function submitWalkIn() {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch<WalkInResult>("/api/operations/front-desk/walk-in", {
        method: "POST",
        body: JSON.stringify({
          property_id: propertyId,
          room_id: walkInRoomId,
          guest: {
            first_name: walkInFirstName,
            last_name: walkInLastName,
            vip: false,
            language: "en"
          }
        })
      });
      setWalkInOpen(false);
      setWalkInFirstName("");
      setWalkInLastName("");
      setWalkInRoomId("");
      await loadAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function submitCheckIn() {
    if (!checkInReservation) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch<unknown>(
        `/api/operations/front-desk/check-in/${encodeURIComponent(checkInReservation.reservation_id)}`,
        {
          method: "POST",
          body: JSON.stringify({ room_id: checkInRoomId })
        }
      );
      setCheckInReservation(null);
      setCheckInRoomId("");
      await loadAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
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
    <div className="grid gap-4" data-testid="front-desk-page">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone="neutral" data-testid="front-desk-queue-count">
            {t("queueCount", { count: queueCount })}
          </Badge>
          <Button type="button" variant="ghost" onClick={() => void loadAll()} disabled={loading}>
            {t("refresh")}
          </Button>
          <Button type="button" onClick={() => setWalkInOpen(true)} data-testid="front-desk-walkin-open">
            {t("walkIn")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-cortai-red">
          {error}
        </div>
      ) : null}

      <Card
        title={t("tabs.title")}
        action={
          <div className="flex flex-wrap gap-2" data-testid="front-desk-tabs">
            {([
              ["arrivals", t("tabs.arrivals")] as const,
              ["departures", t("tabs.departures")] as const,
              ["in_hotel", t("tabs.inHotel")] as const,
              ["queue", t("tabs.queue")] as const
            ] satisfies ReadonlyArray<readonly [TabKey, string]>).map(([key, label]) => (
              <Button key={key} type="button" variant={tab === key ? "primary" : "ghost"} onClick={() => setTab(key)}>
                {label}
              </Button>
            ))}
          </div>
        }
      >
        {tab === "queue" ? (
          <Table headers={[t("queue.cols.pos"), t("queue.cols.guest"), t("queue.cols.started"), t("queue.cols.actions")]}>
            {(queue?.items ?? []).length === 0 ? (
              <tr>
                <Td className="text-cortai-text3" colSpan={4}>
                  {loading ? t("loading") : t("queue.empty")}
                </Td>
              </tr>
            ) : null}
            {(queue?.items ?? []).map((item) => (
              <tr key={item.event_id} className="hover:bg-white/[0.02]">
                <Td>{item.queue_position}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{fullName(item.guest)}</span>
                    {item.guest.vip ? <Badge tone="amber">{t("vip")}</Badge> : null}
                  </div>
                  <div className="text-[11px] text-cortai-text3">{item.reservation_id.slice(0, 8)}</div>
                </Td>
                <Td className="text-cortai-text2">{fmtDate(item.started_at)}</Td>
                <Td>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={async () => {
                        await apiFetch<unknown>("/api/operations/front-desk/queue/serve", {
                          method: "POST",
                          body: JSON.stringify({ property_id: propertyId })
                        });
                        await loadAll();
                      }}
                    >
                      {t("queue.serve")}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <Table
            headers={[
              t("list.cols.guest"),
              t("list.cols.status"),
              t("list.cols.room"),
              t("list.cols.checkIn"),
              t("list.cols.checkOut"),
              t("list.cols.actions")
            ]}
          >
            {currentItems.length === 0 ? (
              <tr>
                <Td className="text-cortai-text3" colSpan={6}>
                  {loading ? t("loading") : t("empty")}
                </Td>
              </tr>
            ) : null}
            {currentItems.map((item) => (
              <tr key={item.reservation_id} className="hover:bg-white/[0.02]">
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{fullName(item.guest)}</span>
                    {item.guest.vip ? <Badge tone="amber">{t("vip")}</Badge> : null}
                  </div>
                  <div className="text-[11px] text-cortai-text3">{item.reservation_id.slice(0, 8)}</div>
                </Td>
                <Td>
                  <Badge tone={toneForStatus(item.status)}>{item.status}</Badge>
                </Td>
                <Td>{item.room_number ?? "—"}</Td>
                <Td className="text-cortai-text2">{fmtDate(item.check_in_at)}</Td>
                <Td className="text-cortai-text2">{fmtDate(item.check_out_at)}</Td>
                <Td>
                  {tab === "arrivals" && item.status === "booked" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setCheckInReservation(item);
                        setCheckInRoomId(item.room_id ?? "");
                      }}
                    >
                      {t("actions.checkIn")}
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={walkInOpen} title={t("walkInModal.title")} closeLabel={t("close")} onClose={() => setWalkInOpen(false)}>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <label className="text-xs text-cortai-text2">{t("walkInModal.firstName")}</label>
            <input
              value={walkInFirstName}
              onChange={(e) => setWalkInFirstName(e.target.value)}
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs outline-none focus:border-cortai-teal"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs text-cortai-text2">{t("walkInModal.lastName")}</label>
            <input
              value={walkInLastName}
              onChange={(e) => setWalkInLastName(e.target.value)}
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs outline-none focus:border-cortai-teal"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs text-cortai-text2">{t("walkInModal.roomId")}</label>
            <input
              value={walkInRoomId}
              onChange={(e) => setWalkInRoomId(e.target.value)}
              placeholder="e.g. 8339ad2c-..."
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs outline-none focus:border-cortai-teal"
            />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setWalkInOpen(false)}>
              {t("close")}
            </Button>
            <Button
              type="button"
              className="ml-auto"
              onClick={() => void submitWalkIn()}
              disabled={!walkInFirstName.trim() || !walkInLastName.trim() || !walkInRoomId.trim() || loading}
            >
              {t("walkInModal.submit")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={checkInReservation !== null}
        title={t("checkInModal.title")}
        closeLabel={t("close")}
        onClose={() => {
          setCheckInReservation(null);
          setCheckInRoomId("");
        }}
      >
        <div className="grid gap-3">
          {checkInReservation ? (
            <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-3 text-xs text-cortai-text2">
              <div className="font-semibold text-cortai-text">{fullName(checkInReservation.guest)}</div>
              <div>{checkInReservation.reservation_id}</div>
            </div>
          ) : null}
          <div className="grid gap-1">
            <label className="text-xs text-cortai-text2">{t("checkInModal.roomId")}</label>
            <input
              value={checkInRoomId}
              onChange={(e) => setCheckInRoomId(e.target.value)}
              placeholder="e.g. 8339ad2c-..."
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs outline-none focus:border-cortai-teal"
            />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCheckInReservation(null);
                setCheckInRoomId("");
              }}
            >
              {t("close")}
            </Button>
            <Button
              type="button"
              className="ml-auto"
              onClick={() => void submitCheckIn()}
              disabled={!checkInRoomId.trim() || loading}
            >
              {t("checkInModal.submit")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

