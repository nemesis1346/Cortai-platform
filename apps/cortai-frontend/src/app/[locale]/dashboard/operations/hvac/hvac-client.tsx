"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Table, Td } from "@/components/ui/Table";

type HvacRoomState = {
  room_id: string;
  current_temp_c: number | null;
  target_temp_c: number | null;
  mode: string | null;
  fan_speed: string | null;
  fault_code: string | null;
  last_updated: string | null;
};

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

export function HvacClient({ initialPropertyId }: { initialPropertyId: string }) {
  const t = useTranslations("operations.hvac");
  const tc = useTranslations("operations.common");

  const [propertyId, setPropertyId] = useState(initialPropertyId);
  useEffect(() => {
    const next = getCookie("cortai_property_id") ?? "";
    setPropertyId(next);
  }, [initialPropertyId]);

  const [items, setItems] = useState<HvacRoomState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const faultCount = useMemo(() => items.filter((it) => Boolean(it.fault_code)).length, [items]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const pid = encodeURIComponent(propertyId);
      const resp = await apiFetch<HvacRoomState[]>(`/api/operations/hvac/rooms?property_id=${pid}`);
      setItems(resp);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-xs text-cortai-text2">{t("selectProperty")}</p>
      </div>
    );
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

      <Card title={t("rooms")}>
        {error ? (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-cortai-red">
            {error}
          </div>
        ) : null}

        <Table headers={[t("cols.roomId"), t("cols.current"), t("cols.target"), t("cols.mode"), t("cols.fan"), t("cols.fault"), t("cols.updated")]}>
          {items.length === 0 ? (
            <tr>
              <Td colSpan={7} className="text-cortai-text3">
                {loading ? t("loading") : t("empty")}
              </Td>
            </tr>
          ) : null}

          {items.map((it) => (
            <tr key={it.room_id} className="hover:bg-white/[0.02]">
              <Td className="font-semibold">{it.room_id.slice(0, 8)}</Td>
              <Td className="text-cortai-text2">{fmtTemp(it.current_temp_c, tc("dash"), tc("tempUnitC"))}</Td>
              <Td className="text-cortai-text2">{fmtTemp(it.target_temp_c, tc("dash"), tc("tempUnitC"))}</Td>
              <Td className="text-cortai-text2">{it.mode ?? tc("dash")}</Td>
              <Td className="text-cortai-text2">{it.fan_speed ?? tc("dash")}</Td>
              <Td>
                <Badge tone={toneForFault(it.fault_code)}>{it.fault_code ?? t("ok")}</Badge>
              </Td>
              <Td className="text-cortai-text2">{fmtTs(it.last_updated, tc("dash"))}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

