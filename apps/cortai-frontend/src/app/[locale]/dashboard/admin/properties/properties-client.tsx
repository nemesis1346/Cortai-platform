"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, Td } from "@/components/ui/Table";
import { apiFetch } from "@/lib/api";

type PropertyStatus = "ACTIVE" | "INACTIVE";

type AdminProperty = {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  marsha_property_id: string | null;
  address: string | null;
  room_count: number | null;
  status: PropertyStatus;
  created_at: string;
  updated_at: string;
};

type PropertyList = {
  items: AdminProperty[];
  total: number;
  page: number;
  page_size: number;
};

type PropertyForm = {
  name: string;
  marsha_property_id?: string;
  address?: string;
  room_count?: string;
  status: PropertyStatus;
};

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function PropertiesClient() {
  const t = useTranslations("properties");
  const navT = useTranslations("nav");
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user?.role === "IT_ADMIN" || user?.role === "SERVICE_PROVIDER_ADMIN";

  const schema = z.object({
    name: z.string().min(1).max(180),
    marsha_property_id: z.string().max(32).optional().or(z.literal("")),
    address: z.string().max(2000).optional().or(z.literal("")),
    room_count: z.string().optional().or(z.literal("")),
    status: z.enum(["ACTIVE", "INACTIVE"])
  }).refine((value) => {
    if (!value.room_count) return true;
    const n = Number(value.room_count);
    return Number.isFinite(n) && n >= 0 && n <= 100000 && Number.isInteger(n);
  }, { path: ["room_count"], message: t("roomCountMustBeInt") });

  const [properties, setProperties] = useState<AdminProperty[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProperty | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const effective = useMemo(() => {
    const q = searchParams.get("search") ?? "";
    const p = clampInt(searchParams.get("page"), 1, 1, 10_000);
    const ps = clampInt(searchParams.get("page_size"), 20, 1, 100);
    return { q, p, ps };
  }, [searchParams]);

  const form = useForm<PropertyForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", marsha_property_id: "", address: "", room_count: "", status: "ACTIVE" }
  });

  const load = useCallback(async (q: string, nextPage: number, nextPageSize: number) => {
    const params = new URLSearchParams({
      page: String(nextPage),
      page_size: String(nextPageSize)
    });
    if (q) params.set("search", q);
    const response = await apiFetch<PropertyList>(`/api/admin/properties?${params.toString()}`);
    setProperties(response.items);
    setTotal(response.total);
    setPage(response.page);
    setPageSize(response.page_size);
  }, []);

  useEffect(() => {
    setSearch(effective.q);
    if (isAdmin) void load(effective.q, effective.p, effective.ps);
  }, [effective, load, isAdmin]);

  function pushQuery(next: { search?: string; page?: number; page_size?: number }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.search !== undefined) {
      const v = next.search.trim();
      if (v) params.set("search", v);
      else params.delete("search");
    }
    if (next.page !== undefined) params.set("page", String(next.page));
    if (next.page_size !== undefined) params.set("page_size", String(next.page_size));
    router.push(`${pathname}?${params.toString()}` as unknown as Parameters<typeof router.push>[0]);
  }

  function openCreate() {
    setEditing(null);
    form.reset({ name: "", marsha_property_id: "", address: "", room_count: "", status: "ACTIVE" });
    setOpen(true);
  }

  function openEdit(p: AdminProperty) {
    setEditing(p);
    form.reset({
      name: p.name,
      marsha_property_id: p.marsha_property_id ?? "",
      address: p.address ?? "",
      room_count: p.room_count !== null && p.room_count !== undefined ? String(p.room_count) : "",
      status: p.status
    });
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setEditing(null);
  }

  async function submit(values: PropertyForm) {
    setLoading(true);
    try {
      const payload = {
        name: values.name,
        marsha_property_id: values.marsha_property_id ? values.marsha_property_id : null,
        address: values.address ? values.address : null,
        room_count: values.room_count ? Number(values.room_count) : null,
        status: values.status
      };
      if (editing) {
        await apiFetch<AdminProperty>(`/api/admin/properties/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
      } else {
        await apiFetch<AdminProperty>("/api/admin/properties", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }
      close();
      await load(effective.q, effective.p, effective.ps);
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    await apiFetch<void>(`/api/admin/properties/${id}`, { method: "DELETE" });
    await load(effective.q, effective.p, effective.ps);
  }

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4 text-xs text-cortai-text2">
        {navT("adminRestricted")}
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="grid gap-4" data-testid="properties-page">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <Button className="ml-auto" onClick={openCreate} data-testid="properties-create-open">
          {t("create")}
        </Button>
      </div>

      <Card
        title={t("registry")}
        action={
          <form
            action={(formData) => {
              const q = String(formData.get("search") ?? "");
              setSearch(q);
              pushQuery({ search: q, page: 1 });
            }}
            className="flex gap-2"
          >
            <input
              name="search"
              defaultValue={search}
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              placeholder={t("search")}
            />
            <Button type="submit" variant="ghost">
              {t("filter")}
            </Button>
          </form>
        }
      >
        <Table headers={[t("name"), t("slug"), t("status"), t("marsha"), t("roomCount"), t("actions")]}>
          {properties.map((p) => (
            <tr key={p.id} className="hover:bg-white/[0.02]">
              <Td>{p.name}</Td>
              <Td className="font-mono text-[11px] text-cortai-text2">{p.slug}</Td>
              <Td>
                <StatusBadge status={p.status} />
              </Td>
              <Td className="text-[11px] text-cortai-text2">{p.marsha_property_id ?? "—"}</Td>
              <Td className="text-[11px] text-cortai-text2">{p.room_count ?? "—"}</Td>
              <Td>
                <div className="flex gap-2">
                  <Button variant="ghost" type="button" onClick={() => openEdit(p)}>
                    {t("edit")}
                  </Button>
                  <Button variant="danger" type="button" onClick={() => void remove(p.id)}>
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

      <Modal open={open} title={editing ? t("editProperty") : t("createProperty")} closeLabel={t("close")} onClose={close}>
        <form onSubmit={form.handleSubmit(submit)} className="grid gap-3">
          <Input label={t("name")} data-testid="property-form-name" {...form.register("name")} error={form.formState.errors.name?.message} />
          <Input label={t("marsha")} data-testid="property-form-marsha" {...form.register("marsha_property_id")} error={form.formState.errors.marsha_property_id?.message} />
          <Input label={t("address")} data-testid="property-form-address" {...form.register("address")} error={form.formState.errors.address?.message} />
          <Input label={t("roomCount")} data-testid="property-form-room-count" {...form.register("room_count")} error={form.formState.errors.room_count?.message} />
          <label className="grid gap-1.5 text-xs text-cortai-text2">
            <span>{t("status")}</span>
            <select className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-cortai-text" {...form.register("status")}>
              {(["ACTIVE", "INACTIVE"] satisfies PropertyStatus[]).map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={loading} data-testid="property-form-submit">
            {loading ? t("saving") : editing ? t("update") : t("save")}
          </Button>
        </form>
      </Modal>
    </div>
  );
}

function StatusBadge({ status }: { status: PropertyStatus }) {
  if (status === "ACTIVE") {
    return (
      <span className="rounded-pill border border-cortai-green/25 bg-cortai-green/10 px-2 py-0.5 text-[10px] font-semibold text-cortai-green">
        ACTIVE
      </span>
    );
  }
  return (
    <span className="rounded-pill border border-cortai-amber/25 bg-cortai-amber/10 px-2 py-0.5 text-[10px] font-semibold text-cortai-amber">
      INACTIVE
    </span>
  );
}

