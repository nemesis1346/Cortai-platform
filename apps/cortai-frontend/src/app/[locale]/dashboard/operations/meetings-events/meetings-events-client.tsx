"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { apiFetch } from "@/lib/api";
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

export function MeetingsEventsClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.meetingsEvents");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<MeetingRoom[]>([]);

  const loadRooms = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const res = await apiFetch<MeetingRoomList>(`/api/operations/meetings/rooms?property_id=${pid}`);
      setRooms(res.items);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MeetingRoom | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1).max(180),
        capacity: z.coerce.number().int().min(0),
        equipment_csv: z.string().optional().or(z.literal(""))
      }),
    []
  );
  type Form = z.infer<typeof schema>;
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", capacity: 0, equipment_csv: "" }
  });

  function openNew() {
    setEditing(null);
    form.reset({ name: "", capacity: 0, equipment_csv: "" });
    setModalOpen(true);
  }

  function openEdit(r: MeetingRoom) {
    setEditing(r);
    form.reset({ name: r.name, capacity: r.capacity, equipment_csv: (r.equipment ?? []).join(", ") });
    setModalOpen(true);
  }

  function parseEquipment(csv: string | undefined) {
    const raw = (csv ?? "").trim();
    if (!raw) return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function submit(values: Form) {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const payload = {
        name: values.name,
        capacity: values.capacity,
        equipment: parseEquipment(values.equipment_csv)
      };

      if (editing) {
        await apiFetch<MeetingRoom>(`/api/operations/meetings/rooms/${encodeURIComponent(editing.id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        notify({ title: t("toast.updated.title"), description: t("toast.updated.description"), tone: "success" });
      } else {
        await apiFetch<MeetingRoom>("/api/operations/meetings/rooms", {
          method: "POST",
          body: JSON.stringify({ property_id: propertyId, ...payload })
        });
        notify({ title: t("toast.created.title"), description: t("toast.created.description"), tone: "success" });
      }

      setModalOpen(false);
      setEditing(null);
      await loadRooms();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function remove(room: MeetingRoom) {
    setLoading(true);
    setError(null);
    try {
      await apiFetch<void>(`/api/operations/meetings/rooms/${encodeURIComponent(room.id)}`, { method: "DELETE" });
      notify({ title: t("toast.deleted.title"), description: t("toast.deleted.description"), tone: "success" });
      await loadRooms();
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

  return (
    <div className="grid gap-4" data-testid="meetings-events-page">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => void loadRooms()} disabled={loading}>
            {t("refresh")}
          </Button>
          <Button type="button" onClick={openNew} data-testid="meeting-room-new">
            {t("rooms.new")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-cortai-red">
          {error}
        </div>
      ) : null}

      <Card title={t("rooms.title")}>
        <Table headers={[t("rooms.cols.name"), t("rooms.cols.capacity"), t("rooms.cols.equipment"), t("rooms.cols.actions")]}>
          {rooms.length === 0 ? (
            <tr>
              <Td className="text-cortai-text3" colSpan={4}>
                {loading ? t("loading") : t("rooms.empty")}
              </Td>
            </tr>
          ) : null}
          {rooms.map((r) => (
            <tr key={r.id} className="hover:bg-white/[0.02]">
              <Td className="font-semibold">{r.name}</Td>
              <Td className="text-cortai-text2">{r.capacity}</Td>
              <Td className="text-cortai-text2">{(r.equipment ?? []).join(", ") || t("rooms.noEquipment")}</Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" onClick={() => openEdit(r)} data-testid="meeting-room-edit">
                    {t("rooms.edit")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void remove(r)} data-testid="meeting-room-delete">
                    {t("rooms.delete")}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal
        open={modalOpen}
        title={editing ? t("rooms.modal.editTitle") : t("rooms.modal.newTitle")}
        closeLabel={t("close")}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={form.handleSubmit((v) => void submit(v))} className="grid gap-3" data-testid="meeting-room-modal">
          <Input label={t("rooms.modal.name")} error={form.formState.errors.name?.message} {...form.register("name")} />
          <Input
            label={t("rooms.modal.capacity")}
            error={form.formState.errors.capacity?.message}
            type="number"
            {...form.register("capacity")}
          />
          <Input
            label={t("rooms.modal.equipment")}
            error={form.formState.errors.equipment_csv?.message}
            {...form.register("equipment_csv")}
          />
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              {t("close")}
            </Button>
            <Button type="submit" className="ml-auto" disabled={loading}>
              {t("rooms.modal.submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

