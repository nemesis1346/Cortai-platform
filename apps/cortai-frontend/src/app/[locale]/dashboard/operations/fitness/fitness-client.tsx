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

type FitnessCapacity = {
  property_id: string;
  count: number;
  capacity: number;
  status: string;
  last_updated: string | null;
};

type FitnessEquipment = {
  equipment_id: string;
  type: string;
  status: string;
  in_use: boolean;
  last_updated: string | null;
};

type FitnessClass = {
  id: string;
  org_id: string;
  property_id: string;
  name: string;
  instructor_name: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked: number;
  location: string | null;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};
type FitnessClassList = { items: FitnessClass[] };

type FitnessCheckin = {
  id: string;
  org_id: string;
  property_id: string;
  guest_id: string;
  class_id: string | null;
  checked_in_at: string;
  source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
type FitnessCheckinList = { items: FitnessCheckin[] };

function toneForCapacityStatus(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "busy") return "red";
  if (s === "moderate") return "amber";
  if (s === "quiet") return "green";
  return "neutral";
}

export function FitnessClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.fitness");
  const tc = useTranslations("operations.common");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [capacity, setCapacity] = useState<FitnessCapacity | null>(null);
  const [equipment, setEquipment] = useState<FitnessEquipment[]>([]);
  const [classes, setClasses] = useState<FitnessClass[]>([]);
  const [checkins, setCheckins] = useState<FitnessCheckin[]>([]);

  const loadAll = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const [cap, eq, cls, chk] = await Promise.all([
        apiFetch<FitnessCapacity>(`/api/operations/fitness/capacity?property_id=${pid}`),
        apiFetch<FitnessEquipment[]>(`/api/operations/fitness/equipment?property_id=${pid}`),
        apiFetch<FitnessClassList>(`/api/operations/fitness/classes?property_id=${pid}`),
        apiFetch<FitnessCheckinList>(`/api/operations/fitness/checkins?property_id=${pid}`)
      ]);
      setCapacity(cap);
      setEquipment(eq);
      setClasses(cls.items);
      setCheckins(chk.items);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Classes modal (create/edit)
  const [classOpen, setClassOpen] = useState(false);
  const [classEditing, setClassEditing] = useState<FitnessClass | null>(null);

  const classSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1).max(180),
        instructor_name: z.string().max(180).optional().or(z.literal("")),
        starts_at: z.string().min(1),
        ends_at: z.string().min(1),
        capacity: z.coerce.number().int().min(0),
        booked: z.coerce.number().int().min(0),
        location: z.string().max(180).optional().or(z.literal("")),
        description: z.string().max(500).optional().or(z.literal("")),
        status: z.string().min(1).max(32)
      }),
    []
  );
  type ClassForm = z.infer<typeof classSchema>;
  const classForm = useForm<ClassForm>({
    resolver: zodResolver(classSchema),
    defaultValues: {
      name: "",
      instructor_name: "",
      starts_at: "",
      ends_at: "",
      capacity: 0,
      booked: 0,
      location: "",
      description: "",
      status: "scheduled"
    }
  });

  function openNewClass() {
    setClassEditing(null);
    classForm.reset({
      name: "",
      instructor_name: "",
      starts_at: "",
      ends_at: "",
      capacity: 0,
      booked: 0,
      location: "",
      description: "",
      status: "scheduled"
    });
    setClassOpen(true);
  }

  function openEditClass(c: FitnessClass) {
    setClassEditing(c);
    classForm.reset({
      name: c.name,
      instructor_name: c.instructor_name ?? "",
      starts_at: c.starts_at,
      ends_at: c.ends_at,
      capacity: c.capacity,
      booked: c.booked,
      location: c.location ?? "",
      description: c.description ?? "",
      status: c.status
    });
    setClassOpen(true);
  }

  async function submitClass(values: ClassForm) {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      if (classEditing) {
        await apiFetch<FitnessClass>(`/api/operations/fitness/classes/${encodeURIComponent(classEditing.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: values.name,
            instructor_name: values.instructor_name ? values.instructor_name : null,
            starts_at: values.starts_at,
            ends_at: values.ends_at,
            capacity: values.capacity,
            booked: values.booked,
            location: values.location ? values.location : null,
            description: values.description ? values.description : null,
            status: values.status
          })
        });
        notify({ title: t("toast.classUpdated.title"), description: t("toast.classUpdated.description"), tone: "success" });
      } else {
        await apiFetch<FitnessClass>("/api/operations/fitness/classes", {
          method: "POST",
          body: JSON.stringify({
            property_id: propertyId,
            name: values.name,
            instructor_name: values.instructor_name ? values.instructor_name : null,
            starts_at: values.starts_at,
            ends_at: values.ends_at,
            capacity: values.capacity,
            booked: values.booked,
            location: values.location ? values.location : null,
            description: values.description ? values.description : null,
            status: values.status
          })
        });
        notify({ title: t("toast.classCreated.title"), description: t("toast.classCreated.description"), tone: "success" });
      }
      setClassOpen(false);
      setClassEditing(null);
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  // Checkins modal (create)
  const [checkinOpen, setCheckinOpen] = useState(false);
  const checkinSchema = useMemo(
    () =>
      z.object({
        guest_id: z.string().uuid(),
        class_id: z.string().uuid().optional().or(z.literal("")),
        source: z.string().min(1).max(32),
        notes: z.string().max(500).optional().or(z.literal(""))
      }),
    []
  );
  type CheckinForm = z.infer<typeof checkinSchema>;
  const checkinForm = useForm<CheckinForm>({
    resolver: zodResolver(checkinSchema),
    defaultValues: { guest_id: "", class_id: "", source: "manual", notes: "" }
  });

  async function submitCheckin(values: CheckinForm) {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch<FitnessCheckin>("/api/operations/fitness/checkins", {
        method: "POST",
        body: JSON.stringify({
          property_id: propertyId,
          guest_id: values.guest_id,
          class_id: values.class_id ? values.class_id : null,
          source: values.source,
          notes: values.notes ? values.notes : null
        })
      });
      notify({ title: t("toast.checkinCreated.title"), description: t("toast.checkinCreated.description"), tone: "success" });
      setCheckinOpen(false);
      checkinForm.reset({ guest_id: "", class_id: "", source: "manual", notes: "" });
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

  return (
    <div className="grid gap-4" data-testid="fitness-page">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => void loadAll()} disabled={loading}>
            {t("refresh")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-cortai-red">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("capacity.title")}>
          {!capacity ? (
            <p className="text-xs text-cortai-text3">{loading ? t("loading") : t("empty")}</p>
          ) : (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{t("capacity.count", { count: capacity.count })}</Badge>
                <Badge tone="blue">{t("capacity.capacity", { capacity: capacity.capacity })}</Badge>
                <Badge tone={toneForCapacityStatus(capacity.status)}>{t(`capacity.level.${capacity.status}`)}</Badge>
                <span className="ml-auto text-[11px] text-cortai-text3">{fmtTs(capacity.last_updated, tc("dash"))}</span>
              </div>
            </div>
          )}
        </Card>

        <Card title={t("equipment.title")}>
          <Table headers={[t("equipment.cols.equipment"), t("equipment.cols.type"), t("equipment.cols.status"), t("equipment.cols.updated")]}>
            {equipment.length === 0 ? (
              <tr>
                <Td className="text-cortai-text3" colSpan={4}>
                  {loading ? t("loading") : t("equipment.empty")}
                </Td>
              </tr>
            ) : null}
            {equipment.map((e) => (
              <tr key={e.equipment_id} className="hover:bg-white/[0.02]">
                <Td className="font-semibold">{e.equipment_id}</Td>
                <Td className="text-cortai-text2">{e.type}</Td>
                <Td>
                  <Badge tone={e.in_use ? "amber" : "neutral"}>{e.status}</Badge>
                </Td>
                <Td className="text-cortai-text3">{fmtTs(e.last_updated, tc("dash"))}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card
        title={t("classes.title")}
        action={
          <Button type="button" onClick={openNewClass} data-testid="fitness-class-new">
            {t("classes.new")}
          </Button>
        }
      >
        <Table
          headers={[
            t("classes.cols.name"),
            t("classes.cols.time"),
            t("classes.cols.capacity"),
            t("classes.cols.status"),
            t("classes.cols.actions")
          ]}
        >
          {classes.length === 0 ? (
            <tr>
              <Td className="text-cortai-text3" colSpan={5}>
                {loading ? t("loading") : t("classes.empty")}
              </Td>
            </tr>
          ) : null}
          {classes.map((c) => (
            <tr key={c.id} className="hover:bg-white/[0.02]">
              <Td>
                <div className="font-semibold">{c.name}</div>
                <div className="text-[11px] text-cortai-text3">
                  {c.instructor_name ? t("classes.instructor", { name: c.instructor_name }) : tc("dash")}
                </div>
              </Td>
              <Td className="text-cortai-text2">
                {fmtTs(c.starts_at, tc("dash"))} → {fmtTs(c.ends_at, tc("dash"))}
              </Td>
              <Td className="text-cortai-text2">
                {c.booked}/{c.capacity}
              </Td>
              <Td>
                <Badge tone="neutral">{c.status}</Badge>
              </Td>
              <Td>
                <Button type="button" variant="ghost" onClick={() => openEditClass(c)} data-testid="fitness-class-edit">
                  {t("classes.edit")}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card
        title={t("checkins.title")}
        action={
          <Button type="button" onClick={() => setCheckinOpen(true)} data-testid="fitness-checkin-new">
            {t("checkins.new")}
          </Button>
        }
      >
        <Table headers={[t("checkins.cols.guest"), t("checkins.cols.class"), t("checkins.cols.time"), t("checkins.cols.source")]}>
          {checkins.length === 0 ? (
            <tr>
              <Td className="text-cortai-text3" colSpan={4}>
                {loading ? t("loading") : t("checkins.empty")}
              </Td>
            </tr>
          ) : null}
          {checkins.map((c) => (
            <tr key={c.id} className="hover:bg-white/[0.02]">
              <Td className="text-cortai-text2">{c.guest_id.slice(0, 8)}</Td>
              <Td className="text-cortai-text2">{c.class_id ? c.class_id.slice(0, 8) : tc("dash")}</Td>
              <Td className="text-cortai-text2">{fmtTs(c.checked_in_at, tc("dash"))}</Td>
              <Td>
                <Badge tone="neutral">{c.source}</Badge>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal
        open={classOpen}
        title={classEditing ? t("classes.modal.editTitle") : t("classes.modal.newTitle")}
        closeLabel={t("close")}
        onClose={() => setClassOpen(false)}
      >
        <form onSubmit={classForm.handleSubmit((v) => void submitClass(v))} className="grid gap-3" data-testid="fitness-class-modal">
          <Input label={t("classes.modal.name")} error={classForm.formState.errors.name?.message} {...classForm.register("name")} />
          <Input
            label={t("classes.modal.instructor")}
            error={classForm.formState.errors.instructor_name?.message}
            {...classForm.register("instructor_name")}
          />
          <Input label={t("classes.modal.startsAt")} error={classForm.formState.errors.starts_at?.message} {...classForm.register("starts_at")} />
          <Input label={t("classes.modal.endsAt")} error={classForm.formState.errors.ends_at?.message} {...classForm.register("ends_at")} />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t("classes.modal.capacity")}
              error={classForm.formState.errors.capacity?.message}
              type="number"
              {...classForm.register("capacity")}
            />
            <Input
              label={t("classes.modal.booked")}
              error={classForm.formState.errors.booked?.message}
              type="number"
              {...classForm.register("booked")}
            />
          </div>
          <Input label={t("classes.modal.location")} error={classForm.formState.errors.location?.message} {...classForm.register("location")} />
          <Input
            label={t("classes.modal.description")}
            error={classForm.formState.errors.description?.message}
            {...classForm.register("description")}
          />
          <Input label={t("classes.modal.status")} error={classForm.formState.errors.status?.message} {...classForm.register("status")} />
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setClassOpen(false)}>
              {t("close")}
            </Button>
            <Button type="submit" className="ml-auto" disabled={loading}>
              {t("classes.modal.submit")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={checkinOpen} title={t("checkins.modal.title")} closeLabel={t("close")} onClose={() => setCheckinOpen(false)}>
        <form onSubmit={checkinForm.handleSubmit((v) => void submitCheckin(v))} className="grid gap-3" data-testid="fitness-checkin-modal">
          <Input label={t("checkins.modal.guestId")} error={checkinForm.formState.errors.guest_id?.message} {...checkinForm.register("guest_id")} />
          <Input label={t("checkins.modal.classId")} error={checkinForm.formState.errors.class_id?.message} {...checkinForm.register("class_id")} />
          <Input label={t("checkins.modal.source")} error={checkinForm.formState.errors.source?.message} {...checkinForm.register("source")} />
          <Input label={t("checkins.modal.notes")} error={checkinForm.formState.errors.notes?.message} {...checkinForm.register("notes")} />
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCheckinOpen(false)}>
              {t("close")}
            </Button>
            <Button type="submit" className="ml-auto" disabled={loading}>
              {t("checkins.modal.submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

