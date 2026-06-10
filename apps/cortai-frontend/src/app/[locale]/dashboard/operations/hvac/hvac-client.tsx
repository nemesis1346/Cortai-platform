"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

type HvacRoomState = {
  room_id: string;
  current_temp_c: number | null;
  target_temp_c: number | null;
  mode: string | null;
  fan_speed: string | null;
  fault_code: string | null;
  last_updated: string | null;
};

type EdgeEvent = {
  device_id: string;
  type: string;
  severity: string;
  payload: Record<string, unknown>;
  ts: string;
};

type ControlResponse = { command_id: string; accepted_at: string; expected_ack_within_s: number };
type AckResponse = { command_id: string; room_id: string; accepted: boolean; error?: string | null; acked_at?: string | null };

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

function fmtTemp(value: number | null, dash: string, unit: string) {
  if (value === null || value === undefined) return dash;
  return `${value.toFixed(1)}${unit}`;
}

function toneForFault(code: string | null) {
  return code ? "red" : "green";
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function HvacClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.hvac");
  const tc = useTranslations("operations.common");
  const { notify } = useToast();

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [items, setItems] = useState<HvacRoomState[]>([]);
  const [alerts, setAlerts] = useState<EdgeEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const faultCount = useMemo(() => items.filter((it) => Boolean(it.fault_code)).length, [items]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const [rooms, ev] = await Promise.all([
        apiFetch<HvacRoomState[]>(`/api/operations/hvac/rooms?property_id=${pid}`),
        apiFetch<EdgeEvent[]>(`/api/operations/hvac/alerts?property_id=${pid}`)
      ]);
      setItems(rooms);
      setAlerts(ev);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<HvacRoomState | null>(null);
  const [targetTemp, setTargetTemp] = useState<string>("");
  const [mode, setMode] = useState<string>("auto");
  const [fanIndex, setFanIndex] = useState<number>(0);

  const fanSpeed = useMemo(() => {
    const options = ["auto", "low", "medium", "high"] as const;
    return options[Math.max(0, Math.min(options.length - 1, fanIndex))];
  }, [fanIndex]);

  const alertsByRoom = useMemo(() => {
    const m = new Map<string, EdgeEvent[]>();
    for (const a of alerts) {
      const rid = String((a.payload as Record<string, unknown>)?.room_id ?? "");
      if (!rid) continue;
      m.set(rid, [...(m.get(rid) ?? []), a]);
    }
    return m;
  }, [alerts]);

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-xs text-cortai-text2">{t("selectProperty")}</p>
      </div>
    );
  }

  function openControl(room: HvacRoomState) {
    setSelected(room);
    setTargetTemp(room.target_temp_c == null ? "" : String(room.target_temp_c));
    setMode(room.mode ?? "auto");
    const idx = room.fan_speed === "high" ? 3 : room.fan_speed === "medium" ? 2 : room.fan_speed === "low" ? 1 : 0;
    setFanIndex(idx);
    setModalOpen(true);
  }

  async function submitControl() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        mode,
        fan_speed: fanSpeed
      };
      const tt = Number.parseFloat(targetTemp);
      if (Number.isFinite(tt)) payload.target_temp_c = tt;

      const resp = await apiFetch<ControlResponse>(
        `/api/operations/hvac/rooms/${encodeURIComponent(selected.room_id)}/control`,
        {
          method: "POST",
          body: JSON.stringify(payload)
        }
      );
      notify({
        title: t("toast.sent.title"),
        description: t("toast.sent.description", { seconds: resp.expected_ack_within_s }),
        tone: "success"
      });
      let ack: AckResponse | null = null;
      for (let i = 0; i < 4; i += 1) {
        await sleep(500);
        ack = await apiFetch<AckResponse>(
          `/api/operations/hvac/rooms/${encodeURIComponent(selected.room_id)}/commands/${encodeURIComponent(resp.command_id)}`
        );
        if (ack.accepted || ack.error) break;
      }
      if (ack?.accepted) {
        notify({ title: t("toast.acked.title"), description: t("toast.acked.description"), tone: "success" });
      } else if (ack?.error) {
        notify({ title: t("toast.ackFailed.title"), description: ack.error, tone: "error" });
      }
      setModalOpen(false);
      // best-effort refresh
      await load();
    } catch (e) {
      setError(String(e));
      notify({ title: t("toast.failed.title"), description: t("toast.failed.description"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-4" data-testid="hvac-page">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone={faultCount > 0 ? "red" : "green"}>
            {faultCount > 0 ? t("faults", { count: faultCount }) : t("noFaults")}
          </Badge>
          <Button type="button" variant="ghost" onClick={() => void load()} disabled={loading}>
            {t("refresh")}
          </Button>
        </div>
      </div>

      <Card title={t("alerts.title")}>
        {alerts.length === 0 ? (
          <p className="text-xs text-cortai-text3">{t("alerts.empty")}</p>
        ) : (
          <div className="grid gap-2">
            {alerts.map((a) => {
              const rid = String((a.payload as Record<string, unknown>)?.room_id ?? "");
              const code = String((a.payload as Record<string, unknown>)?.fault_code ?? "");
              const tone = a.severity === "high" ? "red" : a.severity === "medium" ? "amber" : "neutral";
              return (
                <div
                  key={`${a.device_id}-${a.ts}-${code}`}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2"
                >
                  <Badge tone={tone}>{a.severity}</Badge>
                  <span className="text-xs font-semibold text-cortai-text">{t("alerts.room", { room: rid.slice(0, 8) })}</span>
                  <span className="text-xs text-cortai-text2">{t("alerts.fault", { code })}</span>
                  <span className="ml-auto text-[11px] text-cortai-text3">{fmtTs(a.ts, tc("dash"))}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title={t("rooms")}>
        {error ? (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-cortai-red">
            {error}
          </div>
        ) : null}

        {items.length === 0 ? (
          <div className="text-xs text-cortai-text3">{loading ? t("loading") : t("empty")}</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((it) => {
              const roomAlerts = alertsByRoom.get(it.room_id) ?? [];
              return (
                <button
                  key={it.room_id}
                  type="button"
                  onClick={() => openControl(it)}
                  className="rounded-lg border border-cortai-border bg-cortai-bg2 p-3 text-left transition hover:border-cortai-teal/25 hover:bg-cortai-bg3"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold">{it.room_id.slice(0, 8)}</div>
                    {roomAlerts.length > 0 ? (
                      <Badge tone="red">{t("alerts.badge", { count: roomAlerts.length })}</Badge>
                    ) : null}
                    <span className="ml-auto text-[11px] text-cortai-text3">{fmtTs(it.last_updated, tc("dash"))}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge tone="neutral">
                      {t("chips.current", { value: fmtTemp(it.current_temp_c, tc("dash"), tc("tempUnitC")) })}
                    </Badge>
                    <Badge tone="blue">
                      {t("chips.target", { value: fmtTemp(it.target_temp_c, tc("dash"), tc("tempUnitC")) })}
                    </Badge>
                    <Badge tone={toneForFault(it.fault_code)}>{it.fault_code ?? t("ok")}</Badge>
                  </div>
                  <div className="mt-2 text-xs text-cortai-text2">
                    {t("chips.modeFan", { mode: it.mode ?? tc("dash"), fan: it.fan_speed ?? tc("dash") })}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        title={t("control.title", { room: selected?.room_id?.slice(0, 8) ?? "" })}
        closeLabel={t("control.close")}
        onClose={() => setModalOpen(false)}
      >
        {!selected ? null : (
          <div className="grid gap-3">
            <div className="grid gap-1 text-xs text-cortai-text2">
              <div className="font-semibold text-cortai-text">{t("control.subtitle")}</div>
              <div>{t("control.currentLine", { value: fmtTemp(selected.current_temp_c, tc("dash"), tc("tempUnitC")) })}</div>
            </div>

            <label className="grid gap-1.5 text-xs text-cortai-text2">
              <span className="font-medium">{t("control.targetTemp")}</span>
              <input
                type="number"
                step="0.5"
                value={targetTemp}
                onChange={(e) => setTargetTemp(e.target.value)}
                className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none focus:border-cortai-teal"
                placeholder={t("control.targetTempPlaceholder")}
              />
            </label>

            <label className="grid gap-1.5 text-xs text-cortai-text2">
              <span className="font-medium">{t("control.mode")}</span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none focus:border-cortai-teal"
              >
                {(["auto", "cooling", "heating", "off"] as const).map((m) => (
                  <option key={m} value={m}>
                    {t(`control.modes.${m}`)}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5 text-xs text-cortai-text2">
              <span className="flex items-center justify-between gap-2 font-medium">
                <span>{t("control.fanSpeed")}</span>
                <span className="text-[11px] text-cortai-text3">{t(`control.fans.${fanSpeed}`)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={3}
                step={1}
                value={fanIndex}
                onChange={(e) => setFanIndex(Number.parseInt(e.target.value, 10))}
              />
            </label>

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => setModalOpen(false)} disabled={loading}>
                {t("control.cancel")}
              </Button>
              <Button type="button" onClick={() => void submitControl()} disabled={loading}>
                {t("control.send")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

