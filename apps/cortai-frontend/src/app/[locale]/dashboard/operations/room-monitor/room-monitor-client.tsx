"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

type RoomStatus = "vacant_clean" | "vacant_dirty" | "occupied" | "inspected" | "out_of_order";

type RoomListItem = {
  id: string;
  property_id: string;
  room_number: string;
  floor: number | null;
  type: string | null;
  status: RoomStatus;
  last_service_at: string | null;
  vip: boolean;
};

type RoomList = { items: RoomListItem[] };

type RoomDetail = {
  room: RoomListItem;
  current_reservation: {
    id: string;
    status: string;
    check_in_at: string;
    check_out_at: string;
    guest: { first_name: string; last_name: string; vip: boolean };
  } | null;
  recent_incidents: Array<{ id: string; severity: string; status: string; title: string; created_at: string }>;
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

function toneForRoomStatus(st: RoomStatus) {
  if (st === "out_of_order") return "red";
  if (st === "vacant_dirty") return "amber";
  if (st === "occupied") return "blue";
  if (st === "inspected") return "green";
  return "teal";
}

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

type LiveMsg = {
  type: string;
  org_id?: string;
  property_id?: string;
  room?: unknown;
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

export function RoomMonitorClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.roomMonitor");
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const wsRef = useRef<WebSocket | null>(null);

  const wsUrl = useMemo(() => toWsUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? ""), []);

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const effective = useMemo(() => {
    const floor = clampInt(searchParams.get("floor"), 0, 0, 200);
    const status = (searchParams.get("status") ?? "") as RoomStatus | "";
    const type = (searchParams.get("type") ?? "").trim();
    const search = (searchParams.get("search") ?? "").trim();
    return { floor: String(searchParams.get("floor") ?? "") ? floor : null, status, type, search };
  }, [searchParams]);

  function pushQuery(next: { floor?: number | null; status?: RoomStatus | ""; type?: string; search?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.floor !== undefined) {
      if (next.floor === null) params.delete("floor");
      else params.set("floor", String(next.floor));
    }
    if (next.status !== undefined) {
      if (next.status) params.set("status", next.status);
      else params.delete("status");
    }
    if (next.type !== undefined) {
      const v = next.type.trim();
      if (v) params.set("type", v);
      else params.delete("type");
    }
    if (next.search !== undefined) {
      const v = next.search.trim();
      if (v) params.set("search", v);
      else params.delete("search");
    }
    router.push(`${pathname}?${params.toString()}` as unknown as Parameters<typeof router.push>[0]);
  }

  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [iot, setIot] = useState<unknown | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const loadRooms = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("property_id", propertyId);
      if (effective.floor !== null) params.set("floor", String(effective.floor));
      if (effective.status) params.set("status", effective.status);
      if (effective.type) params.set("type", effective.type);
      if (effective.search) params.set("search", effective.search);
      const resp = await apiFetch<RoomList>(`/api/operations/rooms?${params.toString()}`);
      setRooms(resp.items);
    } catch (e) {
      setRooms([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [effective, propertyId]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  // WebSocket: refresh rooms list on room.updated
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
      if (msg.type === "room.updated") {
        void loadRooms();
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [loadRooms, propertyId, user, wsUrl]);

  const openRoom = useCallback(
    async (roomId: string) => {
      setSelectedId(roomId);
      setDrawerOpen(true);
      setDrawerLoading(true);
      setDetail(null);
      setIot(null);
      try {
        const [d, i] = await Promise.all([
          apiFetch<RoomDetail>(`/api/operations/rooms/${encodeURIComponent(roomId)}`),
          apiFetch<unknown>(`/api/operations/rooms/${encodeURIComponent(roomId)}/iot`)
        ]);
        setDetail(d);
        setIot(i);
      } catch (e) {
        setError(String(e));
      } finally {
        setDrawerLoading(false);
      }
    },
    []
  );

  const patchRoom = useCallback(
    async (roomId: string, payload: unknown) => {
      await apiFetch<RoomListItem>(`/api/operations/rooms/${encodeURIComponent(roomId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      await loadRooms();
      // refresh detail if open
      if (selectedId === roomId) {
        const d = await apiFetch<RoomDetail>(`/api/operations/rooms/${encodeURIComponent(roomId)}`);
        setDetail(d);
      }
    },
    [loadRooms, selectedId]
  );

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-xs text-cortai-text2">{t("selectProperty")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="room-monitor-page">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => void loadRooms()}>
            {t("refresh")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-cortai-red/25 bg-cortai-red/10 p-3 text-xs text-cortai-red">{error}</div>
      ) : null}

      <Card
        title={t("gridTitle")}
        action={
          <form
            action={(formData) => {
              const floorRaw = String(formData.get("floor") ?? "").trim();
              const floor = floorRaw ? clampInt(floorRaw, 0, 0, 200) : null;
              const status = String(formData.get("status") ?? "") as RoomStatus | "";
              const type = String(formData.get("type") ?? "");
              const search = String(formData.get("search") ?? "");
              pushQuery({ floor, status, type, search });
            }}
            className="flex flex-wrap gap-2"
            data-testid="room-monitor-filters"
          >
            <input
              name="floor"
              defaultValue={effective.floor === null ? "" : String(effective.floor)}
              className="w-[90px] rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              placeholder={t("filters.floor")}
            />
            <select
              name="status"
              value={effective.status}
              onChange={(e) => pushQuery({ status: e.target.value as RoomStatus | "" })}
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
            >
              <option value="">{t("filters.allStatuses")}</option>
              {(["vacant_clean", "vacant_dirty", "occupied", "inspected", "out_of_order"] satisfies RoomStatus[]).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              name="type"
              defaultValue={effective.type}
              className="w-[110px] rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              placeholder={t("filters.type")}
            />
            <input
              name="search"
              defaultValue={effective.search}
              className="w-[140px] rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              placeholder={t("filters.search")}
            />
            <Button type="submit" variant="ghost">
              {t("filters.apply")}
            </Button>
          </form>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10">
          {rooms.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => void openRoom(r.id)}
              className="rounded-lg border border-cortai-border bg-cortai-bg2 p-2 text-left transition hover:border-cortai-teal/30 hover:bg-cortai-bg4"
              data-testid={`room-tile-${r.room_number}`}
            >
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold">{r.room_number}</div>
                {r.vip ? <Badge tone="amber">VIP</Badge> : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-cortai-text2">
                <Badge tone={toneForRoomStatus(r.status)}>{r.status}</Badge>
                <span>{r.floor !== null ? `F${r.floor}` : "—"}</span>
                <span className="truncate">{r.type ?? "—"}</span>
              </div>
            </button>
          ))}
          {rooms.length === 0 && !loading ? (
            <div className="col-span-full text-xs text-cortai-text2">{t("empty")}</div>
          ) : null}
        </div>
      </Card>

      {/* Drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-label={t("drawer.close")}
          />
          <section className="absolute right-0 top-0 h-full w-full max-w-xl border-l border-cortai-border bg-cortai-bg3 shadow-panel">
            <header className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <h2 className="flex-1 text-sm font-semibold">
                {detail?.room.room_number ? t("drawer.titleWithRoom", { room: detail.room.room_number }) : t("drawer.title")}
              </h2>
              <Button type="button" variant="ghost" onClick={() => setDrawerOpen(false)}>
                {t("drawer.close")}
              </Button>
            </header>
            <div className="grid gap-4 p-4">
              {drawerLoading ? (
                <div className="text-xs text-cortai-text2">{t("drawer.loading")}</div>
              ) : detail ? (
                <>
                  <Card
                    title={t("drawer.room")}
                    action={
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => (selectedId ? void patchRoom(selectedId, { status: "out_of_order" }) : null)}
                        >
                          {t("drawer.markOoo")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => (selectedId ? void patchRoom(selectedId, { status: "inspected" }) : null)}
                        >
                          {t("drawer.markInspected")}
                        </Button>
                      </div>
                    }
                  >
                    <div className="grid gap-1 text-xs text-cortai-text2">
                      <div className="flex items-center gap-2">
                        <span className="text-cortai-text3">{t("drawer.status")}</span>
                        <Badge tone={toneForRoomStatus(detail.room.status)}>{detail.room.status}</Badge>
                      </div>
                      <div>
                        <span className="text-cortai-text3">{t("drawer.lastService")}</span> {fmtDate(detail.room.last_service_at)}
                      </div>
                    </div>
                  </Card>

                  <Card title={t("drawer.reservation")}>
                    {detail.current_reservation ? (
                      <div className="grid gap-1 text-xs text-cortai-text2">
                        <div className="flex items-center gap-2">
                          <div className="font-semibold text-cortai-text">
                            {detail.current_reservation.guest.first_name} {detail.current_reservation.guest.last_name}
                          </div>
                          {detail.current_reservation.guest.vip ? <Badge tone="amber">VIP</Badge> : null}
                        </div>
                        <div>
                          <span className="text-cortai-text3">{t("drawer.checkIn")}</span>{" "}
                          {fmtDate(detail.current_reservation.check_in_at)}
                        </div>
                        <div>
                          <span className="text-cortai-text3">{t("drawer.checkOut")}</span>{" "}
                          {fmtDate(detail.current_reservation.check_out_at)}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-cortai-text2">{t("drawer.noReservation")}</div>
                    )}
                  </Card>

                  <Card title={t("drawer.iot")}>
                    <pre className="max-h-[260px] overflow-auto rounded-md border border-cortai-border bg-cortai-bg2 p-3 text-[11px] text-cortai-text2">
                      {JSON.stringify(iot, null, 2)}
                    </pre>
                  </Card>

                  <Card title={t("drawer.recentIncidents")}>
                    {detail.recent_incidents.length === 0 ? (
                      <div className="text-xs text-cortai-text2">{t("drawer.noIncidents")}</div>
                    ) : (
                      <div className="grid gap-2">
                        {detail.recent_incidents.slice(0, 5).map((inc) => (
                          <div key={inc.id} className="rounded-md border border-cortai-border bg-cortai-bg2 p-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 text-xs font-semibold">{inc.title}</div>
                              <Badge tone="neutral">{inc.severity}</Badge>
                            </div>
                            <div className="mt-1 text-[11px] text-cortai-text3">{fmtDate(inc.created_at)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </>
              ) : (
                <div className="text-xs text-cortai-text2">{t("drawer.noData")}</div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

