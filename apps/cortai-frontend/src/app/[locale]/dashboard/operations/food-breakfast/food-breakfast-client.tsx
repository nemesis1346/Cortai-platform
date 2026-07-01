"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

// ── Types ─────────────────────────────────────────────────────────────────────

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

type TabKey = "today" | "menu" | "roomservice";

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

function centsToDollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function parseAllergens(s: string) {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function fmtTs(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fmtTsLong(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function summarizeOrder(items_json: unknown): string {
  try {
    if (typeof items_json === "object" && items_json !== null) {
      const obj = items_json as Record<string, unknown>;
      if (Array.isArray(obj.items)) return `${obj.items.length} item(s)`;
      const keys = Object.keys(obj);
      if (keys.length > 0) return `${keys.length} field(s)`;
    }
    const s = JSON.stringify(items_json);
    return s.length > 40 ? `${s.slice(0, 38)}…` : s;
  } catch {
    return "—";
  }
}

const RS_STATUS_CFG: Record<RoomServiceStatus, { label: string; col: string; bg: string }> = {
  received:  { label: "Received",  col: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  preparing: { label: "Preparing", col: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  en_route:  { label: "En Route",  col: "#8b5cf6", bg: "rgba(139,92,246,.12)" },
  delivered: { label: "Delivered", col: "#10b981", bg: "rgba(16,185,129,.12)" },
  cancelled: { label: "Cancelled", col: "#94a3b8", bg: "rgba(148,163,184,.10)" },
};

const MENU_SERVICE_CFG: Record<MenuService, { label: string; col: string; bg: string }> = {
  breakfast:    { label: "Breakfast",    col: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  restaurant:   { label: "Restaurant",  col: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  room_service: { label: "Room Service", col: "#8b5cf6", bg: "rgba(139,92,246,.12)" },
};

const DEMO_BEVERAGES = [
  { label: "Tea / Coffee", count: 142, pct: 80 },
  { label: "Orange Juice", count: 68,  pct: 44 },
  { label: "Water / Other", count: 42, pct: 28 },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function FoodBreakfastClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.foodBreakfast");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [breakfast, setBreakfast] = useState<BreakfastStatus | null>(null);
  const [tables, setTables]       = useState<RestaurantTable[]>([]);
  const [menu, setMenu]           = useState<MenuList | null>(null);
  const [orders, setOrders]       = useState<RoomServiceOrder[]>([]);

  const [menuServiceFilter, setMenuServiceFilter]   = useState<MenuService | "">("");
  const [menuAvailableFilter, setMenuAvailableFilter] = useState<"" | "true" | "false">("");
  const [orderStatusFilter, setOrderStatusFilter]   = useState<RoomServiceStatus | "">("");

  const loadAll = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const menuParams = new URLSearchParams({ page: "1", page_size: "50" });
      if (menuServiceFilter)   menuParams.set("service", menuServiceFilter);
      if (menuAvailableFilter) menuParams.set("available", menuAvailableFilter);
      const orderParams = new URLSearchParams({ property_id: propertyId, limit: "200" });
      if (orderStatusFilter) orderParams.set("status", orderStatusFilter);

      const [b, tt, ml, rs] = await Promise.all([
        apiFetch<BreakfastStatus>(`/api/operations/fb/breakfast/status?property_id=${pid}`),
        apiFetch<RestaurantTable[]>(`/api/operations/fb/restaurant/tables?property_id=${pid}`),
        apiFetch<MenuList>(`/api/operations/fb/menu?${menuParams.toString()}`),
        apiFetch<RoomServiceList>(`/api/operations/fb/room-service?${orderParams.toString()}`),
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
  }, [menuAvailableFilter, menuServiceFilter, orderStatusFilter, propertyId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const occupiedTables  = useMemo(() => tables.filter((x) => x.occupied), [tables]);
  const activeOrders    = useMemo(
    () => orders.filter((o) => o.status !== "delivered" && o.status !== "cancelled"),
    [orders],
  );
  const breakfastPct = breakfast && breakfast.capacity > 0
    ? Math.round((breakfast.count / breakfast.capacity) * 100)
    : 0;

  // ── Menu form ─────────────────────────────────────────────────────────────
  const [menuOpen, setMenuOpen]       = useState(false);
  const [menuEditing, setMenuEditing] = useState<MenuItem | null>(null);
  const menuSchema = useMemo(
    () =>
      z.object({
        service:       z.enum(["breakfast", "restaurant", "room_service"]),
        name_en:       z.string().min(1).max(180),
        name_fr:       z.string().max(180).optional().or(z.literal("")),
        price_cents:   z.coerce.number().int().min(0),
        allergens_csv: z.string().max(500).optional().or(z.literal("")),
        available:     z.boolean(),
      }),
    [],
  );
  type MenuForm = z.infer<typeof menuSchema>;
  const menuForm = useForm<MenuForm>({
    resolver: zodResolver(menuSchema),
    defaultValues: { service: "breakfast", name_en: "", name_fr: "", price_cents: 0, allergens_csv: "", available: true },
  });

  function openNewMenu() {
    setMenuEditing(null);
    menuForm.reset({ service: "breakfast", name_en: "", name_fr: "", price_cents: 0, allergens_csv: "", available: true });
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
      available: item.available,
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
        available: values.available,
      };
      if (menuEditing) {
        await apiFetch<MenuItem>(`/api/operations/fb/menu/${encodeURIComponent(menuEditing.id)}`, { method: "PATCH", body: JSON.stringify(payload) });
        notify({ title: t("toast.menuUpdated.title"), description: t("toast.menuUpdated.description"), tone: "success" });
      } else {
        await apiFetch<MenuItem>("/api/operations/fb/menu", { method: "POST", body: JSON.stringify(payload) });
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

  // ── Room-service form ─────────────────────────────────────────────────────
  const [orderOpen, setOrderOpen] = useState(false);
  const orderSchema = useMemo(
    () => z.object({ room_id: z.string().uuid(), items_json: z.string().min(2) }),
    [],
  );
  type OrderForm = z.infer<typeof orderSchema>;
  const orderForm = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: { room_id: "", items_json: JSON.stringify({ items: [] }, null, 2) },
  });

  async function submitOrder(values: OrderForm) {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      let parsed: unknown = null;
      try { parsed = JSON.parse(values.items_json); } catch {
        notify({ title: t("toast.invalidJson.title"), description: t("toast.invalidJson.description"), tone: "error" });
        return;
      }
      await apiFetch<RoomServiceOrder>("/api/operations/fb/room-service", {
        method: "POST",
        body: JSON.stringify({ property_id: propertyId, room_id: values.room_id, items_json: parsed }),
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

  const [detailOpen, setDetailOpen]   = useState(false);
  const [selected, setSelected]       = useState<RoomServiceOrder | null>(null);

  async function patchOrder(id: string, payload: unknown) {
    setLoading(true);
    setError(null);
    try {
      await apiFetch<RoomServiceOrder>(`/api/operations/fb/room-service/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
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

  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const breakfastStatusColor = breakfast?.status === "busy" ? "#ef4444"
    : breakfast?.status === "moderate" ? "#f59e0b" : "#10b981";

  return (
    <div className="grid gap-4" data-testid="food-breakfast-page">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-cortai-text">{t("title")}</h1>
          <p className="text-[11px] text-cortai-text3">{todayLabel} · {t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => void loadAll()} disabled={loading}>
            {t("refresh")}
          </Button>
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-cortai-red">{error}</div>
      ) : null}

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-1 rounded-xl border border-cortai-border p-1"
        style={{ background: "rgba(255,255,255,.02)" }}
      >
        {(
          [
            { key: "today" as TabKey, icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>, label: "Today", count: breakfast ? `${breakfast.count} served` : undefined },
            { key: "menu" as TabKey, icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>, label: "Menu", count: menu ? `${menu.total} items` : undefined },
            { key: "roomservice" as TabKey, icon: <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" strokeWidth="1.8"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>, label: "Room Service", count: activeOrders.length > 0 ? `${activeOrders.length} active` : undefined },
          ] as { key: TabKey; icon: React.ReactNode; label: string; count?: string }[]
        ).map(({ key, icon, label, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold transition"
            style={{
              background: activeTab === key ? "rgba(0,196,163,.12)" : "transparent",
              color: activeTab === key ? "#00c4a3" : "#4d7088",
              border: activeTab === key ? "1px solid rgba(0,196,163,.25)" : "1px solid transparent",
            }}
          >
            {icon}
            {label}
            {count ? (
              <span
                className="rounded-full px-1.5 py-0.5 font-mono text-[9px]"
                style={{
                  background: activeTab === key ? "rgba(0,196,163,.18)" : "rgba(255,255,255,.05)",
                  color: activeTab === key ? "#00c4a3" : "#4d7088",
                }}
              >
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
          {/* KPI strip */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Guests Served",     v: breakfast?.count ?? "—",                                               sub: breakfast?.room ?? "breakfast room",   c: "#00c4a3" },
              { label: "Dining Capacity",   v: breakfast ? `${breakfast.count} / ${breakfast.capacity}` : "—",        sub: breakfast?.status ?? "—",              c: breakfastStatusColor },
              { label: "Tables Occupied",   v: tables.length > 0 ? `${occupiedTables.length} / ${tables.length}` : "—", sub: `${tables.length - occupiedTables.length} free`,  c: occupiedTables.length > 0 ? "#f59e0b" : "#10b981" },
              { label: "Active RS Orders",  v: activeOrders.length,                                                   sub: `${orders.filter((o) => o.status === "en_route").length} en route`, c: activeOrders.length > 0 ? "#8b5cf6" : "#94a3b8" },
            ].map(({ label, v, sub, c }) => (
              <div
                key={label}
                className="rounded-xl border border-cortai-border px-4 py-3"
                style={{ background: "rgba(255,255,255,.02)" }}
              >
                <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-cortai-text3">{label}</div>
                <div className="mt-1 font-mono text-[24px] font-bold leading-none" style={{ color: c }}>{v}</div>
                <div className="mt-1 text-[9px] text-cortai-text3">{sub}</div>
              </div>
            ))}
          </div>

          {/* Main 2-col grid */}
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 300px" }}>

            {/* Left column */}
            <div className="flex flex-col gap-3">

              {/* Breakfast Status */}
              <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
                <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                    <path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/>
                    <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
                  </svg>
                  <span className="text-[13px] font-semibold text-cortai-text">{t("breakfastStatus.title")}</span>
                  {breakfast ? (
                    <span
                      className="rounded px-2 py-0.5 font-mono text-[9px] font-bold"
                      style={{ background: `${breakfastStatusColor}1a`, color: breakfastStatusColor }}
                    >
                      {breakfast.status.toUpperCase()}
                    </span>
                  ) : null}
                  <span className="ml-auto text-[9px] text-cortai-text3">
                    {breakfast ? `Updated ${fmtTs(breakfast.last_updated)}` : loading ? t("loading") : t("empty")}
                  </span>
                </div>
                {breakfast ? (
                  <div className="p-4">
                    <div className="mb-3 flex items-end justify-between">
                      <div>
                        <span className="font-mono text-[36px] font-bold leading-none" style={{ color: "#00c4a3" }}>{breakfast.count}</span>
                        <span className="ml-2 text-[14px] text-cortai-text2">/ {breakfast.capacity} guests</span>
                      </div>
                      <div className="text-right text-[11px] text-cortai-text3">{breakfast.room}</div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.07)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${breakfastPct}%`, background: breakfastStatusColor }}
                      />
                    </div>
                    <div className="mt-1 text-[9px] text-cortai-text3">{breakfastPct}% capacity utilisation</div>
                  </div>
                ) : (
                  <EmptyState message={loading ? t("loading") : t("empty")} className="p-4" testId="breakfast-occupancy-empty" />
                )}
              </div>

              {/* Restaurant Tables */}
              <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
                <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                  </svg>
                  <span className="text-[13px] font-semibold text-cortai-text">{t("tables.title")}</span>
                  <span className="ml-auto text-[9px] text-cortai-text3">
                    {tables.length > 0 ? `${occupiedTables.length} / ${tables.length} occupied` : ""}
                  </span>
                </div>
                {tables.length === 0 ? (
                  <EmptyState message={loading ? t("loading") : t("tables.empty")} className="p-4" testId="tables-empty" />
                ) : (
                  <div className="grid p-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
                    {tables.map((tb) => (
                      <div
                        key={tb.table_id}
                        className="rounded-lg border px-2.5 py-2"
                        style={{
                          borderColor: tb.occupied ? "rgba(239,68,68,.3)" : "rgba(16,185,129,.2)",
                          background: tb.occupied ? "rgba(239,68,68,.05)" : "rgba(16,185,129,.04)",
                        }}
                      >
                        <div className="text-[11px] font-semibold text-cortai-text">{tb.table_id}</div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <div
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: tb.occupied ? "#ef4444" : "#10b981" }}
                          />
                          <span className="text-[9px]" style={{ color: tb.occupied ? "#ef4444" : "#10b981" }}>
                            {tb.occupied ? t("tables.occupied") : t("tables.free")}
                          </span>
                        </div>
                        {tb.zone ? (
                          <div className="mt-1 text-[9px] text-cortai-text3">{tb.zone}</div>
                        ) : null}
                        {tb.occupied && tb.party_size ? (
                          <div className="mt-0.5 font-mono text-[9px] text-cortai-text3">party {tb.party_size}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-3">

              {/* Beverages Today (demo) */}
              <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
                <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                    <path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/>
                  </svg>
                  <span className="text-[12px] font-semibold text-cortai-text">Beverages</span>
                  <span className="ml-auto text-[9px] text-cortai-text3">demo</span>
                </div>
                <div className="p-4">
                  {DEMO_BEVERAGES.map(({ label, count, pct }) => (
                    <div key={label} className="mb-3 last:mb-0">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[11px] text-cortai-text">{label}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[13px] font-bold text-cortai-text">{count}</span>
                          <span className="text-[10px] text-cortai-text3">{pct}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.07)" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#00c4a3" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Table Turnover (real from tables) */}
              <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
                <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                  </svg>
                  <span className="text-[12px] font-semibold text-cortai-text">Table Summary</span>
                </div>
                <div className="grid p-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                  {[
                    { v: tables.length || "—",                                c: "#c8dce8", label: "Tables" },
                    { v: occupiedTables.length || "—",                        c: "#ef4444", label: "In Use" },
                    { v: tables.length - occupiedTables.length || "—",        c: "#10b981", label: "Free" },
                  ].map(({ v, c, label }, i) => (
                    <div key={label} style={{ borderLeft: i > 0 ? "1px solid rgba(255,255,255,.07)" : "none", paddingLeft: i > 0 ? 14 : 0 }}>
                      <div className="font-mono text-[22px] font-bold" style={{ color: c }}>{v}</div>
                      <div className="mt-1 text-[10px] text-cortai-text3">{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Active Room Service Orders */}
              <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
                <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="#8b5cf6" fill="none" strokeWidth="1.5">
                    <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                    <path d="M1 1h4l2.68 13.39a2 2 0 001.74 1.61H19a2 2 0 001.4-3.2L17.3 9H5"/>
                  </svg>
                  <span className="text-[12px] font-semibold text-cortai-text">Active Orders</span>
                  {activeOrders.length > 0 ? (
                    <span className="rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold"
                      style={{ background: "rgba(139,92,246,.15)", color: "#8b5cf6" }}>
                      {activeOrders.length}
                    </span>
                  ) : null}
                </div>
                {activeOrders.length === 0 ? (
                  <EmptyState message="No active orders" className="p-4" testId="active-orders-empty" />
                ) : (
                  <div>
                    {activeOrders.slice(0, 5).map((o) => {
                      const sc = RS_STATUS_CFG[o.status];
                      return (
                        <div
                          key={o.id}
                          className="flex items-center gap-3 border-b border-cortai-border/30 px-4 py-2.5 last:border-0"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[10px] text-cortai-text">{o.room_id.slice(0, 8)}</div>
                            <div className="text-[9px] text-cortai-text3">{summarizeOrder(o.items_json)}</div>
                          </div>
                          <span
                            className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                            style={{ background: sc.bg, color: sc.col }}
                          >
                            {sc.label.toUpperCase()}
                          </span>
                        </div>
                      );
                    })}
                    {activeOrders.length > 5 ? (
                      <button type="button" onClick={() => setActiveTab("roomservice")}
                        className="w-full py-2 text-[10px] text-cortai-text3 hover:text-cortai-text transition">
                        + {activeOrders.length - 5} more — view all
                      </button>
                    ) : null}
                  </div>
                )}
              </div>

            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: MENU
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "menu" && (
        <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
          {/* Header + filters */}
          <div className="flex flex-wrap items-center gap-2 border-b border-cortai-border px-4 py-3">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
            <span className="text-[13px] font-semibold text-cortai-text">{t("menu.title")}</span>
            {menu ? (
              <span className="rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold"
                style={{ background: "rgba(0,196,163,.1)", color: "#00c4a3" }}>{menu.total} items</span>
            ) : null}
            <div className="ml-auto flex flex-wrap items-center gap-2" data-testid="food-breakfast-menu-filters">
              <select
                className="rounded-md border border-cortai-border px-2 py-1 text-[10px] outline-none"
                style={{ background: "#0d1929", color: "#4d7088" }}
                value={menuServiceFilter}
                onChange={(e) => setMenuServiceFilter(e.target.value as MenuService | "")}
              >
                <option value="">{t("menu.filters.allServices")}</option>
                <option value="breakfast">{t("menu.service.breakfast")}</option>
                <option value="restaurant">{t("menu.service.restaurant")}</option>
                <option value="room_service">{t("menu.service.roomService")}</option>
              </select>
              <select
                className="rounded-md border border-cortai-border px-2 py-1 text-[10px] outline-none"
                style={{ background: "#0d1929", color: "#4d7088" }}
                value={menuAvailableFilter}
                onChange={(e) => setMenuAvailableFilter(e.target.value as "" | "true" | "false")}
              >
                <option value="">{t("menu.filters.allAvailability")}</option>
                <option value="true">{t("menu.filters.available")}</option>
                <option value="false">{t("menu.filters.unavailable")}</option>
              </select>
              <button
                type="button"
                onClick={openNewMenu}
                data-testid="food-breakfast-menu-new"
                className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90"
                style={{ background: "#00c4a3" }}
              >
                + {t("menu.new")}
              </button>
            </div>
          </div>

          {/* Column headers */}
          <div
            className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
            style={{ gridTemplateColumns: "100px 1.5fr 80px 120px 70px 1fr 70px", background: "rgba(255,255,255,.02)" }}
          >
            <div>{t("menu.cols.service")}</div>
            <div>{t("menu.cols.name")}</div>
            <div>{t("menu.cols.price")}</div>
            <div>{t("menu.cols.allergens")}</div>
            <div>{t("menu.cols.available")}</div>
            <div>{t("menu.cols.updated")}</div>
            <div>{t("menu.cols.actions")}</div>
          </div>

          {/* Rows */}
          {(menu?.items ?? []).length === 0 ? (
            <EmptyState message={loading ? t("loading") : t("menu.empty")} testId="menu-empty" />
          ) : (menu?.items ?? []).map((it) => {
            const sc = MENU_SERVICE_CFG[it.service];
            return (
              <div
                key={it.id}
                className="grid items-center border-b border-cortai-border/30 px-4 py-2.5 text-[11px] last:border-0 hover:bg-white/[.01]"
                style={{ gridTemplateColumns: "100px 1.5fr 80px 120px 70px 1fr 70px" }}
              >
                <div>
                  <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                    style={{ background: sc.bg, color: sc.col }}>{sc.label.toUpperCase()}</span>
                </div>
                <div>
                  <div className="font-medium text-cortai-text">{it.name_en}</div>
                  {it.name_fr ? <div className="text-[9px] text-cortai-text3">{it.name_fr}</div> : null}
                </div>
                <div className="font-mono text-cortai-text2">${centsToDollars(it.price_cents)}</div>
                <div className="text-[10px] text-cortai-text3 truncate">{(it.allergens ?? []).join(", ") || "—"}</div>
                <div>
                  <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                    style={{ background: it.available ? "rgba(16,185,129,.12)" : "rgba(148,163,184,.10)", color: it.available ? "#10b981" : "#94a3b8" }}>
                    {it.available ? "YES" : "NO"}
                  </span>
                </div>
                <div className="text-[10px] text-cortai-text3">{fmtTsLong(it.updated_at)}</div>
                <div>
                  <button
                    type="button"
                    onClick={() => openEditMenu(it)}
                    data-testid="food-breakfast-menu-edit"
                    className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                    style={{ background: "rgba(59,130,246,.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,.2)" }}
                  >
                    {t("menu.edit")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TAB: ROOM SERVICE
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "roomservice" && (
        <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
          {/* Header + filters */}
          <div className="flex flex-wrap items-center gap-2 border-b border-cortai-border px-4 py-3">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#8b5cf6" fill="none" strokeWidth="1.5">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 001.74 1.61H19a2 2 0 001.4-3.2L17.3 9H5"/>
            </svg>
            <span className="text-[13px] font-semibold text-cortai-text">{t("roomService.title")}</span>
            <div className="ml-auto flex flex-wrap items-center gap-2" data-testid="food-breakfast-room-service-actions">
              <select
                className="rounded-md border border-cortai-border px-2 py-1 text-[10px] outline-none"
                style={{ background: "#0d1929", color: "#4d7088" }}
                value={orderStatusFilter}
                onChange={(e) => setOrderStatusFilter(e.target.value as RoomServiceStatus | "")}
              >
                <option value="">{t("roomService.filters.allStatuses")}</option>
                {(["received", "preparing", "en_route", "delivered", "cancelled"] as const).map((s) => (
                  <option key={s} value={s}>{t(`roomService.status.${s}`)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setOrderOpen(true)}
                data-testid="food-breakfast-room-service-new"
                className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90"
                style={{ background: "#8b5cf6" }}
              >
                + {t("roomService.new")}
              </button>
            </div>
          </div>

          {/* Column headers */}
          <div
            className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
            style={{ gridTemplateColumns: "90px 90px 140px 1fr 1fr", background: "rgba(255,255,255,.02)" }}
          >
            <div>{t("roomService.cols.room")}</div>
            <div>{t("roomService.cols.status")}</div>
            <div>{t("roomService.cols.items")}</div>
            <div>{t("roomService.cols.updated")}</div>
            <div>{t("roomService.cols.actions")}</div>
          </div>

          {/* Rows */}
          {orders.length === 0 ? (
            <EmptyState message={loading ? t("loading") : t("roomService.empty")} testId="room-service-empty" />
          ) : orders.map((o) => {
            const sc = RS_STATUS_CFG[o.status];
            return (
              <div
                key={o.id}
                className="grid items-center border-b border-cortai-border/30 px-4 py-2.5 text-[11px] last:border-0 hover:bg-white/[.01]"
                style={{ gridTemplateColumns: "90px 90px 140px 1fr 1fr" }}
              >
                <div className="font-mono text-[11px] text-cortai-text2">{o.room_id.slice(0, 8)}</div>
                <div>
                  <span className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                    style={{ background: sc.bg, color: sc.col }}>{sc.label.toUpperCase()}</span>
                </div>
                <div className="text-[10px] text-cortai-text3 truncate">{summarizeOrder(o.items_json)}</div>
                <div className="text-[10px] text-cortai-text3">{fmtTsLong(o.updated_at)}</div>
                <div className="flex flex-wrap gap-1">
                  <button type="button"
                    onClick={() => { setSelected(o); setDetailOpen(true); }}
                    data-testid="food-breakfast-room-service-detail"
                    className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                    style={{ background: "rgba(255,255,255,.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,.08)" }}>
                    {t("roomService.detail")}
                  </button>
                  {o.status !== "delivered" && o.status !== "cancelled" ? (
                    <>
                      <button type="button" onClick={() => void patchOrder(o.id, { status: "preparing" })}
                        className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                        style={{ background: "rgba(59,130,246,.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,.2)" }}>
                        {t("roomService.actions.preparing")}
                      </button>
                      <button type="button" onClick={() => void patchOrder(o.id, { status: "en_route" })}
                        className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                        style={{ background: "rgba(139,92,246,.12)", color: "#8b5cf6", border: "1px solid rgba(139,92,246,.2)" }}>
                        {t("roomService.actions.enRoute")}
                      </button>
                      <button type="button" onClick={() => void patchOrder(o.id, { status: "delivered" })}
                        className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                        style={{ background: "rgba(16,185,129,.12)", color: "#10b981", border: "1px solid rgba(16,185,129,.2)" }}>
                        {t("roomService.actions.delivered")}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════════════ */}

      {/* Menu create/edit */}
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
          <Input label={t("menu.modal.nameEn")}      error={menuForm.formState.errors.name_en?.message}       {...menuForm.register("name_en")} />
          <Input label={t("menu.modal.nameFr")}      error={menuForm.formState.errors.name_fr?.message}       {...menuForm.register("name_fr")} />
          <Input label={t("menu.modal.priceCents")}  error={menuForm.formState.errors.price_cents?.message}   type="number" {...menuForm.register("price_cents")} />
          <Input label={t("menu.modal.allergens")}   error={menuForm.formState.errors.allergens_csv?.message} {...menuForm.register("allergens_csv")} />
          <label className="flex items-center gap-2 text-xs text-cortai-text2">
            <input type="checkbox" {...menuForm.register("available")} />
            <span>{t("menu.modal.available")}</span>
          </label>
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setMenuOpen(false)}>{t("close")}</Button>
            <Button type="submit" className="ml-auto" disabled={loading}>{t("save")}</Button>
          </div>
        </form>
      </Modal>

      {/* Room service create */}
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
            <Button type="button" variant="ghost" onClick={() => setOrderOpen(false)}>{t("close")}</Button>
            <Button type="submit" className="ml-auto" disabled={loading}>{t("roomService.modal.submit")}</Button>
          </div>
        </form>
      </Modal>

      {/* Room service detail */}
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
              <div className="mt-2 font-mono text-[11px] text-cortai-text3">{summarizeOrder(selected.items_json)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["received", "preparing", "en_route", "delivered", "cancelled"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void patchOrder(selected.id, { status: s })}
                  className="rounded px-2.5 py-1 text-[10px] font-semibold transition hover:opacity-80"
                  style={{
                    background: RS_STATUS_CFG[s].bg,
                    color: RS_STATUS_CFG[s].col,
                    border: `1px solid ${RS_STATUS_CFG[s].col}33`,
                    opacity: selected.status === s ? 0.45 : 1,
                  }}
                >
                  {t(`roomService.actions.${s === "en_route" ? "enRoute" : s}`)}
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
