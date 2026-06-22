"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { DateTimeInput, toDatetimeLocal } from "@/components/ui/DateTimeInput";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type MeetingRoom = {
  id: string;
  org_id: string;
  property_id: string;
  name: string;
  capacity: number;
  equipment: string[];
  created_at: string;
  updated_at: string;
};
type MeetingRoomList = { items: MeetingRoom[] };

type MeetingBooking = {
  id: string;
  org_id: string;
  property_id: string;
  meeting_room_id: string;
  organizer_guest_id_or_user_id: string | null;
  title: string;
  attendees_count: number | null;
  starts_at: string;
  ends_at: string;
  setup_status: string;
  created_at: string;
  updated_at: string;
};
type MeetingBookingList = { items: MeetingBooking[]; total: number; page: number; page_size: number };

type Attendance = {
  booking_id: string;
  count: number;
  last_updated: string | null;
};

type TabKey = "today" | "bookings" | "rooms";

const setupStatuses = ["setup", "ready", "in_use", "breakdown", "done"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}

function fmtTs(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function fmtTime(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function parseCsv(csv: string | undefined) {
  const raw = (csv ?? "").trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

type StatusCfg = { label: string; col: string; bg: string; bar: string };

function bookingStatusCfg(status: string): StatusCfg {
  switch (status) {
    case "in_use":    return { label: "Live",      col: "#3b82f6", bg: "rgba(59,130,246,.12)",  bar: "#3b82f6" };
    case "ready":     return { label: "Ready",     col: "#00c4a3", bg: "rgba(0,196,163,.12)",   bar: "#00c4a3" };
    case "setup":     return { label: "Setup",     col: "#f59e0b", bg: "rgba(245,158,11,.12)",  bar: "#f59e0b" };
    case "breakdown": return { label: "Breakdown", col: "#f97316", bg: "rgba(249,115,22,.12)",  bar: "#f97316" };
    case "done":      return { label: "Done",      col: "#10b981", bg: "rgba(16,185,129,.12)",  bar: "#10b981" };
    default:          return { label: "Upcoming",  col: "#94a3b8", bg: "rgba(148,163,184,.10)", bar: "#4d7088" };
  }
}

function roomStatusCfg(status: string): StatusCfg {
  switch (status) {
    case "in_use":    return { label: "In Use",    col: "#3b82f6", bg: "rgba(59,130,246,.12)",  bar: "#3b82f6" };
    case "setup":     return { label: "Setup",     col: "#f59e0b", bg: "rgba(245,158,11,.12)",  bar: "#f59e0b" };
    case "available": return { label: "Available", col: "#10b981", bg: "rgba(16,185,129,.12)",  bar: "#10b981" };
    default:          return { label: "Unknown",   col: "#94a3b8", bg: "rgba(148,163,184,.10)", bar: "#4d7088" };
  }
}

function deriveRoomStatus(roomId: string, bookings: MeetingBooking[]): string {
  const now = Date.now();
  for (const b of bookings) {
    if (b.meeting_room_id !== roomId) continue;
    const start = new Date(b.starts_at).getTime();
    const end   = new Date(b.ends_at).getTime();
    if (now >= start && now <= end) {
      return b.setup_status === "in_use" ? "in_use" : "setup";
    }
  }
  return "available";
}

function nextBookingForRoom(roomId: string, bookings: MeetingBooking[]): MeetingBooking | null {
  const now = Date.now();
  const upcoming = bookings
    .filter((b) => b.meeting_room_id === roomId && new Date(b.starts_at).getTime() > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return upcoming[0] ?? null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MeetingsEventsClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t  = useTranslations("operations.meetingsEvents");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [activeTab, setActiveTab]     = useState<TabKey>("today");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [rooms, setRooms]             = useState<MeetingRoom[]>([]);
  const [bookings, setBookings]       = useState<MeetingBooking[]>([]);
  const [attendance, setAttendance]   = useState<Record<string, Attendance>>({});
  const [bookingsView, setBookingsView] = useState<"list" | "calendar">("list");
  const [bookingDetail, setBookingDetail] = useState<MeetingBooking | null>(null);

  const loadAll = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const [roomRes, bookingRes] = await Promise.all([
        apiFetch<MeetingRoomList>(`/api/operations/meetings/rooms?property_id=${pid}`),
        apiFetch<MeetingBookingList>(`/api/operations/meetings/bookings?property_id=${pid}&page=1&page_size=50`),
      ]);
      setRooms(roomRes.items);
      setBookings(bookingRes.items);

      const attendancePairs = await Promise.all(
        bookingRes.items.map(async (booking) => {
          try {
            const value = await apiFetch<Attendance>(`/api/operations/meetings/bookings/${encodeURIComponent(booking.id)}/attendance`);
            return [booking.id, value] as const;
          } catch {
            return [booking.id, null] as const;
          }
        }),
      );
      setAttendance(
        Object.fromEntries(attendancePairs.filter((e): e is readonly [string, Attendance] => e[1] !== null)),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const todayBookings = useMemo(
    () => bookings.filter((b) => b.starts_at.startsWith(today)).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [bookings, today],
  );

  const totalAttendeesToday = useMemo(
    () => todayBookings.reduce((sum, b) => sum + (b.attendees_count ?? 0), 0),
    [todayBookings],
  );

  const bookingCalendarGroups = useMemo(() => {
    const groups = new Map<string, MeetingBooking[]>();
    for (const item of bookings) {
      const d = new Date(item.starts_at);
      const key = Number.isNaN(d.getTime()) ? item.starts_at.slice(0, 10) : d.toISOString().slice(0, 10);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return Array.from(groups.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [bookings]);

  function roomName(id: string) {
    return rooms.find((r) => r.id === id)?.name ?? id.slice(0, 8);
  }

  // ── Room form ─────────────────────────────────────────────────────────────
  const [roomOpen, setRoomOpen]       = useState(false);
  const [roomEditing, setRoomEditing] = useState<MeetingRoom | null>(null);

  const roomSchema = useMemo(
    () =>
      z.object({
        name:          z.string().min(1).max(180),
        capacity:      z.coerce.number().int().min(0),
        equipment_csv: z.string().optional().or(z.literal("")),
      }),
    [],
  );
  type RoomForm = z.infer<typeof roomSchema>;
  const roomForm = useForm<RoomForm>({
    resolver: zodResolver(roomSchema),
    defaultValues: { name: "", capacity: 0, equipment_csv: "" },
  });

  function openNewRoom() {
    setRoomEditing(null);
    roomForm.reset({ name: "", capacity: 0, equipment_csv: "" });
    setRoomOpen(true);
  }

  function openEditRoom(room: MeetingRoom) {
    setRoomEditing(room);
    roomForm.reset({ name: room.name, capacity: room.capacity, equipment_csv: (room.equipment ?? []).join(", ") });
    setRoomOpen(true);
  }

  async function submitRoom(values: RoomForm) {
    if (!propertyId) return;
    setLoading(true);
    try {
      const payload = { name: values.name, capacity: values.capacity, equipment: parseCsv(values.equipment_csv) };
      if (roomEditing) {
        await apiFetch<MeetingRoom>(`/api/operations/meetings/rooms/${encodeURIComponent(roomEditing.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
        notify({ title: t("toast.roomUpdated.title"), description: t("toast.roomUpdated.description"), tone: "success" });
      } else {
        await apiFetch<MeetingRoom>("/api/operations/meetings/rooms", { method: "POST", body: JSON.stringify({ property_id: propertyId, ...payload }) });
        notify({ title: t("toast.roomCreated.title"), description: t("toast.roomCreated.description"), tone: "success" });
      }
      setRoomOpen(false);
      setRoomEditing(null);
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function removeRoom(room: MeetingRoom) {
    setLoading(true);
    try {
      await apiFetch<void>(`/api/operations/meetings/rooms/${encodeURIComponent(room.id)}`, { method: "DELETE" });
      notify({ title: t("toast.roomDeleted.title"), description: t("toast.roomDeleted.description"), tone: "success" });
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  // ── Booking form ──────────────────────────────────────────────────────────
  const [bookingOpen, setBookingOpen]       = useState(false);
  const [bookingEditing, setBookingEditing] = useState<MeetingBooking | null>(null);

  const bookingSchema = useMemo(
    () =>
      z.object({
        meeting_room_id:              z.string().uuid(),
        organizer_guest_id_or_user_id: z.string().uuid().optional().or(z.literal("")),
        title:          z.string().min(1).max(240),
        attendees_count: z.coerce.number().int().min(0).optional().or(z.literal("")),
        starts_at:      z.string().min(1),
        ends_at:        z.string().min(1),
        setup_status:   z.enum(setupStatuses),
      }),
    [],
  );
  type BookingForm = z.infer<typeof bookingSchema>;
  const bookingForm = useForm<BookingForm>({
    resolver: zodResolver(bookingSchema),
    defaultValues: { meeting_room_id: "", organizer_guest_id_or_user_id: "", title: "", attendees_count: "", starts_at: "", ends_at: "", setup_status: "setup" },
  });

  function openNewBooking() {
    setBookingEditing(null);
    bookingForm.reset({ meeting_room_id: rooms[0]?.id ?? "", organizer_guest_id_or_user_id: "", title: "", attendees_count: "", starts_at: "", ends_at: "", setup_status: "setup" });
    setBookingOpen(true);
  }

  function openEditBooking(booking: MeetingBooking) {
    setBookingEditing(booking);
    bookingForm.reset({
      meeting_room_id: booking.meeting_room_id,
      organizer_guest_id_or_user_id: booking.organizer_guest_id_or_user_id ?? "",
      title: booking.title,
      attendees_count: booking.attendees_count ?? "",
      starts_at: toDatetimeLocal(booking.starts_at),
      ends_at: toDatetimeLocal(booking.ends_at),
      setup_status: setupStatuses.includes(booking.setup_status as (typeof setupStatuses)[number])
        ? (booking.setup_status as (typeof setupStatuses)[number])
        : "setup",
    });
    setBookingOpen(true);
  }

  async function submitBooking(values: BookingForm) {
    if (!propertyId) return;
    setLoading(true);
    try {
      const payload = {
        meeting_room_id: values.meeting_room_id,
        organizer_guest_id_or_user_id: values.organizer_guest_id_or_user_id || null,
        title: values.title,
        attendees_count: values.attendees_count === "" ? null : Number(values.attendees_count),
        starts_at: values.starts_at,
        ends_at: values.ends_at,
        setup_status: values.setup_status,
      };
      if (bookingEditing) {
        await apiFetch<MeetingBooking>(`/api/operations/meetings/bookings/${encodeURIComponent(bookingEditing.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
        notify({ title: t("toast.bookingUpdated.title"), description: t("toast.bookingUpdated.description"), tone: "success" });
      } else {
        await apiFetch<MeetingBooking>("/api/operations/meetings/bookings", { method: "POST", body: JSON.stringify({ property_id: propertyId, ...payload }) });
        notify({ title: t("toast.bookingCreated.title"), description: t("toast.bookingCreated.description"), tone: "success" });
      }
      setBookingOpen(false);
      setBookingEditing(null);
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function setSetupStatus(booking: MeetingBooking, nextStatus: (typeof setupStatuses)[number]) {
    setLoading(true);
    try {
      await apiFetch<MeetingBooking>(`/api/operations/meetings/bookings/${encodeURIComponent(booking.id)}/setup-status`, { method: "POST", body: JSON.stringify({ setup_status: nextStatus }) });
      notify({ title: t("toast.setupUpdated.title"), description: t("toast.setupUpdated.description"), tone: "success" });
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
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

  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="grid gap-4" data-testid="meetings-events-page">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-cortai-text">{t("title")}</h1>
          <p className="text-[11px] text-cortai-text3">{todayLabel} · {t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => void loadAll()} disabled={loading} data-testid="meetings-events-refresh">
            {t("refresh")}
          </Button>
          <button type="button" onClick={openNewBooking}
            data-testid="meeting-booking-new"
            className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90"
            style={{ background: "#3b82f6" }}
          >
            + {t("bookings.new")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-cortai-red">{error}</div>
      ) : null}

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-xl border border-cortai-border p-1" style={{ background: "rgba(255,255,255,.02)" }}>
        {([
          {
            key:   "today"    as TabKey,
            label: "Today",
            count: todayBookings.length > 0 ? `${todayBookings.length} events` : undefined,
            icon:  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>,
          },
          {
            key:   "bookings" as TabKey,
            label: "All Bookings",
            count: bookings.length > 0 ? `${bookings.length}` : undefined,
            icon:  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>,
          },
          {
            key:   "rooms"    as TabKey,
            label: "Rooms",
            count: rooms.length > 0 ? `${rooms.length}` : undefined,
            icon:  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>,
          },
        ] as { key: TabKey; label: string; count?: string; icon: React.ReactNode }[]).map(({ key, label, count, icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold transition"
            style={{
              background: activeTab === key ? "rgba(0,196,163,.12)" : "transparent",
              color:      activeTab === key ? "#00c4a3" : "#4d7088",
              border:    `1px solid ${activeTab === key ? "rgba(0,196,163,.25)" : "transparent"}`,
            }}
          >
            {icon}{label}
            {count ? (
              <span className="rounded-full px-1.5 py-0.5 font-mono text-[9px]"
                style={{ background: activeTab === key ? "rgba(0,196,163,.18)" : "rgba(255,255,255,.05)", color: activeTab === key ? "#00c4a3" : "#4d7088" }}>
                {count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          TAB: TODAY
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "today" && (
        <>
          {/* KPI strip — 4 tiles */}
          <div className="grid grid-cols-4 gap-3">
            {[
              {
                label: "Events Today",
                v:     todayBookings.length || "—",
                sub:   todayBookings.filter((b) => b.setup_status === "in_use").length > 0
                  ? `${todayBookings.filter((b) => b.setup_status === "in_use").length} in progress`
                  : "scheduled",
                c: "#3b82f6",
              },
              {
                label: "Total Attendees",
                v:     totalAttendeesToday || "—",
                sub:   `across ${todayBookings.length} booking${todayBookings.length !== 1 ? "s" : ""} today`,
                c:     totalAttendeesToday > 0 ? "#c8dce8" : "#4d7088",
              },
              {
                label: "Rooms Available",
                v:     rooms.length > 0
                  ? rooms.filter((r) => deriveRoomStatus(r.id, bookings) === "available").length
                  : "—",
                sub:   rooms.length > 0
                  ? `of ${rooms.length} total`
                  : "no rooms configured",
                c: rooms.filter((r) => deriveRoomStatus(r.id, bookings) === "available").length > 0 ? "#10b981" : "#ef4444",
              },
              {
                label: "Total Bookings",
                v:     bookings.length || "—",
                sub:   `${bookings.filter((b) => b.setup_status === "done").length} completed`,
                c:     "#8b5cf6",
              },
            ].map(({ label, v, sub, c }) => (
              <div key={label} className="rounded-xl border border-cortai-border px-4 py-3" style={{ background: "rgba(255,255,255,.02)" }}>
                <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">{label}</div>
                <div className="mt-1 font-mono text-[24px] font-bold leading-none" style={{ color: c }}>{v}</div>
                <div className="mt-1 text-[9px] text-cortai-text3">{sub}</div>
              </div>
            ))}
          </div>

          {/* Main 2-col grid */}
          <div className="grid gap-3" style={{ gridTemplateColumns: "1.5fr 1fr" }}>

            {/* Today's Schedule */}
            <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
              <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/>
                </svg>
                <span className="text-[13px] font-semibold text-cortai-text">Today — {todayLabel}</span>
                {todayBookings.length > 0 ? (
                  <span className="ml-auto rounded-full px-2 py-0.5 font-mono text-[9px]"
                    style={{ background: "rgba(59,130,246,.12)", color: "#3b82f6" }}>
                    {todayBookings.length} event{todayBookings.length !== 1 ? "s" : ""}
                    {totalAttendeesToday > 0 ? ` · ${totalAttendeesToday} pax` : ""}
                  </span>
                ) : null}
              </div>

              {todayBookings.length === 0 ? (
                <div className="px-4 py-10 text-center text-[11px] text-cortai-text3">
                  {loading ? t("loading") : "No events scheduled today"}
                </div>
              ) : (
                <div>
                  {todayBookings.map((b) => {
                    const sc = bookingStatusCfg(b.setup_status);
                    const att = attendance[b.id];
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setBookingDetail(b)}
                        className="grid w-full items-center border-b border-cortai-border/30 px-4 last:border-0 transition hover:bg-white/[.01]"
                        style={{ gridTemplateColumns: "72px 3px 1fr 90px", gap: "12px", padding: "12px 16px" }}
                      >
                        {/* Time */}
                        <div className="text-right">
                          <div className="font-mono text-[13px] font-bold text-cortai-text">{fmtTime(b.starts_at)}</div>
                          <div className="font-mono text-[9px] text-cortai-text3">{fmtTime(b.ends_at)}</div>
                        </div>
                        {/* Colour bar */}
                        <div className="self-stretch rounded-sm" style={{ background: sc.bar, minHeight: "36px" }} />
                        {/* Body */}
                        <div className="min-w-0 text-left">
                          <div className="text-[12px] font-semibold text-cortai-text truncate">{b.title}</div>
                          <div className="flex flex-wrap gap-2 text-[9px] text-cortai-text3 mt-0.5">
                            <span>{roomName(b.meeting_room_id)}</span>
                            {b.attendees_count ? <span>{b.attendees_count} attendees</span> : null}
                            {att ? <span className="text-cortai-text2">{att.count} checked in</span> : null}
                          </div>
                        </div>
                        {/* Status chip */}
                        <div className="text-right">
                          <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                            style={{ background: sc.bg, color: sc.col }}>{sc.label.toUpperCase()}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Tomorrow quick-look: next 3 bookings not today */}
              {(() => {
                const upcoming = bookings
                  .filter((b) => !b.starts_at.startsWith(today) && new Date(b.starts_at).getTime() > Date.now())
                  .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                  .slice(0, 3);
                if (upcoming.length === 0) return null;
                return (
                  <div className="border-t border-cortai-border/50 px-4 py-2.5">
                    <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3">Upcoming</div>
                    {upcoming.map((b) => {
                      const sc = bookingStatusCfg(b.setup_status);
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setBookingDetail(b)}
                          className="flex w-full items-center gap-3 py-1.5 text-left transition hover:opacity-80"
                        >
                          <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: sc.bar }} />
                          <span className="text-[10px] font-medium text-cortai-text truncate">{b.title}</span>
                          <span className="ml-auto font-mono text-[9px] shrink-0" style={{ color: sc.col }}>
                            {new Date(b.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} {fmtTime(b.starts_at)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Space Status */}
            <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
              <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="9" y1="3" x2="9" y2="21"/>
                  <line x1="15" y1="3" x2="15" y2="21"/>
                </svg>
                <span className="text-[13px] font-semibold text-cortai-text">Space Status</span>
                <button type="button" onClick={() => setActiveTab("rooms")}
                  className="ml-auto text-[9px] transition hover:text-cortai-text" style={{ color: "#4d7088" }}>
                  Manage →
                </button>
              </div>

              {rooms.length === 0 ? (
                <div className="px-4 py-8 text-center text-[11px] text-cortai-text3">
                  {loading ? t("loading") : "No meeting rooms configured"}
                </div>
              ) : (
                <div>
                  {rooms.map((room) => {
                    const status = deriveRoomStatus(room.id, bookings);
                    const sc     = roomStatusCfg(status);
                    const next   = nextBookingForRoom(room.id, bookings);
                    return (
                      <div key={room.id}
                        className="border-b border-cortai-border/30 px-4 py-3 last:border-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="h-2 w-2 rounded-full shrink-0" style={{ background: sc.col }} />
                          <span className="text-[12px] font-semibold text-cortai-text">{room.name}</span>
                          <span className="font-mono text-[9px] text-cortai-text3">cap {room.capacity}</span>
                          <span className="ml-auto rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                            style={{ background: sc.bg, color: sc.col }}>{sc.label.toUpperCase()}</span>
                        </div>
                        {(room.equipment ?? []).length > 0 ? (
                          <div className="text-[9px] text-cortai-text3 mb-1">{room.equipment.join(" · ")}</div>
                        ) : null}
                        {next ? (
                          <div className="font-mono text-[9px]" style={{ color: "#4d7088" }}>
                            Next: {next.title} · {new Date(next.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} {fmtTime(next.starts_at)}
                          </div>
                        ) : (
                          <div className="text-[9px] text-cortai-text3">No upcoming bookings</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Legend */}
              <div className="flex items-center gap-3 border-t border-cortai-border/50 px-4 py-2.5">
                {[
                  { label: "In Use",    col: "#3b82f6" },
                  { label: "Setup",     col: "#f59e0b" },
                  { label: "Available", col: "#10b981" },
                ].map(({ label, col }) => (
                  <div key={label} className="flex items-center gap-1">
                    <div className="h-1.5 w-1.5 rounded-full" style={{ background: col }} />
                    <span className="text-[9px] text-cortai-text3">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: ALL BOOKINGS
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "bookings" && (
        <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
          <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#3b82f6" fill="none" strokeWidth="1.5">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
              <circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>
            </svg>
            <span className="text-[13px] font-semibold text-cortai-text">{t("bookings.title")}</span>
            {bookings.length > 0 ? (
              <span className="rounded-full px-2 py-0.5 font-mono text-[9px]"
                style={{ background: "rgba(59,130,246,.12)", color: "#3b82f6" }}>{bookings.length}</span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {(["list", "calendar"] as const).map((v) => (
                <button key={v} type="button"
                  onClick={() => setBookingsView(v)}
                  data-testid={`meeting-bookings-view-${v}`}
                  className="rounded-md px-2.5 py-1 text-[10px] font-semibold transition"
                  style={{
                    background: bookingsView === v ? "rgba(59,130,246,.15)" : "rgba(255,255,255,.04)",
                    color:      bookingsView === v ? "#3b82f6" : "#4d7088",
                    border:    `1px solid ${bookingsView === v ? "rgba(59,130,246,.3)" : "rgba(255,255,255,.06)"}`,
                  }}
                >
                  {t(`bookings.view.${v}`)}
                </button>
              ))}
            </div>
          </div>

          {/* List view */}
          {bookingsView === "list" && (
            <>
              <div
                className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
                style={{ gridTemplateColumns: "1.5fr 100px 1.2fr 70px 70px 1fr", background: "rgba(255,255,255,.02)" }}
              >
                <div>{t("bookings.cols.title")}</div>
                <div>{t("bookings.cols.room")}</div>
                <div>{t("bookings.cols.time")}</div>
                <div>{t("bookings.cols.attendance")}</div>
                <div>{t("bookings.cols.status")}</div>
                <div>{t("bookings.cols.actions")}</div>
              </div>
              {bookings.length === 0 ? (
                <div className="px-4 py-8 text-center text-[11px] text-cortai-text3">{loading ? t("loading") : t("bookings.empty")}</div>
              ) : bookings.map((booking) => {
                const sc  = bookingStatusCfg(booking.setup_status);
                const att = attendance[booking.id];
                return (
                  <div
                    key={booking.id}
                    className="grid items-center border-b border-cortai-border/30 px-4 py-2.5 text-[11px] last:border-0 hover:bg-white/[.01]"
                    style={{
                      gridTemplateColumns: "1.5fr 100px 1.2fr 70px 70px 1fr",
                      borderLeft: `3px solid ${sc.bar}`,
                    }}
                  >
                    <div>
                      <div className="font-medium text-cortai-text">{booking.title}</div>
                      <div className="text-[9px] text-cortai-text3">{booking.id.slice(0, 8)}</div>
                    </div>
                    <div className="text-[10px] text-cortai-text2">{roomName(booking.meeting_room_id)}</div>
                    <div className="text-[10px] text-cortai-text2">
                      <div>{fmtTs(booking.starts_at)}</div>
                      <div className="text-cortai-text3">→ {fmtTs(booking.ends_at)}</div>
                    </div>
                    <div className="text-[10px]">
                      {att ? (
                        <span style={{ color: "#00c4a3" }}>{att.count}</span>
                      ) : (
                        <span className="text-cortai-text3">{booking.attendees_count ?? "—"}</span>
                      )}
                    </div>
                    <div>
                      <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                        style={{ background: sc.bg, color: sc.col }}>{sc.label.toUpperCase()}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => setBookingDetail(booking)}
                        data-testid="meeting-booking-detail"
                        className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                        style={{ background: "rgba(255,255,255,.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,.08)" }}>
                        {t("bookings.detail")}
                      </button>
                      <button type="button" onClick={() => openEditBooking(booking)}
                        data-testid="meeting-booking-edit"
                        className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                        style={{ background: "rgba(59,130,246,.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,.2)" }}>
                        {t("bookings.edit")}
                      </button>
                      <button type="button" onClick={() => void setSetupStatus(booking, "ready")}
                        data-testid="meeting-booking-ready"
                        className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                        style={{ background: "rgba(0,196,163,.10)", color: "#00c4a3", border: "1px solid rgba(0,196,163,.2)" }}>
                        {t("bookings.markReady")}
                      </button>
                      <button type="button" onClick={() => void setSetupStatus(booking, "done")}
                        data-testid="meeting-booking-done"
                        className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                        style={{ background: "rgba(16,185,129,.10)", color: "#10b981", border: "1px solid rgba(16,185,129,.2)" }}>
                        {t("bookings.markDone")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Calendar view */}
          {bookingsView === "calendar" && (
            <div className="p-4" data-testid="meeting-bookings-calendar">
              {bookingCalendarGroups.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-cortai-text3">{loading ? t("loading") : t("bookings.empty")}</div>
              ) : (
                <div className="grid gap-3">
                  {bookingCalendarGroups.map(([day, items]) => (
                    <div key={day} className="overflow-hidden rounded-xl border border-cortai-border">
                      <div className="border-b border-cortai-border px-4 py-2" style={{ background: "rgba(255,255,255,.03)" }}>
                        <span className="text-[11px] font-semibold text-cortai-text">{day}</span>
                        <span className="ml-2 text-[9px] text-cortai-text3">{items.length} booking{items.length !== 1 ? "s" : ""}</span>
                      </div>
                      {items.map((booking) => {
                        const sc = bookingStatusCfg(booking.setup_status);
                        return (
                          <button
                            key={booking.id}
                            type="button"
                            onClick={() => setBookingDetail(booking)}
                            className="flex w-full items-center gap-3 border-b border-cortai-border/30 px-4 py-2.5 text-left last:border-0 transition hover:bg-white/[.01]"
                            style={{ borderLeft: `3px solid ${sc.bar}` }}
                          >
                            <span className="font-mono text-[10px] shrink-0" style={{ color: "#00c4a3" }}>{fmtTime(booking.starts_at)}</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-medium text-cortai-text">{booking.title}</div>
                              <div className="text-[9px] text-cortai-text3">{roomName(booking.meeting_room_id)}</div>
                            </div>
                            <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold shrink-0"
                              style={{ background: sc.bg, color: sc.col }}>{sc.label.toUpperCase()}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: ROOMS
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "rooms" && (
        <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
          <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
              <line x1="15" y1="3" x2="15" y2="21"/>
            </svg>
            <span className="text-[13px] font-semibold text-cortai-text">{t("rooms.title")}</span>
            {rooms.length > 0 ? (
              <span className="rounded-full px-2 py-0.5 font-mono text-[9px]"
                style={{ background: "rgba(0,196,163,.12)", color: "#00c4a3" }}>{rooms.length}</span>
            ) : null}
            <button type="button" onClick={openNewRoom}
              data-testid="meeting-room-new"
              className="ml-auto rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90"
              style={{ background: "#00c4a3" }}
            >
              + {t("rooms.new")}
            </button>
          </div>

          <div
            className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
            style={{ gridTemplateColumns: "1.5fr 60px 1fr 80px 1fr", background: "rgba(255,255,255,.02)" }}
          >
            <div>{t("rooms.cols.name")}</div>
            <div>{t("rooms.cols.capacity")}</div>
            <div>{t("rooms.cols.equipment")}</div>
            <div>Status</div>
            <div>{t("rooms.cols.actions")}</div>
          </div>

          {rooms.length === 0 ? (
            <div className="px-4 py-8 text-center text-[11px] text-cortai-text3">{loading ? t("loading") : t("rooms.empty")}</div>
          ) : rooms.map((room) => {
            const status = deriveRoomStatus(room.id, bookings);
            const sc     = roomStatusCfg(status);
            return (
              <div
                key={room.id}
                className="grid items-center border-b border-cortai-border/30 px-4 py-3 text-[11px] last:border-0"
                style={{ gridTemplateColumns: "1.5fr 60px 1fr 80px 1fr" }}
              >
                <div className="font-semibold text-cortai-text">{room.name}</div>
                <div className="font-mono text-[10px] text-cortai-text2">{room.capacity}</div>
                <div className="text-[10px] text-cortai-text3">{(room.equipment ?? []).join(", ") || t("rooms.noEquipment")}</div>
                <div>
                  <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                    style={{ background: sc.bg, color: sc.col }}>{sc.label.toUpperCase()}</span>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => openEditRoom(room)}
                    data-testid="meeting-room-edit"
                    className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                    style={{ background: "rgba(0,196,163,.10)", color: "#00c4a3", border: "1px solid rgba(0,196,163,.2)" }}>
                    {t("rooms.edit")}
                  </button>
                  <button type="button" onClick={() => void removeRoom(room)}
                    data-testid="meeting-room-delete"
                    className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                    style={{ background: "rgba(239,68,68,.10)", color: "#ef4444", border: "1px solid rgba(239,68,68,.2)" }}>
                    {t("rooms.delete")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════════════ */}

      {/* Room create/edit */}
      <Modal open={roomOpen} title={roomEditing ? t("rooms.modal.editTitle") : t("rooms.modal.newTitle")} closeLabel={t("close")} onClose={() => setRoomOpen(false)}>
        <form onSubmit={roomForm.handleSubmit((v) => void submitRoom(v))} className="grid gap-3" data-testid="meeting-room-modal">
          <Input label={t("rooms.modal.name")}      error={roomForm.formState.errors.name?.message}          {...roomForm.register("name")} />
          <Input label={t("rooms.modal.capacity")}  error={roomForm.formState.errors.capacity?.message} type="number" {...roomForm.register("capacity")} />
          <Input label={t("rooms.modal.equipment")} error={roomForm.formState.errors.equipment_csv?.message} {...roomForm.register("equipment_csv")} />
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setRoomOpen(false)} data-testid="meeting-room-modal-close">{t("close")}</Button>
            <Button type="submit" className="ml-auto" disabled={loading} data-testid="meeting-room-modal-submit">{t("rooms.modal.submit")}</Button>
          </div>
        </form>
      </Modal>

      {/* Booking create/edit */}
      <Modal open={bookingOpen} title={bookingEditing ? t("bookings.modal.editTitle") : t("bookings.modal.newTitle")} closeLabel={t("close")} onClose={() => setBookingOpen(false)}>
        <form onSubmit={bookingForm.handleSubmit((v) => void submitBooking(v))} className="grid gap-3" data-testid="meeting-booking-modal">
          <Input label={t("bookings.modal.roomId")}   error={bookingForm.formState.errors.meeting_room_id?.message}              {...bookingForm.register("meeting_room_id")} />
          <Input label={t("bookings.modal.title")}    error={bookingForm.formState.errors.title?.message}                        {...bookingForm.register("title")} />
          <Input label={t("bookings.modal.organizer")} error={bookingForm.formState.errors.organizer_guest_id_or_user_id?.message} {...bookingForm.register("organizer_guest_id_or_user_id")} />
          <Input label={t("bookings.modal.attendees")} error={bookingForm.formState.errors.attendees_count?.message} type="number" {...bookingForm.register("attendees_count")} />
          <DateTimeInput label={t("bookings.modal.startsAt")} error={bookingForm.formState.errors.starts_at?.message} {...bookingForm.register("starts_at")} />
          <DateTimeInput label={t("bookings.modal.endsAt")}   error={bookingForm.formState.errors.ends_at?.message}   {...bookingForm.register("ends_at")} />
          <Input label={t("bookings.modal.status")}   error={bookingForm.formState.errors.setup_status?.message}                 {...bookingForm.register("setup_status")} />
          <div className="text-[11px] text-cortai-text3">{t("bookings.modal.statusHint")}</div>
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setBookingOpen(false)} data-testid="meeting-booking-modal-close">{t("close")}</Button>
            <Button type="submit" className="ml-auto" disabled={loading} data-testid="meeting-booking-modal-submit">{t("bookings.modal.submit")}</Button>
          </div>
        </form>
      </Modal>

      {/* Booking detail */}
      <Modal open={bookingDetail !== null} title={t("bookings.detailTitle", { id: bookingDetail?.id.slice(0, 8) ?? "" })} closeLabel={t("close")} onClose={() => setBookingDetail(null)}>
        {!bookingDetail ? null : (
          <div className="grid gap-3" data-testid="meeting-booking-detail-modal">
            <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "rgba(255,255,255,.02)" }}>
              {/* Header strip */}
              <div className="border-b border-cortai-border px-4 py-3"
                style={{ borderLeft: `3px solid ${bookingStatusCfg(bookingDetail.setup_status).bar}` }}>
                <div className="text-[14px] font-semibold text-cortai-text">{bookingDetail.title}</div>
                <div className="mt-0.5 text-[10px] text-cortai-text3">{roomName(bookingDetail.meeting_room_id)}</div>
              </div>
              <div className="grid gap-1 px-4 py-3 text-[11px] text-cortai-text2">
                <div>{t("bookings.detailTime", { start: fmtTs(bookingDetail.starts_at), end: fmtTs(bookingDetail.ends_at) })}</div>
                <div>{t("bookings.detailAttendees", { value: bookingDetail.attendees_count ?? 0 })}</div>
                <div>{t("bookings.detailAttendance", { value: attendance[bookingDetail.id]?.count ?? 0 })}</div>
                <div>{t("bookings.detailStatus", { status: bookingDetail.setup_status })}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => openEditBooking(bookingDetail)}
                data-testid="meeting-booking-detail-edit"
                className="rounded px-2.5 py-1 text-[10px] font-semibold transition hover:opacity-80"
                style={{ background: "rgba(59,130,246,.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,.2)" }}>
                {t("bookings.edit")}
              </button>
              <button type="button" onClick={() => void setSetupStatus(bookingDetail, "ready")}
                data-testid="meeting-booking-detail-ready"
                className="rounded px-2.5 py-1 text-[10px] font-semibold transition hover:opacity-80"
                style={{ background: "rgba(0,196,163,.10)", color: "#00c4a3", border: "1px solid rgba(0,196,163,.2)" }}>
                {t("bookings.markReady")}
              </button>
              <button type="button" onClick={() => void setSetupStatus(bookingDetail, "done")}
                data-testid="meeting-booking-detail-done"
                className="rounded px-2.5 py-1 text-[10px] font-semibold transition hover:opacity-80"
                style={{ background: "rgba(16,185,129,.10)", color: "#10b981", border: "1px solid rgba(16,185,129,.2)" }}>
                {t("bookings.markDone")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
