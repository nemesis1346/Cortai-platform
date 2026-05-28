"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, Td } from "@/components/ui/Table";
import { apiFetch } from "@/lib/api";

type AdminDevice = {
  id: string;
  org_id: string;
  property_id: string | null;
  device_id: string;
  type: "edge_main" | "edge_distributed" | "sensor" | "gateway";
  capabilities: string[];
  cert_fingerprint: string | null;
  logical_bindings: Record<string, unknown>;
  last_seen_at: string | null;
  is_offline: boolean;
  offline_since: string | null;
  created_at: string;
  updated_at: string;
};

type DeviceList = {
  items: AdminDevice[];
  total: number;
  page: number;
  page_size: number;
};

type DeviceForm = {
  device_id: string;
  type: AdminDevice["type"];
  capabilities: string;
  property_id?: string;
  cert_fingerprint?: string;
  logical_bindings: string;
};

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function DevicesClient() {
  const t = useTranslations("devices");
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();

  const schema = z.object({
    device_id: z.string().min(1).max(128),
    type: z.enum(["edge_main", "edge_distributed", "sensor", "gateway"]),
    capabilities: z.string().optional().default(""),
    property_id: z.string().uuid().optional().or(z.literal("")),
    cert_fingerprint: z.string().max(128).optional().or(z.literal("")),
    logical_bindings: z.string().optional().default("{}")
  }).refine((value) => {
    try {
      JSON.parse(value.logical_bindings || "{}");
      return true;
    } catch {
      return false;
    }
  }, { path: ["logical_bindings"], message: t("logicalBindingsMustBeJson") });

  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminDevice | null>(null);
  const [loading, setLoading] = useState(false);

  const effective = useMemo(() => {
    const p = clampInt(searchParams.get("page"), 1, 1, 10_000);
    const ps = clampInt(searchParams.get("page_size"), 20, 1, 100);
    return { p, ps };
  }, [searchParams]);

  const form = useForm<DeviceForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: "edge_distributed",
      capabilities: "",
      logical_bindings: "{}",
      property_id: "",
      cert_fingerprint: ""
    }
  });

  const load = useCallback(async (nextPage: number, nextPageSize: number) => {
    const params = new URLSearchParams({
      page: String(nextPage),
      page_size: String(nextPageSize)
    });
    const response = await apiFetch<DeviceList>(`/api/admin/devices?${params.toString()}`);
    setDevices(response.items);
    setTotal(response.total);
    setPage(response.page);
    setPageSize(response.page_size);
  }, []);

  useEffect(() => {
    void load(effective.p, effective.ps);
  }, [effective, load]);

  function pushQuery(next: { page?: number; page_size?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.page !== undefined) params.set("page", String(next.page));
    if (next.page_size !== undefined) params.set("page_size", String(next.page_size));
    router.push(`${pathname}?${params.toString()}` as unknown as Parameters<typeof router.push>[0]);
  }

  function openCreate() {
    setEditing(null);
    form.reset({
      device_id: "",
      type: "edge_distributed",
      capabilities: "",
      property_id: "",
      cert_fingerprint: "",
      logical_bindings: "{}"
    });
    setOpen(true);
  }

  function openEdit(device: AdminDevice) {
    setEditing(device);
    form.reset({
      device_id: device.device_id,
      type: device.type,
      capabilities: (device.capabilities ?? []).join(", "),
      property_id: device.property_id ?? "",
      cert_fingerprint: device.cert_fingerprint ?? "",
      logical_bindings: JSON.stringify(device.logical_bindings ?? {}, null, 2)
    });
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setEditing(null);
  }

  async function submit(values: DeviceForm) {
    setLoading(true);
    try {
      const payload = {
        device_id: values.device_id,
        type: values.type,
        capabilities: parseCsv(values.capabilities || ""),
        property_id: values.property_id ? values.property_id : null,
        cert_fingerprint: values.cert_fingerprint ? values.cert_fingerprint : null,
        logical_bindings: JSON.parse(values.logical_bindings || "{}")
      };

      if (editing) {
        await apiFetch<AdminDevice>(`/api/admin/devices/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
      } else {
        await apiFetch<AdminDevice>("/api/admin/devices", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }
      close();
      await load(effective.p, effective.ps);
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    await apiFetch<void>(`/api/admin/devices/${id}`, { method: "DELETE" });
    await load(effective.p, effective.ps);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="grid gap-4" data-testid="devices-page">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <Button className="ml-auto" onClick={openCreate} data-testid="devices-create-open">
          {t("create")}
        </Button>
      </div>

      <Card title={t("registry")}>
        <Table headers={[t("status"), t("deviceId"), t("type"), t("lastSeen"), t("propertyId"), t("capabilities"), t("actions")]}>
          {devices.map((d) => (
            <tr key={d.id} className="hover:bg-white/[0.02]">
              <Td>
                <StatusBadge offline={Boolean(d.is_offline)} />
              </Td>
              <Td>{d.device_id}</Td>
              <Td>
                <Badge>{d.type}</Badge>
              </Td>
              <Td className="text-[11px] text-cortai-text2">
                {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "—"}
              </Td>
              <Td className="font-mono text-[11px]">{d.property_id ?? "—"}</Td>
              <Td className="text-[11px] text-cortai-text2">{(d.capabilities ?? []).join(", ") || "—"}</Td>
              <Td>
                <div className="flex gap-2">
                  <Button variant="ghost" type="button" onClick={() => openEdit(d)}>
                    {t("edit")}
                  </Button>
                  <Button variant="danger" type="button" onClick={() => void remove(d.id)}>
                    {t("delete")}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>

        <div className="flex flex-wrap items-center gap-3 border-t border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs text-cortai-text2">
          <div className="flex items-center gap-2">
            <span>{t("rowsPerPage")}</span>
            <select
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
            <span>
              {t("page")} {page} {t("of")} {totalPages}
            </span>
            <Button type="button" variant="ghost" disabled={!canPrev} onClick={() => pushQuery({ page: page - 1 })}>
              {t("previous")}
            </Button>
            <Button type="button" variant="ghost" disabled={!canNext} onClick={() => pushQuery({ page: page + 1 })}>
              {t("next")}
            </Button>
          </div>
        </div>
      </Card>

      <Modal
        open={open}
        title={editing ? t("editDevice") : t("createDevice")}
        closeLabel={t("close")}
        onClose={close}
      >
        <form onSubmit={form.handleSubmit(submit)} className="grid gap-3">
          <Input
            label={t("deviceId")}
            data-testid="device-form-device-id"
            {...form.register("device_id")}
            error={form.formState.errors.device_id?.message}
          />

          <label className="grid gap-1.5 text-xs text-cortai-text2">
            <span>{t("type")}</span>
            <select
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-cortai-text"
              {...form.register("type")}
            >
              {(["edge_main", "edge_distributed", "sensor", "gateway"] as const).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <Input
            label={t("propertyId")}
            placeholder={t("propertyIdPlaceholder")}
            data-testid="device-form-property-id"
            {...form.register("property_id")}
            error={form.formState.errors.property_id?.message}
          />

          <Input
            label={t("capabilities")}
            placeholder={t("capabilitiesPlaceholder")}
            data-testid="device-form-capabilities"
            {...form.register("capabilities")}
            error={form.formState.errors.capabilities?.message}
          />

          <Input
            label={t("certFingerprint")}
            placeholder={t("certFingerprintPlaceholder")}
            data-testid="device-form-cert-fingerprint"
            {...form.register("cert_fingerprint")}
            error={form.formState.errors.cert_fingerprint?.message}
          />

          <label className="grid gap-1.5 text-xs text-cortai-text2">
            <span>{t("logicalBindings")}</span>
            <textarea
              className="min-h-[120px] rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 font-mono text-[12px] text-cortai-text outline-none focus:border-cortai-teal"
              {...form.register("logical_bindings")}
            />
            {form.formState.errors.logical_bindings?.message ? (
              <span className="text-[11px] text-cortai-red">{String(form.formState.errors.logical_bindings.message)}</span>
            ) : null}
          </label>

          <Button type="submit" disabled={loading} data-testid="device-form-submit">
            {loading ? t("saving") : editing ? t("update") : t("save")}
          </Button>
        </form>
      </Modal>
    </div>
  );
}

function StatusBadge({ offline }: { offline: boolean }) {
  if (offline) {
    return (
      <Badge tone="red">OFFLINE</Badge>
    );
  }
  return (
    <Badge tone="green">ONLINE</Badge>
  );
}

