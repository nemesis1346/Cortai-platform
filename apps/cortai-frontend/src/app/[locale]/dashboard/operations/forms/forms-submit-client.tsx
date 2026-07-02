"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { FormRenderer } from "@/components/forms/FormRenderer";
import type { UIHints } from "@/components/forms/FormRenderer";
import type { JSONSchema } from "@/lib/json-schema-to-zod";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type FormStatus = "draft" | "published" | "archived";

type FormDefinition = {
  id: string;
  slug: string;
  title_en: string;
  title_fr: string;
  schema_json: JSONSchema;
  ui_hints_json: UIHints;
  version: number;
  status: FormStatus;
};

type FormList = {
  items: FormDefinition[];
};

type SubmissionStatus = "draft" | "submitted" | "reviewed" | "archived";

type Submission = {
  id: string;
  form_definition_id: string;
  form_version: number;
  status: SubmissionStatus;
  submitted_at: string | null;
  form_title_en: string | null;
  form_slug: string | null;
};

type SubmissionList = {
  items: Submission[];
  total: number;
};

const SUB_STATUS_TONE: Record<SubmissionStatus, BadgeTone> = {
  draft: "neutral",
  submitted: "blue",
  reviewed: "teal",
  archived: "amber",
};

// ── Component ──────────────────────────────────────────────────────────────────

export function FormsSubmitClient() {
  const t = useTranslations("formSubmissions");
  const params = useParams();
  const locale = (params.locale as string) ?? "en";

  const [publishedForms, setPublishedForms] = useState<FormDefinition[]>([]);
  const [mySubmissions, setMySubmissions] = useState<Submission[]>([]);
  const [submissionsTotal, setSubmissionsTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeForm, setActiveForm] = useState<FormDefinition | null>(null);
  const [submitDone, setSubmitDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [formsData, subsData] = await Promise.all([
        apiFetch<FormList>("/api/admin/form-definitions?status=published&page_size=100"),
        apiFetch<SubmissionList>("/api/operations/form-submissions?page_size=20"),
      ]);
      setPublishedForms(formsData.items);
      setMySubmissions(subsData.items);
      setSubmissionsTotal(subsData.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(data: Record<string, unknown>) {
    if (!activeForm) return;
    await apiFetch("/api/operations/form-submissions", {
      method: "POST",
      body: JSON.stringify({
        form_definition_id: activeForm.id,
        payload_json: data,
      }),
    });
    setActiveForm(null);
    setSubmitDone(true);
    await load();
  }

  async function handleSaveDraft(data: Record<string, unknown>) {
    if (!activeForm) return;
    await apiFetch("/api/operations/form-submissions", {
      method: "POST",
      body: JSON.stringify({
        form_definition_id: activeForm.id,
        payload_json: data,
        save_as_draft: true,
      }),
    });
    setActiveForm(null);
    await load();
  }

  return (
    <div className="grid gap-4" data-testid="operations-forms-page">
      {/* ── Published forms catalogue ── */}
      <Card>
        <div className="border-b border-cortai-border px-4 py-3">
          <p className="text-sm font-semibold">{t("catalogueTitle")}</p>
          <p className="text-xs text-cortai-text2">{t("catalogueSubtitle")}</p>
        </div>
        <div className="p-4">
          {loading ? (
            <p className="text-xs text-cortai-text2">{t("loading")}</p>
          ) : publishedForms.length === 0 ? (
            <p className="text-xs text-cortai-text2">{t("noPublishedForms")}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {publishedForms.map((f) => (
                <div
                  key={f.id}
                  className="flex flex-col gap-2 rounded-lg border border-cortai-border bg-cortai-bg3 p-3"
                  data-testid={`catalogue-form-${f.id}`}
                >
                  <div>
                    <p className="text-xs font-semibold">{f.title_en}</p>
                    <p className="font-mono text-[10px] text-cortai-text3">{f.slug} · v{f.version}</p>
                  </div>
                  <Button
                    onClick={() => { setSubmitDone(false); setActiveForm(f); }}
                    data-testid={`catalogue-fill-${f.id}`}
                  >
                    {t("fillForm")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* ── My submissions ── */}
      <Card>
        <div className="border-b border-cortai-border px-4 py-3">
          <p className="text-sm font-semibold">{t("mySubmissionsTitle")}</p>
          <p className="text-xs text-cortai-text2">
            {submissionsTotal} {t("total")}
          </p>
        </div>
        <div className="p-4">
          {mySubmissions.length === 0 ? (
            <p className="text-xs text-cortai-text2">{t("noSubmissionsYet")}</p>
          ) : (
            <div className="divide-y divide-cortai-border">
              {mySubmissions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between py-2"
                  data-testid={`my-submission-${s.id}`}
                >
                  <div>
                    <p className="text-xs font-medium">
                      {s.form_title_en ?? s.form_slug ?? s.form_definition_id}
                    </p>
                    <p className="text-[10px] text-cortai-text3">
                      v{s.form_version}
                      {s.submitted_at &&
                        ` · ${new Date(s.submitted_at).toLocaleString()}`}
                    </p>
                  </div>
                  <Badge tone={SUB_STATUS_TONE[s.status]}>{s.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* ── Fill form modal ── */}
      {activeForm && (
        <Modal
          open
          title={activeForm.title_en}
          closeLabel={t("cancel")}
          onClose={() => setActiveForm(null)}
        >
          <div className="grid gap-4" data-testid="fill-form-modal">
            {submitDone && (
              <p className="text-xs text-cortai-teal">{t("submitSuccess")}</p>
            )}
            <FormRenderer
              schema={activeForm.schema_json}
              uiHints={activeForm.ui_hints_json}
              locale={locale}
              onSubmit={handleSubmit}
              submitLabel={t("submit")}
            />
            <Button
              variant="ghost"
              onClick={() => {
                const form = document.querySelector<HTMLFormElement>(
                  "[data-testid='form-renderer']"
                );
                if (form) {
                  const fd = new FormData(form);
                  const data = Object.fromEntries(fd.entries());
                  void handleSaveDraft(data);
                }
              }}
              data-testid="fill-form-save-draft"
            >
              {t("saveDraft")}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}