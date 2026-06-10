"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, Td } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}

function fmtTs(value: string | null, dash: string) {
  if (!value) return dash;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

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

const setupStatuses = ["setup", "ready", "in_use", "breakdown", "done"] as const;

function parseCsv(csv: string | undefined) {
  const raw = (csv ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function statusTone(status: string) {
  if (status === "ready" || status === "done") return "green";
  if (status === "breakdown") return "red";
  if (status === "in_use") return "blue";
  return "neutral";
}

export function MeetingsEventsClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.meetingsEvents");
  const tc = useTranslations("operations.common");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<MeetingRoom[]>([]);
  const [bookings, setBookings] = useState<MeetingBooking[]>([]);
  const [attendance, setAttendance] = useState<Record<string, Attendance>>({});

  const loadAll = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const [roomRes, bookingRes] = await Promise.all([
        apiFetch<MeetingRoomList>(`/api/operations/meetings/rooms?property_id=${pid}`),
        apiFetch<MeetingBookingList>(`/api/operations/meetings/bookings?property_id=${pid}&page=1&page_size=50`)
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
        })
      );
      setAttendance(
        Object.fromEntries(attendancePairs.filter((entry): entry is readonly [string, Attendance] => entry[1] !== null))
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const [roomOpen, setRoomOpen] = useState(false);
  const [roomEditing, setRoomEditing] = useState<MeetingRoom | null>(null);

  const roomSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1).max(180),
        capacity: z.coerce.number().int().min(0),
        equipment_csv: z.string().optional().or(z.literal(""))
      }),
    []
  );
  type RoomForm = z.infer<typeof roomSchema>;
  const roomForm = useForm<RoomForm>({
    resolver: zodResolver(roomSchema),
    defaultValues: { name: "", capacity: 0, equipment_csv: "" }
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
    setError(null);
    try {
      const payload = { name: values.name, capacity: values.capacity, equipment: parseCsv(values.equipment_csv) };
      if (roomEditing) {
        await apiFetch<MeetingRoom>(`/api/operations/meetings/rooms/${encodeURIComponent(roomEditing.id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        notify({ title: t("toast.roomUpdated.title"), description: t("toast.roomUpdated.description"), tone: "success" });
      } else {
        await apiFetch<MeetingRoom>("/api/operations/meetings/rooms", {
          method: "POST",
          body: JSON.stringify({ property_id: propertyId, ...payload })
        });
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
    setError(null);
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

  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingEditing, setBookingEditing] = useState<MeetingBooking | null>(null);

  const bookingSchema = useMemo(
    () =>
      z.object({
        meeting_room_id: z.string().uuid(),
        organizer_guest_id_or_user_id: z.string().uuid().optional().or(z.literal("")),
        title: z.string().min(1).max(240),
        attendees_count: z.coerce.number().int().min(0).optional().or(z.literal("")),
        starts_at: z.string().min(1),
        ends_at: z.string().min(1),
        setup_status: z.enum(setupStatuses)
      }),
    []
  );
  type BookingForm = z.infer<typeof bookingSchema>;
  const bookingForm = useForm<BookingForm>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      meeting_room_id: "",
      organizer_guest_id_or_user_id: "",
      title: "",
      attendees_count: "",
      starts_at: "",
      ends_at: "",
      setup_status: "setup"
    }
  });

  function openNewBooking() {
    setBookingEditing(null);
    bookingForm.reset({
      meeting_room_id: rooms[0]?.id ?? "",
      organizer_guest_id_or_user_id: "",
      title: "",
      attendees_count: "",
      starts_at: "",
      ends_at: "",
      setup_status: "setup"
    });
    setBookingOpen(true);
  }

  function openEditBooking(booking: MeetingBooking) {
    setBookingEditing(booking);
    bookingForm.reset({
      meeting_room_id: booking.meeting_room_id,
      organizer_guest_id_or_user_id: booking.organizer_guest_id_or_user_id ?? "",
      title: booking.title,
      attendees_count: booking.attendees_count ?? "",
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      setup_status: setupStatuses.includes(booking.setup_status as (typeof setupStatuses)[number])
        ? (booking.setup_status as (typeof setupStatuses)[number])
        : "setup"
    });
    setBookingOpen(true);
  }

  async function submitBooking(values: BookingForm) {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const payload = {
        meeting_room_id: values.meeting_room_id,
        organizer_guest_id_or_user_id: values.organizer_guest_id_or_user_id ? values.organizer_guest_id_or_user_id : null,
        title: values.title,
        attendees_count: values.attendees_count === "" ? null : Number(values.attendees_count),
        starts_at: values.starts_at,
        ends_at: values.ends_at,
        setup_status: values.setup_status
      };
      if (bookingEditing) {
        await apiFetch<MeetingBooking>(`/api/operations/meetings/bookings/${encodeURIComponent(bookingEditing.id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        notify({ title: t("toast.bookingUpdated.title"), description: t("toast.bookingUpdated.description"), tone: "success" });
      } else {
        await apiFetch<MeetingBooking>("/api/operations/meetings/bookings", {
          method: "POST",
          body: JSON.stringify({ property_id: propertyId, ...payload })
        });
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
    setError(null);
    try {
      await apiFetch<MeetingBooking>(`/api/operations/meetings/bookings/${encodeURIComponent(booking.id)}/setup-status`, {
        method: "POST",
        body: JSON.stringify({ setup_status: nextStatus })
      });
      notify({ title: t("toast.setupUpdated.title"), description: t("toast.setupUpdated.description"), tone: "success" });
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  function roomName(id: string) {
    return rooms.find((room) => room.id === id)?.name ?? id.slice(0, 8);
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
    <div className="grid gap-4" data-testid="meetings-events-page">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => void loadAll()} disabled={loading}>
            {t("refresh")}
          </Button>
          <Button type="button" onClick={openNewBooking} data-testid="meeting-booking-new">
            {t("bookings.new")}
          </Button>
          <Button type="button" onClick={openNewRoom} data-testid="meeting-room-new">
            {t("rooms.new")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-cortai-red">
          {error}
        </div>
      ) : null}

      <Card title={t("bookings.title")}>
        <Table
          headers={[
            t("bookings.cols.title"),
            t("bookings.cols.room"),
            t("bookings.cols.time"),
            t("bookings.cols.attendance"),
            t("bookings.cols.status"),
            t("bookings.cols.actions")
          ]}
        >
          {bookings.length === 0 ? (
            <tr>
              <Td className="text-cortai-text3" colSpan={6}>
                {loading ? t("loading") : t("bookings.empty")}
              </Td>
            </tr>
          ) : null}
          {bookings.map((booking) => (
            <tr key={booking.id} className="hover:bg-white/[0.02]">
              <Td>
                <div className="font-semibold">{booking.title}</div>
                <div className="text-[11px] text-cortai-text3">{booking.id.slice(0, 8)}</div>
              </Td>
              <Td className="text-cortai-text2">{roomName(booking.meeting_room_id)}</Td>
              <Td className="text-cortai-text2">
                {fmtTs(booking.starts_at, tc("dash"))} → {fmtTs(booking.ends_at, tc("dash"))}
              </Td>
              <Td className="text-cortai-text2">
                {attendance[booking.id] ? (
                  <span>
                    {attendance[booking.id].count}
                    <span className="ml-1 text-[11px] text-cortai-text3">
                      {fmtTs(attendance[booking.id].last_updated, tc("dash"))}
                    </span>
                  </span>
                ) : (
                  tc("dash")
                )}
              </Td>
              <Td>
                <Badge tone={statusTone(booking.setup_status)}>{booking.setup_status}</Badge>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" onClick={() => openEditBooking(booking)} data-testid="meeting-booking-edit">
                    {t("bookings.edit")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void setSetupStatus(booking, "ready")} data-testid="meeting-booking-ready">
                    {t("bookings.markReady")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void setSetupStatus(booking, "done")} data-testid="meeting-booking-done">
                    {t("bookings.markDone")}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title={t("rooms.title")}>
        <Table headers={[t("rooms.cols.name"), t("rooms.cols.capacity"), t("rooms.cols.equipment"), t("rooms.cols.actions")]}>
          {rooms.length === 0 ? (
            <tr>
              <Td className="text-cortai-text3" colSpan={4}>
                {loading ? t("loading") : t("rooms.empty")}
              </Td>
            </tr>
          ) : null}
          {rooms.map((room) => (
            <tr key={room.id} className="hover:bg-white/[0.02]">
              <Td className="font-semibold">{room.name}</Td>
              <Td className="text-cortai-text2">{room.capacity}</Td>
              <Td className="text-cortai-text2">{(room.equipment ?? []).join(", ") || t("rooms.noEquipment")}</Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" onClick={() => openEditRoom(room)} data-testid="meeting-room-edit">
                    {t("rooms.edit")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void removeRoom(room)} data-testid="meeting-room-delete">
                    {t("rooms.delete")}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal
        open={roomOpen}
        title={roomEditing ? t("rooms.modal.editTitle") : t("rooms.modal.newTitle")}
        closeLabel={t("close")}
        onClose={() => setRoomOpen(false)}
      >
        <form onSubmit={roomForm.handleSubmit((v) => void submitRoom(v))} className="grid gap-3" data-testid="meeting-room-modal">
          <Input label={t("rooms.modal.name")} error={roomForm.formState.errors.name?.message} {...roomForm.register("name")} />
          <Input
            label={t("rooms.modal.capacity")}
            error={roomForm.formState.errors.capacity?.message}
            type="number"
            {...roomForm.register("capacity")}
          />
          <Input
            label={t("rooms.modal.equipment")}
            error={roomForm.formState.errors.equipment_csv?.message}
            {...roomForm.register("equipment_csv")}
          />
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setRoomOpen(false)}>
              {t("close")}
            </Button>
            <Button type="submit" className="ml-auto" disabled={loading}>
              {t("rooms.modal.submit")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={bookingOpen}
        title={bookingEditing ? t("bookings.modal.editTitle") : t("bookings.modal.newTitle")}
        closeLabel={t("close")}
        onClose={() => setBookingOpen(false)}
      >
        <form onSubmit={bookingForm.handleSubmit((v) => void submitBooking(v))} className="grid gap-3" data-testid="meeting-booking-modal">
          <Input
            label={t("bookings.modal.roomId")}
            error={bookingForm.formState.errors.meeting_room_id?.message}
            {...bookingForm.register("meeting_room_id")}
          />
          <Input label={t("bookings.modal.title")} error={bookingForm.formState.errors.title?.message} {...bookingForm.register("title")} />
          <Input
            label={t("bookings.modal.organizer")}
            error={bookingForm.formState.errors.organizer_guest_id_or_user_id?.message}
            {...bookingForm.register("organizer_guest_id_or_user_id")}
          />
          <Input
            label={t("bookings.modal.attendees")}
            error={bookingForm.formState.errors.attendees_count?.message}
            type="number"
            {...bookingForm.register("attendees_count")}
          />
          <Input
            label={t("bookings.modal.startsAt")}
            error={bookingForm.formState.errors.starts_at?.message}
            {...bookingForm.register("starts_at")}
          />
          <Input label={t("bookings.modal.endsAt")} error={bookingForm.formState.errors.ends_at?.message} {...bookingForm.register("ends_at")} />
          <Input
            label={t("bookings.modal.status")}
            error={bookingForm.formState.errors.setup_status?.message}
            {...bookingForm.register("setup_status")}
          />
          <div className="text-[11px] text-cortai-text3">{t("bookings.modal.statusHint")}</div>
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setBookingOpen(false)}>
              {t("close")}
            </Button>
            <Button type="submit" className="ml-auto" disabled={loading}>
              {t("bookings.modal.submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

