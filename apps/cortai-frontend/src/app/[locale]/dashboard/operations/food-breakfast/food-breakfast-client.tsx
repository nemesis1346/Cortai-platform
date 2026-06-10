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

type BreakfastStatus = {
  property_id: string;
  room: string;
  count: number;
  capacity: number;
  status: string;
  last_updated: string | null;
};

type RestaurantTable = {
  table_id: string;
  zone: string | null;
  seats: number | null;
  occupied: boolean;
  party_size: number | null;
  last_updated: string | null;
};

type MenuService = "breakfast" | "restaurant" | "room_service";
type MenuItem = {
  id: string;
  org_id: string;
  service: MenuService;
  name_en: string;
  name_fr: string | null;
  price_cents: number;
  allergens: string[];
  available: boolean;
  created_at: string;
  updated_at: string;
};
type MenuList = { items: MenuItem[]; total: number; page: number; page_size: number };

type RoomServiceStatus = "received" | "preparing" | "en_route" | "delivered" | "cancelled";
type RoomServiceOrder = {
  id: string;
  org_id: string;
  room_id: string;
  guest_id: string | null;
  items_json: unknown;
  status: RoomServiceStatus;
  created_at: string;
  updated_at: string;
};
type RoomServiceList = { items: RoomServiceOrder[] };

function centsToDollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function parseAllergens(s: string) {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function safeJsonPreview(value: unknown) {
  try {
    const s = JSON.stringify(value);
    return s.length > 120 ? `${s.slice(0, 117)}...` : s;
  } catch {
    return String(value);
  }
}

function statusTone(st: RoomServiceStatus) {
  if (st === "delivered") return "green";
  if (st === "preparing" || st === "en_route") return "blue";
  if (st === "cancelled") return "red";
  return "amber";
}

export function FoodBreakfastClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.foodBreakfast");
  const tc = useTranslations("operations.common");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [breakfast, setBreakfast] = useState<BreakfastStatus | null>(null);
  const [tables, setTables] = useState<RestaurantTable[]>([]);

  const [menu, setMenu] = useState<MenuList | null>(null);
  const [menuServiceFilter, setMenuServiceFilter] = useState<MenuService | "">("");
  const [menuAvailableFilter, setMenuAvailableFilter] = useState<"" | "true" | "false">("");

  const [orders, setOrders] = useState<RoomServiceOrder[]>([]);
  const [orderStatusFilter, setOrderStatusFilter] = useState<RoomServiceStatus | "">("");

  const menuPage = 1;
  const menuPageSize = 50;

  const loadAll = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const menuParams = new URLSearchParams();
      menuParams.set("page", String(menuPage));
      menuParams.set("page_size", String(menuPageSize));
      if (menuServiceFilter) menuParams.set("service", menuServiceFilter);
      if (menuAvailableFilter) menuParams.set("available", menuAvailableFilter);

      const orderParams = new URLSearchParams();
      orderParams.set("property_id", propertyId);
      orderParams.set("limit", "200");
      if (orderStatusFilter) orderParams.set("status", orderStatusFilter);

      const [b, tt, ml, rs] = await Promise.all([
        apiFetch<BreakfastStatus>(`/api/operations/fb/breakfast/status?property_id=${pid}`),
        apiFetch<RestaurantTable[]>(`/api/operations/fb/restaurant/tables?property_id=${pid}`),
        apiFetch<MenuList>(`/api/operations/fb/menu?${menuParams.toString()}`),
        apiFetch<RoomServiceList>(`/api/operations/fb/room-service?${orderParams.toString()}`)
      ]);
      setBreakfast(b);
      setTables(tt);
      setMenu(ml);
      setOrders(rs.items);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [menuAvailableFilter, menuPage, menuPageSize, menuServiceFilter, orderStatusFilter, propertyId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Menu modal
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuEditing, setMenuEditing] = useState<MenuItem | null>(null);
  const menuSchema = useMemo(
    () =>
      z.object({
        service: z.enum(["breakfast", "restaurant", "room_service"]),
        name_en: z.string().min(1).max(180),
        name_fr: z.string().max(180).optional().or(z.literal("")),
        price_cents: z.coerce.number().int().min(0),
        allergens_csv: z.string().max(500).optional().or(z.literal("")),
        available: z.boolean()
      }),
    []
  );
  type MenuForm = z.infer<typeof menuSchema>;
  const menuForm = useForm<MenuForm>({
    resolver: zodResolver(menuSchema),
    defaultValues: {
      service: "breakfast",
      name_en: "",
      name_fr: "",
      price_cents: 0,
      allergens_csv: "",
      available: true
    }
  });

  function openNewMenu() {
    setMenuEditing(null);
    menuForm.reset({
      service: "breakfast",
      name_en: "",
      name_fr: "",
      price_cents: 0,
      allergens_csv: "",
      available: true
    });
    setMenuOpen(true);
  }

  function openEditMenu(item: MenuItem) {
    setMenuEditing(item);
    menuForm.reset({
      service: item.service,
      name_en: item.name_en,
      name_fr: item.name_fr ?? "",
      price_cents: item.price_cents,
      allergens_csv: (item.allergens ?? []).join(", "),
      available: item.available
    });
    setMenuOpen(true);
  }

  async function submitMenu(values: MenuForm) {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        service: values.service,
        name_en: values.name_en,
        name_fr: values.name_fr ? values.name_fr : null,
        price_cents: values.price_cents,
        allergens: parseAllergens(values.allergens_csv ?? ""),
        available: values.available
      };
      if (menuEditing) {
        await apiFetch<MenuItem>(`/api/operations/fb/menu/${encodeURIComponent(menuEditing.id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        notify({ title: t("toast.menuUpdated.title"), description: t("toast.menuUpdated.description"), tone: "success" });
      } else {
        await apiFetch<MenuItem>("/api/operations/fb/menu", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        notify({ title: t("toast.menuCreated.title"), description: t("toast.menuCreated.description"), tone: "success" });
      }
      setMenuOpen(false);
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  // Room service modal
  const [orderOpen, setOrderOpen] = useState(false);
  const orderSchema = useMemo(
    () =>
      z.object({
        room_id: z.string().uuid(),
        items_json: z.string().min(2)
      }),
    []
  );
  type OrderForm = z.infer<typeof orderSchema>;
  const orderForm = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: { room_id: "", items_json: JSON.stringify({ items: [] }, null, 2) }
  });

  async function submitOrder(values: OrderForm) {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(values.items_json);
      } catch {
        notify({ title: t("toast.invalidJson.title"), description: t("toast.invalidJson.description"), tone: "error" });
        return;
      }
      await apiFetch<RoomServiceOrder>("/api/operations/fb/room-service", {
        method: "POST",
        body: JSON.stringify({ property_id: propertyId, room_id: values.room_id, items_json: parsed })
      });
      notify({ title: t("toast.orderCreated.title"), description: t("toast.orderCreated.description"), tone: "success" });
      setOrderOpen(false);
      orderForm.reset({ room_id: "", items_json: JSON.stringify({ items: [] }, null, 2) });
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<RoomServiceOrder | null>(null);

  async function patchOrder(id: string, payload: unknown) {
    setLoading(true);
    setError(null);
    try {
      await apiFetch<RoomServiceOrder>(`/api/operations/fb/room-service/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      await loadAll();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  const occupancySummary = useMemo(() => {
    const occupied = tables.filter((x) => x.occupied).length;
    const total = tables.length;
    return { occupied, total };
  }, [tables]);

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-xs text-cortai-text2">{t("selectProperty")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="food-breakfast-page">
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
        <Card title={t("breakfastStatus.title")}>
          {!breakfast ? (
            <p className="text-xs text-cortai-text3">{loading ? t("loading") : t("empty")}</p>
          ) : (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{t("breakfastStatus.count", { count: breakfast.count })}</Badge>
                <Badge tone="blue">{t("breakfastStatus.capacity", { capacity: breakfast.capacity })}</Badge>
                <Badge tone={breakfast.status === "busy" ? "red" : breakfast.status === "moderate" ? "amber" : "green"}>
                  {t(`breakfastStatus.level.${breakfast.status}`)}
                </Badge>
                <span className="ml-auto text-[11px] text-cortai-text3">
                  {fmtTs(breakfast.last_updated, tc("dash"))}
                </span>
              </div>
            </div>
          )}
        </Card>

        <Card
          title={t("tables.title")}
          action={
            <Badge tone={occupancySummary.occupied > 0 ? "amber" : "neutral"}>
              {t("tables.summary", { occupied: occupancySummary.occupied, total: occupancySummary.total })}
            </Badge>
          }
        >
          {tables.length === 0 ? (
            <p className="text-xs text-cortai-text3">{loading ? t("loading") : t("tables.empty")}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {tables.map((tb) => (
                <div key={tb.table_id} className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-semibold text-cortai-text">{tb.table_id}</div>
                    <Badge tone={tb.occupied ? "red" : "green"}>
                      {tb.occupied ? t("tables.occupied") : t("tables.free")}
                    </Badge>
                    <span className="ml-auto text-[11px] text-cortai-text3">{fmtTs(tb.last_updated, tc("dash"))}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-cortai-text2">
                    {t("tables.meta", {
                      zone: tb.zone ?? tc("dash"),
                      seats: tb.seats ?? 0,
                      party: tb.party_size ?? 0
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title={t("menu.title")}
        action={
          <div className="flex flex-wrap items-center gap-2" data-testid="food-breakfast-menu-filters">
            <select
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              value={menuServiceFilter}
              onChange={(e) => setMenuServiceFilter(e.target.value as MenuService | "")}
            >
              <option value="">{t("menu.filters.allServices")}</option>
              <option value="breakfast">{t("menu.service.breakfast")}</option>
              <option value="restaurant">{t("menu.service.restaurant")}</option>
              <option value="room_service">{t("menu.service.roomService")}</option>
            </select>
            <select
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              value={menuAvailableFilter}
              onChange={(e) => setMenuAvailableFilter(e.target.value as "" | "true" | "false")}
            >
              <option value="">{t("menu.filters.allAvailability")}</option>
              <option value="true">{t("menu.filters.available")}</option>
              <option value="false">{t("menu.filters.unavailable")}</option>
            </select>
            <Button type="button" variant="ghost" onClick={() => void loadAll()}>
              {t("menu.filters.apply")}
            </Button>
            <Button type="button" onClick={openNewMenu} data-testid="food-breakfast-menu-new">
              {t("menu.new")}
            </Button>
          </div>
        }
      >
        <Table
          headers={[
            t("menu.cols.service"),
            t("menu.cols.name"),
            t("menu.cols.price"),
            t("menu.cols.allergens"),
            t("menu.cols.available"),
            t("menu.cols.updated"),
            t("menu.cols.actions")
          ]}
        >
          {(menu?.items ?? []).length === 0 ? (
            <tr>
              <Td className="text-cortai-text3" colSpan={7}>
                {loading ? t("loading") : t("menu.empty")}
              </Td>
            </tr>
          ) : null}
          {(menu?.items ?? []).map((it) => (
            <tr key={it.id} className="hover:bg-white/[0.02]">
              <Td className="text-cortai-text2">{t(`menu.service.${it.service}`)}</Td>
              <Td>
                <div className="font-semibold">{it.name_en}</div>
                {it.name_fr ? <div className="text-[11px] text-cortai-text3">{it.name_fr}</div> : null}
              </Td>
              <Td className="text-cortai-text2">${centsToDollars(it.price_cents)}</Td>
              <Td className="text-cortai-text2">{(it.allergens ?? []).join(", ") || tc("dash")}</Td>
              <Td>
                <Badge tone={it.available ? "green" : "neutral"}>{it.available ? t("menu.yes") : t("menu.no")}</Badge>
              </Td>
              <Td className="text-cortai-text3">{fmtTs(it.updated_at, tc("dash"))}</Td>
              <Td>
                <Button type="button" variant="ghost" onClick={() => openEditMenu(it)} data-testid="food-breakfast-menu-edit">
                  {t("menu.edit")}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card
        title={t("roomService.title")}
        action={
          <div className="flex flex-wrap items-center gap-2" data-testid="food-breakfast-room-service-actions">
            <select
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-1.5 text-xs outline-none focus:border-cortai-teal"
              value={orderStatusFilter}
              onChange={(e) => setOrderStatusFilter(e.target.value as RoomServiceStatus | "")}
            >
              <option value="">{t("roomService.filters.allStatuses")}</option>
              {(["received", "preparing", "en_route", "delivered", "cancelled"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`roomService.status.${s}`)}
                </option>
              ))}
            </select>
            <Button type="button" variant="ghost" onClick={() => void loadAll()}>
              {t("roomService.filters.apply")}
            </Button>
            <Button type="button" onClick={() => setOrderOpen(true)} data-testid="food-breakfast-room-service-new">
              {t("roomService.new")}
            </Button>
          </div>
        }
      >
        <Table headers={[t("roomService.cols.room"), t("roomService.cols.status"), t("roomService.cols.items"), t("roomService.cols.updated"), t("roomService.cols.actions")]}>
          {orders.length === 0 ? (
            <tr>
              <Td className="text-cortai-text3" colSpan={5}>
                {loading ? t("loading") : t("roomService.empty")}
              </Td>
            </tr>
          ) : null}
          {orders.map((o) => (
            <tr key={o.id} className="hover:bg-white/[0.02]">
              <Td className="text-cortai-text2">{o.room_id.slice(0, 8)}</Td>
              <Td>
                <Badge tone={statusTone(o.status)}>{t(`roomService.status.${o.status}`)}</Badge>
              </Td>
              <Td className="text-cortai-text2">{safeJsonPreview(o.items_json)}</Td>
              <Td className="text-cortai-text3">{fmtTs(o.updated_at, tc("dash"))}</Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSelected(o);
                      setDetailOpen(true);
                    }}
                    data-testid="food-breakfast-room-service-detail"
                  >
                    {t("roomService.detail")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void patchOrder(o.id, { status: "preparing" })}>
                    {t("roomService.actions.preparing")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void patchOrder(o.id, { status: "en_route" })}>
                    {t("roomService.actions.enRoute")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void patchOrder(o.id, { status: "delivered" })}>
                    {t("roomService.actions.delivered")}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal
        open={menuOpen}
        title={menuEditing ? t("menu.modal.editTitle") : t("menu.modal.newTitle")}
        closeLabel={t("close")}
        onClose={() => setMenuOpen(false)}
      >
        <form onSubmit={menuForm.handleSubmit((v) => void submitMenu(v))} className="grid gap-3" data-testid="food-breakfast-menu-modal">
          <label className="grid gap-1.5 text-xs text-cortai-text2">
            <span className="font-medium">{t("menu.modal.service")}</span>
            <select
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none transition focus:border-cortai-teal"
              {...menuForm.register("service")}
            >
              <option value="breakfast">{t("menu.service.breakfast")}</option>
              <option value="restaurant">{t("menu.service.restaurant")}</option>
              <option value="room_service">{t("menu.service.roomService")}</option>
            </select>
          </label>
          <Input label={t("menu.modal.nameEn")} error={menuForm.formState.errors.name_en?.message} {...menuForm.register("name_en")} />
          <Input label={t("menu.modal.nameFr")} error={menuForm.formState.errors.name_fr?.message} {...menuForm.register("name_fr")} />
          <Input
            label={t("menu.modal.priceCents")}
            error={menuForm.formState.errors.price_cents?.message}
            type="number"
            {...menuForm.register("price_cents")}
          />
          <Input label={t("menu.modal.allergens")} error={menuForm.formState.errors.allergens_csv?.message} {...menuForm.register("allergens_csv")} />
          <label className="flex items-center gap-2 text-xs text-cortai-text2">
            <input type="checkbox" {...menuForm.register("available")} />
            <span>{t("menu.modal.available")}</span>
          </label>
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setMenuOpen(false)}>
              {t("close")}
            </Button>
            <Button type="submit" className="ml-auto" disabled={loading}>
              {t("save")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={orderOpen} title={t("roomService.modal.newTitle")} closeLabel={t("close")} onClose={() => setOrderOpen(false)}>
        <form onSubmit={orderForm.handleSubmit((v) => void submitOrder(v))} className="grid gap-3" data-testid="food-breakfast-room-service-modal">
          <Input label={t("roomService.modal.roomId")} error={orderForm.formState.errors.room_id?.message} {...orderForm.register("room_id")} />
          <label className="grid gap-1.5 text-xs text-cortai-text2">
            <span className="font-medium">{t("roomService.modal.itemsJson")}</span>
            <textarea
              className="min-h-[140px] rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-xs text-cortai-text outline-none focus:border-cortai-teal"
              {...orderForm.register("items_json")}
            />
            {orderForm.formState.errors.items_json?.message ? (
              <span className="text-[11px] text-cortai-red">{orderForm.formState.errors.items_json.message}</span>
            ) : null}
          </label>
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOrderOpen(false)}>
              {t("close")}
            </Button>
            <Button type="submit" className="ml-auto" disabled={loading}>
              {t("roomService.modal.submit")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={detailOpen}
        title={t("roomService.detailTitle", { id: selected?.id?.slice(0, 8) ?? "" })}
        closeLabel={t("close")}
        onClose={() => setDetailOpen(false)}
      >
        {!selected ? null : (
          <div className="grid gap-3" data-testid="food-breakfast-room-service-detail-modal">
            <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-3 text-xs text-cortai-text2">
              <div className="font-semibold text-cortai-text">
                {t("roomService.detailRoom", { room: selected.room_id.slice(0, 8) })}
              </div>
              <div>{t("roomService.detailStatus", { status: t(`roomService.status.${selected.status}`) })}</div>
              <div className="mt-2 font-mono text-[11px] text-cortai-text3">{safeJsonPreview(selected.items_json)}</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => void patchOrder(selected.id, { status: "received" })}>
                {t("roomService.actions.received")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => void patchOrder(selected.id, { status: "preparing" })}>
                {t("roomService.actions.preparing")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => void patchOrder(selected.id, { status: "en_route" })}>
                {t("roomService.actions.enRoute")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => void patchOrder(selected.id, { status: "delivered" })}>
                {t("roomService.actions.delivered")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => void patchOrder(selected.id, { status: "cancelled" })}>
                {t("roomService.actions.cancelled")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

