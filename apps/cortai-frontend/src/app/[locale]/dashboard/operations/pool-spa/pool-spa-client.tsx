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

type PoolCapacity = {
  property_id: string;
  count: number;
  capacity: number;
  status: string;
  last_updated: string | null;
};

type SpaService = {
  id: string;
  org_id: string;
  property_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  available: boolean;
  created_at: string;
  updated_at: string;
};
type SpaServiceList = { items: SpaService[] };

type SpaAppointment = {
  id: string;
  org_id: string;
  property_id: string;
  guest_id: string;
  service: string;
  therapist_user_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string | null;
  created_at: string;
  updated_at: string;
};
type SpaAppointmentList = { items: SpaAppointment[]; total: number; page: number; page_size: number };

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function toneForPoolStatus(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "busy") return "red";
  if (s === "moderate") return "amber";
  if (s === "quiet") return "green";
  return "neutral";
}

export function PoolSpaClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.poolSpa");
  const tc = useTranslations("operations.common");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pool, setPool] = useState<PoolCapacity | null>(null);
  const [services, setServices] = useState<SpaService[]>([]);
  const [appointments, setAppointments] = useState<SpaAppointmentList | null>(null);

  const [appointmentsView, setAppointmentsView] = useState<"list" | "calendar">("list");

  const page = 1;
  const pageSize = 50;

  const loadAll = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const [pc, sv, ap] = await Promise.all([
        apiFetch<PoolCapacity>(`/api/operations/pool/capacity?property_id=${pid}`),
        apiFetch<SpaServiceList>(`/api/operations/spa/services?property_id=${pid}`),
        apiFetch<SpaAppointmentList>(`/api/operations/spa/appointments?property_id=${pid}&page=${page}&page_size=${pageSize}`)
      ]);
      setPool(pc);
      setServices(sv.items);
      setAppointments(ap);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, propertyId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Services modal (create only for now)
  const [svcOpen, setSvcOpen] = useState(false);
  const svcSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1).max(180),
        description: z.string().max(500).optional().or(z.literal("")),
        duration_minutes: z.coerce.number().int().min(0),
        price_cents: z.coerce.number().int().min(0),
        available: z.boolean()
      }),
    []
  );
  type SvcForm = z.infer<typeof svcSchema>;
  const svcForm = useForm<SvcForm>({
    resolver: zodResolver(svcSchema),
    defaultValues: { name: "", description: "", duration_minutes: 60, price_cents: 0, available: true }
  });

  async function submitService(values: SvcForm) {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch<SpaService>("/api/operations/spa/services", {
        method: "POST",
        body: JSON.stringify({
          property_id: propertyId,
          name: values.name,
          description: values.description ? values.description : null,
          duration_minutes: values.duration_minutes,
          price_cents: values.price_cents,
          available: values.available
        })
      });
      notify({ title: t("toast.serviceCreated.title"), description: t("toast.serviceCreated.description"), tone: "success" });
      setSvcOpen(false);
      svcForm.reset({ name: "", description: "", duration_minutes: 60, price_cents: 0, available: true });
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  // Appointments create/edit + detail
  const [apptOpen, setApptOpen] = useState(false);
  const [apptEditing, setApptEditing] = useState<SpaAppointment | null>(null);
  const [apptDetail, setApptDetail] = useState<SpaAppointment | null>(null);

  const apptSchema = useMemo(
    () =>
      z.object({
        guest_id: z.string().uuid(),
        service: z.string().min(1).max(120),
        starts_at: z.string().min(1),
        ends_at: z.string().min(1),
        status: z.string().max(32).optional().or(z.literal(""))
      }),
    []
  );
  type ApptForm = z.infer<typeof apptSchema>;
  const apptForm = useForm<ApptForm>({
    resolver: zodResolver(apptSchema),
    defaultValues: { guest_id: "", service: "", starts_at: "", ends_at: "", status: "booked" }
  });

  function openNewAppt() {
    setApptEditing(null);
    apptForm.reset({ guest_id: "", service: "", starts_at: "", ends_at: "", status: "booked" });
    setApptOpen(true);
  }

  function openEditAppt(a: SpaAppointment) {
    setApptEditing(a);
    apptForm.reset({
      guest_id: a.guest_id,
      service: a.service,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      status: a.status ?? ""
    });
    setApptOpen(true);
  }

  async function submitAppt(values: ApptForm) {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      if (apptEditing) {
        await apiFetch<SpaAppointment>(`/api/operations/spa/appointments/${encodeURIComponent(apptEditing.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            guest_id: values.guest_id,
            service: values.service,
            starts_at: values.starts_at,
            ends_at: values.ends_at,
            status: values.status ? values.status : null
          })
        });
        notify({ title: t("toast.apptUpdated.title"), description: t("toast.apptUpdated.description"), tone: "success" });
      } else {
        await apiFetch<SpaAppointment>("/api/operations/spa/appointments", {
          method: "POST",
          body: JSON.stringify({
            property_id: propertyId,
            guest_id: values.guest_id,
            service: values.service,
            starts_at: values.starts_at,
            ends_at: values.ends_at,
            status: values.status ? values.status : null
          })
        });
        notify({ title: t("toast.apptCreated.title"), description: t("toast.apptCreated.description"), tone: "success" });
      }
      setApptOpen(false);
      setApptEditing(null);
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  const calendarGroups = useMemo(() => {
    const items = appointments?.items ?? [];
    const m = new Map<string, SpaAppointment[]>();
    for (const a of items) {
      const d = new Date(a.starts_at);
      const key = Number.isNaN(d.getTime()) ? a.starts_at.slice(0, 10) : d.toISOString().slice(0, 10);
      m.set(key, [...(m.get(key) ?? []), a]);
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [appointments?.items]);

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-xs text-cortai-text2">{t("selectProperty")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="pool-spa-page">
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
        <Card title={t("pool.title")}>
          {!pool ? (
            <p className="text-xs text-cortai-text3">{loading ? t("loading") : t("empty")}</p>
          ) : (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{t("pool.count", { count: pool.count })}</Badge>
                <Badge tone="blue">{t("pool.capacity", { capacity: pool.capacity })}</Badge>
                <Badge tone={toneForPoolStatus(pool.status)}>{t(`pool.level.${pool.status}`)}</Badge>
                <span className="ml-auto text-[11px] text-cortai-text3">{fmtTs(pool.last_updated, tc("dash"))}</span>
              </div>
            </div>
          )}
        </Card>

        <Card
          title={t("services.title")}
          action={
            <Button type="button" onClick={() => setSvcOpen(true)} data-testid="pool-spa-service-new">
              {t("services.new")}
            </Button>
          }
        >
          <Table headers={[t("services.cols.name"), t("services.cols.duration"), t("services.cols.price"), t("services.cols.available"), t("services.cols.updated")]}>
            {services.length === 0 ? (
              <tr>
                <Td className="text-cortai-text3" colSpan={5}>
                  {loading ? t("loading") : t("services.empty")}
                </Td>
              </tr>
            ) : null}
            {services.map((s) => (
              <tr key={s.id} className="hover:bg-white/[0.02]">
                <Td>
                  <div className="font-semibold">{s.name}</div>
                  {s.description ? <div className="text-[11px] text-cortai-text3">{s.description}</div> : null}
                </Td>
                <Td className="text-cortai-text2">{t("services.minutes", { minutes: s.duration_minutes })}</Td>
                <Td className="text-cortai-text2">${dollars(s.price_cents)}</Td>
                <Td>
                  <Badge tone={s.available ? "green" : "neutral"}>{s.available ? t("yes") : t("no")}</Badge>
                </Td>
                <Td className="text-cortai-text3">{fmtTs(s.updated_at, tc("dash"))}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card
        title={t("appointments.title")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={appointmentsView === "list" ? "primary" : "ghost"}
              onClick={() => setAppointmentsView("list")}
            >
              {t("appointments.view.list")}
            </Button>
            <Button
              type="button"
              variant={appointmentsView === "calendar" ? "primary" : "ghost"}
              onClick={() => setAppointmentsView("calendar")}
            >
              {t("appointments.view.calendar")}
            </Button>
            <Button type="button" onClick={openNewAppt} data-testid="pool-spa-appt-new">
              {t("appointments.new")}
            </Button>
          </div>
        }
      >
        {appointmentsView === "calendar" ? (
          calendarGroups.length === 0 ? (
            <p className="text-xs text-cortai-text3">{loading ? t("loading") : t("appointments.empty")}</p>
          ) : (
            <div className="grid gap-3">
              {calendarGroups.map(([day, items]) => (
                <div key={day} className="rounded-md border border-cortai-border bg-cortai-bg2 p-3">
                  <div className="mb-2 text-xs font-semibold text-cortai-text">{day}</div>
                  <div className="grid gap-2">
                    {items.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setApptDetail(a)}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-cortai-border bg-cortai-bg px-3 py-2 text-left transition hover:border-cortai-teal/25 hover:bg-cortai-bg3"
                      >
                        <Badge tone="neutral">{a.status ?? t("appointments.status.unknown")}</Badge>
                        <span className="text-xs font-semibold">{a.service}</span>
                        <span className="ml-auto text-[11px] text-cortai-text3">{fmtTs(a.starts_at, tc("dash"))}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <Table
            headers={[
              t("appointments.cols.service"),
              t("appointments.cols.guest"),
              t("appointments.cols.starts"),
              t("appointments.cols.ends"),
              t("appointments.cols.status"),
              t("appointments.cols.actions")
            ]}
          >
            {(appointments?.items ?? []).length === 0 ? (
              <tr>
                <Td className="text-cortai-text3" colSpan={6}>
                  {loading ? t("loading") : t("appointments.empty")}
                </Td>
              </tr>
            ) : null}
            {(appointments?.items ?? []).map((a) => (
              <tr key={a.id} className="hover:bg-white/[0.02]">
                <Td>
                  <div className="font-semibold">{a.service}</div>
                  <div className="text-[11px] text-cortai-text3">{a.id.slice(0, 8)}</div>
                </Td>
                <Td className="text-cortai-text2">{a.guest_id.slice(0, 8)}</Td>
                <Td className="text-cortai-text2">{fmtTs(a.starts_at, tc("dash"))}</Td>
                <Td className="text-cortai-text2">{fmtTs(a.ends_at, tc("dash"))}</Td>
                <Td>
                  <Badge tone="neutral">{a.status ?? t("appointments.status.unknown")}</Badge>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="ghost" onClick={() => setApptDetail(a)} data-testid="pool-spa-appt-detail">
                      {t("appointments.detail")}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => openEditAppt(a)}>
                      {t("appointments.edit")}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={svcOpen} title={t("services.modal.title")} closeLabel={t("close")} onClose={() => setSvcOpen(false)}>
        <form onSubmit={svcForm.handleSubmit((v) => void submitService(v))} className="grid gap-3" data-testid="pool-spa-service-modal">
          <Input label={t("services.modal.name")} error={svcForm.formState.errors.name?.message} {...svcForm.register("name")} />
          <Input
            label={t("services.modal.description")}
            error={svcForm.formState.errors.description?.message}
            {...svcForm.register("description")}
          />
          <Input
            label={t("services.modal.durationMinutes")}
            error={svcForm.formState.errors.duration_minutes?.message}
            type="number"
            {...svcForm.register("duration_minutes")}
          />
          <Input
            label={t("services.modal.priceCents")}
            error={svcForm.formState.errors.price_cents?.message}
            type="number"
            {...svcForm.register("price_cents")}
          />
          <label className="flex items-center gap-2 text-xs text-cortai-text2">
            <input type="checkbox" {...svcForm.register("available")} />
            <span>{t("services.modal.available")}</span>
          </label>
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setSvcOpen(false)}>
              {t("close")}
            </Button>
            <Button type="submit" className="ml-auto" disabled={loading}>
              {t("services.modal.submit")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={apptOpen}
        title={apptEditing ? t("appointments.modal.editTitle") : t("appointments.modal.newTitle")}
        closeLabel={t("close")}
        onClose={() => setApptOpen(false)}
      >
        <form onSubmit={apptForm.handleSubmit((v) => void submitAppt(v))} className="grid gap-3" data-testid="pool-spa-appt-modal">
          <Input label={t("appointments.modal.guestId")} error={apptForm.formState.errors.guest_id?.message} {...apptForm.register("guest_id")} />
          <Input label={t("appointments.modal.service")} error={apptForm.formState.errors.service?.message} {...apptForm.register("service")} />
          <Input label={t("appointments.modal.startsAt")} error={apptForm.formState.errors.starts_at?.message} {...apptForm.register("starts_at")} />
          <Input label={t("appointments.modal.endsAt")} error={apptForm.formState.errors.ends_at?.message} {...apptForm.register("ends_at")} />
          <Input label={t("appointments.modal.status")} error={apptForm.formState.errors.status?.message} {...apptForm.register("status")} />
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setApptOpen(false)}>
              {t("close")}
            </Button>
            <Button type="submit" className="ml-auto" disabled={loading}>
              {t("appointments.modal.submit")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={apptDetail !== null}
        title={t("appointments.detailTitle", { id: apptDetail?.id?.slice(0, 8) ?? "" })}
        closeLabel={t("close")}
        onClose={() => setApptDetail(null)}
      >
        {!apptDetail ? null : (
          <div className="grid gap-3" data-testid="pool-spa-appt-detail-modal">
            <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-3 text-xs text-cortai-text2">
              <div className="font-semibold text-cortai-text">{apptDetail.service}</div>
              <div>{t("appointments.detailGuest", { guest: apptDetail.guest_id.slice(0, 8) })}</div>
              <div>{t("appointments.detailStarts", { value: fmtTs(apptDetail.starts_at, tc("dash")) })}</div>
              <div>{t("appointments.detailEnds", { value: fmtTs(apptDetail.ends_at, tc("dash")) })}</div>
              <div>{t("appointments.detailStatus", { status: apptDetail.status ?? t("appointments.status.unknown") })}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => openEditAppt(apptDetail)}>
                {t("appointments.edit")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void submitAppt({ ...apptForm.getValues(), status: "completed", guest_id: apptDetail.guest_id, service: apptDetail.service, starts_at: apptDetail.starts_at, ends_at: apptDetail.ends_at })}
              >
                {t("appointments.actions.markCompleted")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

