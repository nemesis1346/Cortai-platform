"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Table, Td } from "@/components/ui/Table";
import { FormRenderer } from "@/components/forms/FormRenderer";
import type { UIHints } from "@/components/forms/FormRenderer";
import type { JSONSchema } from "@/lib/json-schema-to-zod";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type FormStatus = "draft" | "published" | "archived";

type FormDefinition = {
  id: string;
  org_id: string;
  slug: string;
  title_en: string;
  title_fr: string;
  schema_json: JSONSchema;
  ui_hints_json: UIHints;
  version: number;
  status: FormStatus;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type FormList = {
  items: FormDefinition[];
  total: number;
  page: number;
  page_size: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<FormStatus, BadgeTone> = {
  draft: "neutral",
  published: "teal",
  archived: "amber",
};

const EXAMPLE_SCHEMA: JSONSchema = {
  type: "object",
  required: ["name", "category"],
  properties: {
    name: { type: "string", title: "Name", maxLength: 100 },
    category: {
      type: "string",
      title: "Category",
      enum: ["housekeeping", "maintenance", "food_beverage", "other"],
    },
    notes: { type: "string", title: "Notes", maxLength: 2000 },
    due_date: { type: "string", title: "Due date", format: "date" },
    priority: {
      type: "integer",
      title: "Priority",
      minimum: 1,
      maximum: 5,
    },
  },
};

function tryParseJSON(raw: string): JSONSchema | null {
  try {
    return JSON.parse(raw) as JSONSchema;
  } catch {
    return null;
  }
}

// ── Form schema for create/edit ────────────────────────────────────────────────

const formSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Lowercase letters, numbers and hyphens only"),
  title_en: z.string().min(1).max(180),
  title_fr: z.string().min(1).max(180),
  schema_raw: z.string().min(2),
  ui_hints_raw: z.string().default("{}"),
});

type FormFields = z.infer<typeof formSchema>;

// ── Client component ───────────────────────────────────────────────────────────

export function FormsClient() {
  const t = useTranslations("forms");
  const { user } = useAuth();
  const isAdmin = user?.role === "IT_ADMIN" || user?.role === "SERVICE_PROVIDER_ADMIN";

  const [forms, setForms] = useState<FormDefinition[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FormDefinition | null>(null);
  const [preview, setPreview] = useState<FormDefinition | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [liveSchema, setLiveSchema] = useState<JSONSchema | null>(null);
  const [liveHints, setLiveHints] = useState<UIHints>({});

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormFields>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      slug: "",
      title_en: "",
      title_fr: "",
      schema_raw: JSON.stringify(EXAMPLE_SCHEMA, null, 2),
      ui_hints_raw: "{}",
    },
  });

  const schemaRaw = watch("schema_raw");
  const uiHintsRaw = watch("ui_hints_raw");

  useEffect(() => {
    const parsed = tryParseJSON(schemaRaw);
    if (parsed) {
      setLiveSchema(parsed);
      setSchemaError(null);
    } else {
      setLiveSchema(null);
      setSchemaError("Invalid JSON");
    }
  }, [schemaRaw]);

  useEffect(() => {
    const parsed = tryParseJSON(uiHintsRaw);
    setLiveHints(parsed ? (parsed as UIHints) : {});
  }, [uiHintsRaw]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<FormList>("/api/admin/form-definitions");
      setForms(data.items);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    reset({
      slug: "",
      title_en: "",
      title_fr: "",
      schema_raw: JSON.stringify(EXAMPLE_SCHEMA, null, 2),
      ui_hints_raw: "{}",
    });
    setOpen(true);
  }

  function openEdit(form: FormDefinition) {
    setEditing(form);
    reset({
      slug: form.slug,
      title_en: form.title_en,
      title_fr: form.title_fr,
      schema_raw: JSON.stringify(form.schema_json, null, 2),
      ui_hints_raw: JSON.stringify(form.ui_hints_json, null, 2),
    });
    setOpen(true);
  }

  async function onSave(fields: FormFields) {
    const parsedSchema = tryParseJSON(fields.schema_raw);
    if (!parsedSchema) {
      setSchemaError("Invalid JSON — fix before saving");
      return;
    }
    const parsedHints = tryParseJSON(fields.ui_hints_raw) ?? {};

    if (editing) {
      await apiFetch(`/api/admin/form-definitions/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title_en: fields.title_en,
          title_fr: fields.title_fr,
          schema_json: parsedSchema,
          ui_hints_json: parsedHints,
        }),
      });
    } else {
      await apiFetch("/api/admin/form-definitions", {
        method: "POST",
        body: JSON.stringify({
          slug: fields.slug,
          title_en: fields.title_en,
          title_fr: fields.title_fr,
          schema_json: parsedSchema,
          ui_hints_json: parsedHints,
        }),
      });
    }
    setOpen(false);
    await load();
  }

  async function publish(id: string) {
    await apiFetch(`/api/admin/form-definitions/${id}/publish`, { method: "POST" });
    await load();
  }

  async function archive(id: string) {
    await apiFetch(`/api/admin/form-definitions/${id}/archive`, { method: "POST" });
    await load();
  }

  async function remove(form: FormDefinition) {
    await apiFetch(`/api/admin/form-definitions/${form.id}`, { method: "DELETE" });
    await load();
  }

  if (!isAdmin) {
    return (
      <div
        className="rounded-lg border border-cortai-border bg-cortai-bg2 p-4 text-xs text-cortai-text2"
        data-testid="forms-restricted"
      >
        {t("adminRestricted")}
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="forms-page">
      <Card>
        <div className="flex items-center justify-between border-b border-cortai-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{t("title")}</p>
            <p className="text-xs text-cortai-text2">{t("subtitle")}</p>
          </div>
          <Button onClick={openCreate} data-testid="forms-create-open">
            {t("create")}
          </Button>
        </div>

        <div className="p-4">
          {loading ? (
            <p className="text-xs text-cortai-text2">{t("loading")}</p>
          ) : forms.length === 0 ? (
            <p className="text-xs text-cortai-text2">{t("empty")}</p>
          ) : (
            <Table
              headers={[t("slug"), t("titleEn"), t("version"), t("status"), t("actions")]}
            >
              {forms.map((f) => (
                <tr
                  key={f.id}
                  className="border-t border-cortai-border hover:bg-cortai-bg4/40"
                  data-testid={`form-row-${f.id}`}
                >
                  <Td>
                    <span className="font-mono text-xs">{f.slug}</span>
                  </Td>
                  <Td>{f.title_en}</Td>
                  <Td>v{f.version}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[f.status]} data-testid={`form-status-${f.id}`}>
                      {f.status}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="ghost"
                        onClick={() => setPreview(f)}
                        data-testid={`form-preview-${f.id}`}
                      >
                        {t("preview")}
                      </Button>
                      {f.status === "draft" && (
                        <>
                          <Button
                            variant="ghost"
                            onClick={() => openEdit(f)}
                            data-testid={`form-edit-${f.id}`}
                          >
                            {t("edit")}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => void publish(f.id)}
                            data-testid={`form-publish-${f.id}`}
                          >
                            {t("publish")}
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => void remove(f)}
                            data-testid={`form-delete-${f.id}`}
                          >
                            {t("delete")}
                          </Button>
                        </>
                      )}
                      {f.status === "published" && (
                        <Button
                          variant="ghost"
                          onClick={() => void archive(f.id)}
                          data-testid={`form-archive-${f.id}`}
                        >
                          {t("archive")}
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <p className="mt-2 text-[11px] text-cortai-text3">
            {total} {t("total")}
          </p>
        </div>
      </Card>

      {/* ── Create / Edit modal ── */}
      <Modal
        open={open}
        title={editing ? t("editForm") : t("createForm")}
        closeLabel={t("close")}
        onClose={() => setOpen(false)}
      >
        <form
          onSubmit={handleSubmit(onSave)}
          className="grid gap-3"
          data-testid="forms-modal"
        >
          {/* Slug — only on create */}
          {!editing && (
            <label className="grid gap-1 text-xs text-cortai-text2">
              <span className="font-medium">{t("slug")} *</span>
              <input
                className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none focus:border-cortai-teal"
                placeholder="e.g. shift-handover-checklist"
                data-testid="forms-slug"
                {...register("slug")}
              />
              {errors.slug && (
                <span className="text-[11px] text-cortai-red">{errors.slug.message}</span>
              )}
            </label>
          )}

          <label className="grid gap-1 text-xs text-cortai-text2">
            <span className="font-medium">{t("titleEn")} *</span>
            <input
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none focus:border-cortai-teal"
              data-testid="forms-title-en"
              {...register("title_en")}
            />
            {errors.title_en && (
              <span className="text-[11px] text-cortai-red">{errors.title_en.message}</span>
            )}
          </label>

          <label className="grid gap-1 text-xs text-cortai-text2">
            <span className="font-medium">{t("titleFr")} *</span>
            <input
              className="rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none focus:border-cortai-teal"
              data-testid="forms-title-fr"
              {...register("title_fr")}
            />
            {errors.title_fr && (
              <span className="text-[11px] text-cortai-red">{errors.title_fr.message}</span>
            )}
          </label>

          <label className="grid gap-1 text-xs text-cortai-text2">
            <span className="font-medium">{t("schemaJson")} *</span>
            <textarea
              rows={12}
              className="resize-y rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 font-mono text-xs text-cortai-text outline-none focus:border-cortai-teal"
              data-testid="forms-schema-raw"
              {...register("schema_raw")}
            />
            {(errors.schema_raw ?? schemaError) && (
              <span className="text-[11px] text-cortai-red">
                {errors.schema_raw?.message ?? schemaError}
              </span>
            )}
          </label>

          <label className="grid gap-1 text-xs text-cortai-text2">
            <span className="font-medium">{t("uiHints")}</span>
            <textarea
              rows={4}
              className="resize-y rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 font-mono text-xs text-cortai-text outline-none focus:border-cortai-teal"
              data-testid="forms-ui-hints-raw"
              {...register("ui_hints_raw")}
            />
          </label>

          {/* Live preview inside modal */}
          {liveSchema && (
            <div className="rounded-md border border-cortai-border bg-cortai-bg2 p-3">
              <p className="mb-2 text-[11px] font-semibold text-cortai-text2">{t("livePreview")}</p>
              <FormRenderer
                schema={liveSchema}
                uiHints={liveHints}
                onSubmit={async () => {}}
                submitLabel={t("previewSubmit")}
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("close")}
            </Button>
            <Button type="submit" disabled={isSubmitting} data-testid="forms-modal-submit">
              {isSubmitting ? t("saving") : editing ? t("update") : t("save")}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Preview-only modal ── */}
      {preview && (
        <Modal
          open={Boolean(preview)}
          title={`${t("preview")}: ${preview.title_en}`}
          closeLabel={t("close")}
          onClose={() => setPreview(null)}
        >
          <div data-testid="forms-preview-modal">
            <FormRenderer
              schema={preview.schema_json}
              uiHints={preview.ui_hints_json}
              onSubmit={async (data) => {
                console.info("Preview submit (no-op):", data);
                setPreview(null);
              }}
              submitLabel={t("previewSubmit")}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}