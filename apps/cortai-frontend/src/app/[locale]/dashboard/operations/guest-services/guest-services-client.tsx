"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
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

function typeLabel(t: GuestServiceType): string {
  if (t === "late_checkout") return "Late Checkout";
  if (t === "wake_up")       return "Wake-up Call";
  if (t === "amenities")     return "Amenities";
  if (t === "pillows")       return "Pillows";
  if (t === "towels")        return "Extra Towels";
  return "Other";
}

const TYPE_ICON: Record<GuestServiceType, string> = {
  towels:        "🛁",
  pillows:       "🛏",
  amenities:     "🧴",
  late_checkout: "🕙",
  wake_up:       "⏰",
  other:         "📋",
};

function waitMinutes(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
}

function fmtWait(createdAt: string): string {
  const m = waitMinutes(createdAt);
  if (m < 1)  return "< 1m";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtMinutes(min: number): string {
  if (min < 1)  return "< 1m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m}m`;
}

type PriorityCfg = { label: string; col: string; bg: string };
function derivePriority(item: GuestServiceItem): PriorityCfg {
  const m = waitMinutes(item.created_at);
  if (m >= 20 && item.status === "pending")
    return { label: "Urgent", col: "#ef4444", bg: "rgba(239,68,68,.12)" };
  if (item.type === "wake_up")
    return { label: "High",   col: "#f59e0b", bg: "rgba(245,158,11,.12)" };
  if (item.type === "towels" || item.type === "pillows")
    return { label: "Low",    col: "#94a3b8", bg: "rgba(148,163,184,.10)" };
  return    { label: "Normal", col: "#3b82f6", bg: "rgba(59,130,246,.12)" };
}

const STATUS_CFG: Record<GuestServiceStatus, { col: string; bg: string }> = {
  pending:   { col: "#f59e0b", bg: "rgba(245,158,11,.12)" },
  assigned:  { col: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  completed: { col: "#10b981", bg: "rgba(16,185,129,.12)" },
  cancelled: { col: "#94a3b8", bg: "rgba(148,163,184,.10)" },
};

const ALL_TYPES: GuestServiceType[] = ["towels", "pillows", "amenities", "late_checkout", "wake_up", "other"];
const ALL_STATUSES: GuestServiceStatus[] = ["pending", "assigned", "completed", "cancelled"];

export function GuestServicesClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.guestServices");
  const { user } = useAuth();
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [items, setItems]           = useState<GuestServiceItem[]>([]);
  const [loading, setLoading]       = useState(false);
  const [open, setOpen]             = useState(false);
  const [statusFilter, setStatusFilter] = useState<GuestServiceStatus | "">("");
  const [typeFilter, setTypeFilter]     = useState<GuestServiceType | "">("");

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("property_id", propertyId);
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter)   params.set("type", typeFilter);
      const resp = await apiFetch<GuestServiceList>(`/api/operations/guest-services?${params.toString()}`);
      setItems(resp.items);
    } finally {
      setLoading(false);
    }
  }, [propertyId, statusFilter, typeFilter]);

  useEffect(() => { void load(); }, [load]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  const activeItems    = useMemo(() => items.filter((r) => r.status !== "completed" && r.status !== "cancelled"), [items]);
  const pendingItems   = useMemo(() => items.filter((r) => r.status === "pending"), [items]);
  const completedItems = useMemo(() => items.filter((r) => r.status === "completed" && r.completed_at), [items]);

  const avgWaitMin = useMemo(() => {
    if (pendingItems.length === 0) return null;
    const total = pendingItems.reduce((s, r) => s + waitMinutes(r.created_at), 0);
    return total / pendingItems.length;
  }, [pendingItems]);

  const responseByType = useMemo(() => {
    const maxPct = 20; // minutes considered 100%
    return ALL_TYPES.map((type) => {
      const done = completedItems.filter((r) => r.type === type && r.completed_at);
      if (done.length === 0) return null;
      const avgMs = done.reduce((s, r) => s + Math.max(0, new Date(r.completed_at!).getTime() - new Date(r.created_at).getTime()), 0) / done.length;
      const avgMin = avgMs / 60000;
      const pct = Math.min(100, Math.round((avgMin / maxPct) * 100));
      return { label: typeLabel(type), avgMin, pct };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  }, [completedItems]);

  // ── Form ──────────────────────────────────────────────────────────────────
  const schema = useMemo(
    () =>
      z.object({
        type:    z.enum(["towels", "pillows", "amenities", "late_checkout", "wake_up", "other"]),
        room_id: z.string().uuid().optional().or(z.literal("")),
        note:    z.string().max(500).optional().or(z.literal("")),
      }),
    [],
  );
  type CreateForm = z.infer<typeof schema>;

  const form = useForm<CreateForm>({
    resolver: zodResolver(schema),
    defaultValues: { type: "towels", room_id: "", note: "" },
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
          note: values.note ? values.note : null,
        }),
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
        body: JSON.stringify(payload),
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

  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="grid gap-4" data-testid="guest-services-page">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-cortai-text">{t("title")}</h1>
          <p className="text-[11px] text-cortai-text3">{todayLabel} · {t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => void load()} disabled={loading}>
            {t("refresh")}
          </Button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            data-testid="guest-services-new"
            className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90"
            style={{ background: "#00c4a3" }}
          >
            + New Request
          </button>
        </div>
      </div>

      {/* ── KPI Strip ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Active Requests",   v: activeItems.length,    sub: `${pendingItems.length} pending · ${activeItems.filter((r) => r.status === "assigned").length} assigned`, c: "#ef4444" },
          { label: "Avg Wait Time",     v: avgWaitMin != null ? fmtMinutes(avgWaitMin) : "—", sub: "pending requests",  c: "#f59e0b" },
          { label: "VIP Requests",      v: 3,                     sub: "Suite 901, 802, 714",                            c: "#8b5cf6" },
          { label: "Completed Today",   v: completedItems.length, sub: "resolved requests",                              c: "#10b981" },
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

      {/* ── Main Layout ────────────────────────────────────────────────── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 300px" }}>

        {/* Live Request Queue */}
        <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
          {/* Header + filters */}
          <div className="flex flex-wrap items-center gap-2 border-b border-cortai-border px-4 py-3">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
              <path d="M22 17H2a3 3 0 003-3V9a7 7 0 0114 0v5a3 3 0 003 3z"/>
            </svg>
            <span className="text-[13px] font-semibold text-cortai-text">Live Request Queue</span>
            {activeItems.length > 0 && (
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-semibold"
                style={{ background: "rgba(245,158,11,.15)", color: "#f59e0b" }}
              >
                {activeItems.length} open
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1.5" data-testid="guest-services-filters">
              {/* Status pills */}
              {([["", "All"], ...ALL_STATUSES.map((s) => [s, s.charAt(0).toUpperCase() + s.slice(1)])] as [string, string][]).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setStatusFilter(val as GuestServiceStatus | "")}
                  className="rounded-md px-2.5 py-1 text-[10px] font-semibold transition"
                  style={{
                    background: statusFilter === val ? "rgba(0,196,163,.15)" : "rgba(255,255,255,.04)",
                    color: statusFilter === val ? "#00c4a3" : "#4d7088",
                    border: `1px solid ${statusFilter === val ? "rgba(0,196,163,.3)" : "rgba(255,255,255,.06)"}`,
                  }}
                >
                  {lbl}
                </button>
              ))}
              {/* Type filter */}
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as GuestServiceType | "")}
                className="rounded-md border border-cortai-border px-2 py-1 text-[10px] outline-none"
                style={{ background: "#0d1929", color: "#4d7088" }}
              >
                <option value="">All types</option>
                {ALL_TYPES.map((tt) => (
                  <option key={tt} value={tt}>{typeLabel(tt)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Table header */}
          <div
            className="grid border-b border-cortai-border px-4 py-2.5 text-[9px] font-bold uppercase tracking-[0.07em] text-cortai-text3"
            style={{ gridTemplateColumns: "1.4fr 90px 56px 70px 70px 1fr", background: "rgba(255,255,255,.02)" }}
          >
            <div>Request</div>
            <div>Room</div>
            <div>Wait</div>
            <div>Priority</div>
            <div>Status</div>
            <div>Actions</div>
          </div>

          {/* Rows */}
          {items.length === 0 ? (
            <EmptyState message={loading ? t("loading") : t("empty")} testId="requests-empty" />
          ) : items.map((item) => {
            const pri = derivePriority(item);
            const sc  = STATUS_CFG[item.status];
            const isUrgent = pri.label === "Urgent";
            return (
              <div
                key={item.id}
                className="grid items-center border-b border-cortai-border/30 px-4 py-2.5 text-[11px] last:border-0"
                style={{
                  gridTemplateColumns: "1.4fr 90px 56px 70px 70px 1fr",
                  background: isUrgent ? "rgba(239,68,68,.03)" : "transparent",
                  borderLeft: isUrgent ? "3px solid rgba(239,68,68,.4)" : "3px solid transparent",
                }}
              >
                {/* Request type */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[14px] shrink-0">{TYPE_ICON[item.type]}</span>
                  <div className="min-w-0">
                    <div className="font-medium text-cortai-text truncate">{typeLabel(item.type)}</div>
                    {item.note ? (
                      <div className="text-[9px] text-cortai-text3 truncate">{item.note}</div>
                    ) : null}
                  </div>
                </div>

                {/* Room */}
                <div className="font-mono text-[10px]" style={{ color: item.room_id ? "#00c4a3" : "#4d7088" }}>
                  {item.room_id ? item.room_id.slice(0, 8) : "—"}
                </div>

                {/* Wait */}
                <div className="font-mono text-[11px]" style={{ color: waitMinutes(item.created_at) >= 20 ? "#ef4444" : "#94a3b8" }}>
                  {item.status === "completed" || item.status === "cancelled" ? "—" : fmtWait(item.created_at)}
                </div>

                {/* Priority */}
                <div>
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                    style={{ background: pri.bg, color: pri.col }}
                  >
                    {pri.label.toUpperCase()}
                  </span>
                </div>

                {/* Status */}
                <div>
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                    style={{ background: sc.bg, color: sc.col }}
                  >
                    {item.status.toUpperCase()}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-1">
                  {item.status !== "completed" && item.status !== "cancelled" ? (
                    <button
                      type="button"
                      disabled={!user}
                      onClick={() => void patch(item.id, { status: "assigned", assigned_to_user_id: user?.id })}
                      className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80 disabled:opacity-40"
                      style={{ background: "rgba(59,130,246,.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,.2)" }}
                    >
                      {t("actions.assignToMe")}
                    </button>
                  ) : null}
                  {item.status !== "completed" ? (
                    <button
                      type="button"
                      onClick={() => void patch(item.id, { status: "completed" })}
                      className="rounded px-2 py-0.5 text-[9px] font-semibold transition hover:opacity-80"
                      style={{ background: "rgba(16,185,129,.12)", color: "#10b981", border: "1px solid rgba(16,185,129,.2)" }}
                    >
                      {t("actions.complete")}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right column */}
        <div className="flex min-w-0 flex-col gap-3">

          {/* Response Times */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#00c4a3" fill="none" strokeWidth="1.5">
                <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
              </svg>
              <span className="text-[12px] font-semibold text-cortai-text">Response Times</span>
              <span className="ml-auto text-[9px] text-cortai-text3">avg · completed</span>
            </div>
            <div className="p-4">
              {responseByType.length === 0 ? (
                <EmptyState message="No completed requests yet" className="py-4" testId="completed-requests-empty" />
              ) : responseByType.map(({ label, avgMin, pct }) => (
                <div key={label} className="mb-3 last:mb-0">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] text-cortai-text">{label}</span>
                    <span className="font-mono text-[11px] text-cortai-text2">{fmtMinutes(avgMin)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.07)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 80 ? "#ef4444" : pct >= 50 ? "#f59e0b" : "#00c4a3",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Guest Feedback */}
          <div className="overflow-hidden rounded-xl border border-cortai-border" style={{ background: "#080f1d" }}>
            <div className="flex items-center gap-2 border-b border-cortai-border px-4 py-3">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="#c9a84c" fill="none" strokeWidth="1.5">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
              </svg>
              <span className="text-[12px] font-semibold text-cortai-text">Guest Feedback</span>
              <span className="ml-auto text-[9px] text-cortai-text3">demo</span>
            </div>
            <div className="p-4">
              {[
                { label: "Excellent", pct: 65, c: "#10b981" },
                { label: "Good",      pct: 30, c: "#00c4a3" },
                { label: "Fair",      pct: 4,  c: "#f59e0b" },
                { label: "Poor",      pct: 1,  c: "#ef4444" },
              ].map(({ label, pct, c }) => (
                <div key={label} className="mb-2.5 flex items-center gap-3 last:mb-0">
                  <span className="w-[56px] shrink-0 text-[11px] text-cortai-text2">{label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.07)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c }} />
                  </div>
                  <span className="w-[28px] shrink-0 text-right font-mono text-[11px] text-cortai-text2">{pct}%</span>
                </div>
              ))}
              <div className="mt-3 border-t border-cortai-border/40 pt-2.5 text-center">
                <div className="font-mono text-[22px] font-bold" style={{ color: "#c9a84c" }}>4.6</div>
                <div className="text-[9px] text-cortai-text3">Overall satisfaction score</div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── New Request Modal ───────────────────────────────────────────── */}
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
              {ALL_TYPES.map((tt) => (
                <option key={tt} value={tt}>{typeLabel(tt)}</option>
              ))}
            </select>
          </label>
          <Input label={t("modal.roomId")} error={form.formState.errors.room_id?.message} {...form.register("room_id")} />
          <Input label={t("modal.note")}   error={form.formState.errors.note?.message}    {...form.register("note")} />
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
