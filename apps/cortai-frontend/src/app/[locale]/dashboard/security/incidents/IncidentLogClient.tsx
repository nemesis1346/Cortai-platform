"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, Td } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/api";

type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type IncidentStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";

type IncidentRead = {
  id: string;
  org_id: string;
  property_id: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description?: string | null;
  assigned_to?: string | null;
  created_at: string;
  resolved_at?: string | null;
  sla_due_at?: string | null;
  sla_escalated_at?: string | null;
};

type IncidentList = {
  items: IncidentRead[];
  total: number;
  page: number;
  page_size: number;
};

type IncidentTriageResponse = {
  suggested_priority: string;
  suggested_category: string;
  suggested_assignee_id: string | null;
  confidence: number | null;
  reasoning_md: string;
};

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) return decodeURIComponent(p.slice(prefix.length));
  }
  return null;
}

function fmtDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function fmtSla(value: string | null | undefined, nowMs: number, t: (key: string, values?: Record<string, number>) => string) {
  if (!value) return "—";
  const due = new Date(value).getTime();
  if (Number.isNaN(due)) return value;
  const diff = due - nowMs;
  const abs = Math.abs(diff);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);
  if (diff < 0) return t("slaOverdue", { hours, minutes, seconds });
  return t("slaRemaining", { hours, minutes, seconds });
}

function severityTone(sev: IncidentSeverity) {
  if (sev === "CRITICAL") return "red";
  if (sev === "HIGH") return "amber";
  if (sev === "MEDIUM") return "blue";
  return "teal";
}

function statusTone(st: IncidentStatus) {
  if (st === "RESOLVED") return "green";
  if (st === "IN_PROGRESS") return "blue";
  return "amber";
}

export function IncidentLogClient() {
  const t = useTranslations("incidents");
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const { notify } = useToast();
  const { user } = useAuth();

  const [propertyId, setPropertyId] = useState("");
  useEffect(() => {
    setPropertyId(getCookie("cortai_property_id") ?? "");
  }, [searchParams]);
  useEffect(() => {
    function onPropertyChanged(event: Event) {
      const detail = (event as CustomEvent<{ propertyId?: string }>).detail;
      const next = detail?.propertyId ?? getCookie("cortai_property_id") ?? "";
      setItems([]);
      setTotal(0);
      setPage(1);
      setPropertyId(next);
      pushQuery({ page: 1 });
    }
    window.addEventListener("cortai:property-changed", onPropertyChanged);
    return () => window.removeEventListener("cortai:property-changed", onPropertyChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [items, setItems] = useState<IncidentRead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverity | "">("");
  const [search, setSearch] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [triageOpen, setTriageOpen] = useState(false);
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageIncident, setTriageIncident] = useState<IncidentRead | null>(null);
  const [triage, setTriage] = useState<IncidentTriageResponse | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const effective = useMemo(() => {
    const q = searchParams.get("search") ?? "";
    const sev = (searchParams.get("severity") ?? "") as IncidentSeverity | "";
    const p = clampInt(searchParams.get("page"), 1, 1, 10_000);
    const ps = clampInt(searchParams.get("page_size"), 20, 1, 100);
    return { q, sev, p, ps };
  }, [searchParams]);

  const load = useCallback(async (q: string, sev: IncidentSeverity | "", nextPage: number, nextPageSize: number) => {
    const params = new URLSearchParams({
      page: String(nextPage),
      page_size: String(nextPageSize)
    });
    if (propertyId) params.set("property_id", propertyId);
    if (q) params.set("search", q);
    if (sev) params.set("severity", sev);
    const response = await apiFetch<IncidentList>(`/api/operations/incidents?${params.toString()}`);
    setItems(response.items);
    setTotal(response.total);
    setPage(response.page);
    setPageSize(response.page_size);
  }, [propertyId]);

  useEffect(() => {
    setSearch(effective.q);
    setSeverityFilter(effective.sev);
    void load(effective.q, effective.sev, effective.p, effective.ps);
  }, [effective, load]);

  // WebSocket: refresh incidents list and show toasts for incident events.
  useEffect(() => {
    if (!propertyId) return;

    type LiveMsg = { type: string } & Record<string, unknown>;
    function parseLiveMsg(data: unknown): LiveMsg | null {
      if (typeof data !== "string") return null;
      try {
        const parsed: unknown = JSON.parse(data);
        if (!parsed || typeof parsed !== "object") return null;
        if (!("type" in parsed)) return null;
        if (typeof (parsed as Record<string, unknown>).type !== "string") return null;
        return parsed as LiveMsg;
      } catch {
        return null;
      }
    }

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/ws/live`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", scope: "property", property_id: propertyId }));
    };
    ws.onmessage = (event) => {
      const msg = parseLiveMsg(String(event.data));
      if (!msg) return;
      if (msg.type === "incident.assigned") {
        notify({
          title: t("toast.assigned.title"),
          description: t("toast.assigned.description"),
          tone: "success"
        });
        void load(effective.q, effective.sev, effective.p, effective.ps);
      }
      if (msg.type === "incident.sla_expired") {
        notify({
          title: t("toast.slaExpired.title"),
          description: t("toast.slaExpired.description"),
          tone: "error"
        });
        void load(effective.q, effective.sev, effective.p, effective.ps);
      }
      if (msg.type === "incident.escalated") {
        notify({
          title: t("toast.escalated.title"),
          description: t("toast.escalated.description"),
          tone: "error"
        });
        void load(effective.q, effective.sev, effective.p, effective.ps);
      }
    };

    return () => {
      ws.close();
    };
  }, [effective, load, notify, propertyId, t]);

  function pushQuery(next: { search?: string; severity?: IncidentSeverity | ""; page?: number; page_size?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.search !== undefined) {
      const v = next.search.trim();
      if (v) params.set("search", v);
      else params.delete("search");
    }
    if (next.severity !== undefined) {
      if (next.severity) params.set("severity", next.severity);
      else params.delete("severity");
    }
    if (next.page !== undefined) params.set("page", String(next.page));
    if (next.page_size !== undefined) params.set("page_size", String(next.page_size));
    router.push(`${pathname}?${params.toString()}` as unknown as Parameters<typeof router.push>[0]);
  }

  function applyFilters(q: string, sev: IncidentSeverity | "") {
    setSearch(q);
    setSeverityFilter(sev);
    pushQuery({ search: q, severity: sev, page: 1 });
  }

  const createSchema = z.object({
    title: z.string().min(1).max(180),
    description: z.string().max(2000).optional().or(z.literal("")),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).default("OPEN")
  });
  type CreateForm = z.infer<typeof createSchema>;

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { severity: "MEDIUM", status: "OPEN", title: "", description: "" }
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  async function exportCsv() {
    const params = new URLSearchParams();
    if (propertyId) params.set("property_id", propertyId);
    if (effective.q) params.set("search", effective.q);
    if (effective.sev) params.set("severity", effective.sev);
    const url = `/api/operations/incidents/export.csv?${params.toString()}`;
    window.location.assign(url);
  }

  async function submit(values: CreateForm) {
    if (!propertyId) {
      form.setError("title", { message: t("selectPropertyFirst") });
      return;
    }
    setLoading(true);
    try {
      await apiFetch<IncidentRead>("/api/operations/incidents", {
        method: "POST",
        body: JSON.stringify({
          property_id: propertyId,
          severity: values.severity,
          status: values.status,
          title: values.title,
          description: values.description ? values.description : null,
          assigned_to: null
        })
      });
      setOpen(false);
      form.reset({ severity: "MEDIUM", status: "OPEN", title: "", description: "" });
      notify({
        title: t("toast.created.title"),
        description: t("toast.created.description"),
        tone: "success",
        "data-testid": "incidents-toast-created"
      });
      await load(effective.q, effective.sev, effective.p, effective.ps);
    } catch (e) {
      notify({
        title: t("toast.failed.title"),
        description: t("toast.failed.description"),
        tone: "error",
        "data-testid": "incidents-toast-failed"
      });
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function runTriage(incident: IncidentRead) {
    setTriageIncident(incident);
    setTriage(null);
    setTriageOpen(true);
    setTriageLoading(true);
    try {
      const resp = await apiFetch<IncidentTriageResponse>(`/api/operations/incidents/${incident.id}/triage`, {
        method: "POST"
      });
      setTriage(resp);
    } catch {
      notify({ title: t("toast.triageFailed.title"), description: t("toast.triageFailed.description"), tone: "error" });
    } finally {
      setTriageLoading(false);
    }
  }

  async function acceptTriage() {
    if (!triageIncident) return;
    const assigneeId = triage?.suggested_assignee_id ?? user?.id ?? null;
    if (!assigneeId) {
      notify({ title: t("toast.assignFailed.title"), description: t("toast.assignFailed.description"), tone: "error" });
      return;
    }
    setTriageLoading(true);
    try {
      await apiFetch<IncidentRead>(`/api/operations/incidents/${triageIncident.id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_to: assigneeId })
      });
      setTriageOpen(false);
      setTriageIncident(null);
      setTriage(null);
      notify({ title: t("toast.assigned.title"), description: t("toast.assigned.description"), tone: "success" });
      await load(effective.q, effective.sev, effective.p, effective.ps);
    } catch {
      notify({ title: t("toast.assignFailed.title"), description: t("toast.assignFailed.description"), tone: "error" });
    } finally {
      setTriageLoading(false);
    }
  }

  return (
    <div className="grid gap-4" data-testid="incidents-page">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" type="button" onClick={() => void exportCsv()} data-testid="incidents-export">
            {t("exportCsv")}
          </Button>
          <Button type="button" onClick={() => setOpen(true)} data-testid="incidents-new">
            {t("newIncident")}
          </Button>
        </div>
      </div>

      <Card
        title={t("directory")}
        action={
          <form
            action={(formData) => {
              const q = String(formData.get("search") ?? "");
              const sev = String(formData.get("severity") ?? "") as IncidentSeverity | "";
              applyFilters(q, sev);
            }}
            className="flex flex-wrap gap-2"
            data-testid="incidents-filters"
          >
            <input
              name="search"
              defaultValue={search}
              data-testid="incidents-search"
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              placeholder={t("search")}
            />
            <select
              name="severity"
              data-testid="incidents-severity-filter"
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              value={severityFilter}
              aria-label={t("severityFilter")}
              onChange={(event) => applyFilters(search, event.target.value as IncidentSeverity | "")}
            >
              <option value="">{t("allSeverities")}</option>
              {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] satisfies IncidentSeverity[]).map((sev) => (
                <option key={sev} value={sev}>{sev}</option>
              ))}
            </select>
            <Button type="submit" variant="ghost" data-testid="incidents-apply-filters">
              {t("filter")}
            </Button>
          </form>
        }
      >
        <Table headers={[t("createdAt"), t("titleCol"), t("severity"), t("status"), t("slaTimer"), t("propertyId"), t("actions")]}>
          {items.map((it) => (
            <tr key={it.id} className="hover:bg-white/[0.02]">
              <Td className="whitespace-nowrap">{fmtDate(it.created_at)}</Td>
              <Td>
                <div className="font-medium text-cortai-text">{it.title}</div>
                {it.description ? <div className="mt-0.5 text-[11px] text-cortai-text2 line-clamp-2">{it.description}</div> : null}
              </Td>
              <Td className="whitespace-nowrap">
                <Badge tone={severityTone(it.severity)}>{it.severity}</Badge>
              </Td>
              <Td className="whitespace-nowrap">
                <Badge tone={statusTone(it.status)}>{it.status}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-[11px] text-cortai-text2">
                {fmtSla(it.sla_due_at, nowMs, t)}
              </Td>
              <Td className="font-mono text-[11px] text-cortai-text2">{it.property_id}</Td>
              <Td>
                <Button type="button" variant="ghost" onClick={() => void runTriage(it)} disabled={loading || triageLoading}>
                  {t("aiTriage")}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>

        <div className="flex flex-wrap items-center gap-3 border-t border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs text-cortai-text2">
          <div className="flex items-center gap-2">
            <span>{t("rowsPerPage")}</span>
            <select
              data-testid="incidents-page-size"
              className="rounded-md border border-cortai-border bg-cortai-bg px-2 py-1 text-xs text-cortai-text outline-none focus:border-cortai-teal"
              value={pageSize}
              onChange={(event) => {
                const next = clampInt(event.target.value, 20, 1, 100);
                pushQuery({ page_size: next, page: 1 });
              }}
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span data-testid="incidents-pagination-label">
              {t("page")} {page} {t("of")} {totalPages}
            </span>
            <Button type="button" variant="ghost" data-testid="incidents-prev" disabled={!canPrev} onClick={() => pushQuery({ page: page - 1 })}>
              {t("previous")}
            </Button>
            <Button type="button" variant="ghost" data-testid="incidents-next" disabled={!canNext} onClick={() => pushQuery({ page: page + 1 })}>
              {t("next")}
            </Button>
          </div>
        </div>
      </Card>

      <Modal open={open} title={t("newIncident")} closeLabel={t("close")} onClose={() => setOpen(false)}>
        <form onSubmit={form.handleSubmit(submit)} className="grid gap-3">
          <Input
            label={t("titleCol")}
            data-testid="incident-form-title"
            {...form.register("title")}
            error={form.formState.errors.title?.message}
          />
          <label className="grid gap-1.5 text-xs text-cortai-text2">
            <span>{t("severity")}</span>
            <select
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-cortai-text"
              {...form.register("severity")}
            >
              {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] satisfies IncidentSeverity[]).map((sev) => (
                <option key={sev} value={sev}>{sev}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs text-cortai-text2">
            <span>{t("status")}</span>
            <select
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-cortai-text"
              {...form.register("status")}
            >
              {(["OPEN", "IN_PROGRESS", "RESOLVED"] satisfies IncidentStatus[]).map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs text-cortai-text2">
            <span>{t("description")}</span>
            <textarea
              className="min-h-[90px] rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs text-cortai-text outline-none focus:border-cortai-teal"
              {...form.register("description")}
            />
          </label>
          <Button type="submit" disabled={loading} data-testid="incident-form-submit">
            {loading ? t("saving") : t("create")}
          </Button>
        </form>
      </Modal>

      <Modal open={triageOpen} title={t("triage.title")} closeLabel={t("close")} onClose={() => setTriageOpen(false)}>
        <div className="grid gap-3">
          {triageIncident ? (
            <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-3">
              <div className="text-xs font-semibold text-cortai-text">{triageIncident.title}</div>
              <div className="mt-1 text-[11px] text-cortai-text2">{triageIncident.description ?? t("triage.noDescription")}</div>
            </div>
          ) : null}

          {triageLoading && !triage ? <p className="text-xs text-cortai-text2">{t("triage.loading")}</p> : null}

          {triage ? (
            <div className="grid gap-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-2">
                  <div className="text-cortai-text3">{t("triage.priority")}</div>
                  <div className="mt-1 font-semibold text-cortai-text">{triage.suggested_priority}</div>
                </div>
                <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-2">
                  <div className="text-cortai-text3">{t("triage.category")}</div>
                  <div className="mt-1 font-semibold text-cortai-text">{triage.suggested_category}</div>
                </div>
              </div>
              <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-2">
                <div className="text-cortai-text3">{t("triage.assignee")}</div>
                <div className="mt-1 font-mono text-[11px] text-cortai-text">
                  {triage.suggested_assignee_id ?? user?.id ?? t("triage.noAssignee")}
                </div>
              </div>
              <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-2">
                <div className="text-cortai-text3">{t("triage.reasoning")}</div>
                <div className="mt-1 whitespace-pre-wrap text-cortai-text2">{triage.reasoning_md}</div>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => setTriageOpen(false)} disabled={triageLoading}>
              {t("triage.cancel")}
            </Button>
            <Button type="button" onClick={() => void acceptTriage()} disabled={!triage || triageLoading}>
              {t("triage.accept")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

