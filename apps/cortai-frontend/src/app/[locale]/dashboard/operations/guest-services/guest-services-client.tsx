"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, Td } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";

type GuestServiceType = "towels" | "pillows" | "amenities" | "late_checkout" | "wake_up" | "other";
type GuestServiceStatus = "pending" | "assigned" | "completed" | "cancelled";

type GuestServiceItem = {
  id: string;
  org_id: string;
  property_id: string;
  room_id: string | null;
  guest_id: string | null;
  action_queue_item_id: string | null;
  type: GuestServiceType;
  status: GuestServiceStatus;
  note: string | null;
  assigned_to_user_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type GuestServiceList = { items: GuestServiceItem[] };

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}

function statusTone(st: GuestServiceStatus) {
  if (st === "completed") return "green";
  if (st === "assigned") return "blue";
  if (st === "cancelled") return "red";
  return "amber";
}

function typeLabel(t: GuestServiceType) {
  if (t === "late_checkout") return "Late checkout";
  if (t === "wake_up") return "Wake up";
  if (t === "amenities") return "Amenities";
  if (t === "pillows") return "Pillows";
  if (t === "towels") return "Towels";
  return "Other";
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function GuestServicesClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.guestServices");
  const { user } = useAuth();
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [items, setItems] = useState<GuestServiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const [statusFilter, setStatusFilter] = useState<GuestServiceStatus | "">("");
  const [typeFilter, setTypeFilter] = useState<GuestServiceType | "">("");
  const [roomFilter, setRoomFilter] = useState("");

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("property_id", propertyId);
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter) params.set("type", typeFilter);
      if (roomFilter.trim()) params.set("room", roomFilter.trim());
      const resp = await apiFetch<GuestServiceList>(`/api/operations/guest-services?${params.toString()}`);
      setItems(resp.items);
    } finally {
      setLoading(false);
    }
  }, [propertyId, roomFilter, statusFilter, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const schema = useMemo(
    () =>
      z.object({
        type: z.enum(["towels", "pillows", "amenities", "late_checkout", "wake_up", "other"]),
        room_id: z.string().uuid().optional().or(z.literal("")),
        note: z.string().max(500).optional().or(z.literal(""))
      }),
    []
  );
  type CreateForm = z.infer<typeof schema>;

  const form = useForm<CreateForm>({
    resolver: zodResolver(schema),
    defaultValues: { type: "towels", room_id: "", note: "" }
  });

  async function submit(values: CreateForm) {
    if (!propertyId) return;
    setLoading(true);
    try {
      await apiFetch("/api/operations/guest-services", {
        method: "POST",
        body: JSON.stringify({
          property_id: propertyId,
          room_id: values.room_id ? values.room_id : null,
          type: values.type,
          note: values.note ? values.note : null
        })
      });
      setOpen(false);
      form.reset({ type: "towels", room_id: "", note: "" });
      notify({ title: t("toast.created.title"), description: t("toast.created.description"), tone: "success" });
      await load();
    } catch (e) {
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function patch(id: string, payload: unknown) {
    setLoading(true);
    try {
      await apiFetch(`/api/operations/guest-services/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      await load();
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
    <div className="grid gap-4" data-testid="guest-services-page">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => void load()} disabled={loading}>
            {t("refresh")}
          </Button>
          <Button type="button" onClick={() => setOpen(true)} data-testid="guest-services-new">
            {t("new")}
          </Button>
        </div>
      </div>

      <Card
        title={t("directory")}
        action={
          <div className="flex flex-wrap gap-2" data-testid="guest-services-filters">
            <select
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as GuestServiceStatus | "")}
            >
              <option value="">{t("filters.allStatuses")}</option>
              {(["pending", "assigned", "completed", "cancelled"] as const).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as GuestServiceType | "")}
            >
              <option value="">{t("filters.allTypes")}</option>
              {(["towels", "pillows", "amenities", "late_checkout", "wake_up", "other"] as const).map((tt) => (
                <option key={tt} value={tt}>
                  {typeLabel(tt)}
                </option>
              ))}
            </select>
            <input
              value={roomFilter}
              onChange={(e) => setRoomFilter(e.target.value)}
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              placeholder={t("filters.roomId")}
            />
            <Button type="button" variant="ghost" onClick={() => void load()}>
              {t("filters.apply")}
            </Button>
          </div>
        }
      >
        <Table headers={[t("cols.type"), t("cols.status"), t("cols.room"), t("cols.note"), t("cols.created"), t("cols.actions")]}>
          {items.length === 0 ? (
            <tr>
              <Td className="text-cortai-text3" colSpan={6}>
                {loading ? t("loading") : t("empty")}
              </Td>
            </tr>
          ) : null}
          {items.map((it) => (
            <tr key={it.id} className="hover:bg-white/[0.02]">
              <Td>
                <div className="font-semibold">{typeLabel(it.type)}</div>
              </Td>
              <Td>
                <Badge tone={statusTone(it.status)}>{it.status}</Badge>
              </Td>
              <Td className="text-cortai-text2">{it.room_id ? it.room_id.slice(0, 8) : "—"}</Td>
              <Td className="max-w-[420px] text-cortai-text2">{it.note ?? "—"}</Td>
              <Td className="text-cortai-text2">{fmtDate(it.created_at)}</Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  {it.status !== "completed" && it.status !== "cancelled" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!user}
                      onClick={() => void patch(it.id, { status: "assigned", assigned_to_user_id: user?.id })}
                    >
                      {t("actions.assignToMe")}
                    </Button>
                  ) : null}
                  {it.status !== "completed" ? (
                    <Button type="button" variant="ghost" onClick={() => void patch(it.id, { status: "completed" })}>
                      {t("actions.complete")}
                    </Button>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal open={open} title={t("modal.title")} closeLabel={t("close")} onClose={() => setOpen(false)}>
        <form
          onSubmit={form.handleSubmit((v) => void submit(v))}
          className="grid gap-3"
          data-testid="guest-services-modal"
        >
          <label className="grid gap-1.5 text-xs text-cortai-text2">
            <span className="font-medium">{t("modal.type")}</span>
            <select
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none transition focus:border-cortai-teal"
              {...form.register("type")}
            >
              {(["towels", "pillows", "amenities", "late_checkout", "wake_up", "other"] as const).map((tt) => (
                <option key={tt} value={tt}>
                  {typeLabel(tt)}
                </option>
              ))}
            </select>
          </label>

          <Input label={t("modal.roomId")} error={form.formState.errors.room_id?.message} {...form.register("room_id")} />
          <Input label={t("modal.note")} error={form.formState.errors.note?.message} {...form.register("note")} />

          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("close")}
            </Button>
            <Button type="submit" className="ml-auto" disabled={loading}>
              {t("modal.submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

