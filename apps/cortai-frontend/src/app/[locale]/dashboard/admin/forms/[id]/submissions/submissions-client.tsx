"use client";

import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Table, Td } from "@/components/ui/Table";
import { FormRenderer } from "@/components/forms/FormRenderer";
import type { JSONSchema } from "@/lib/json-schema-to-zod";
import { apiFetch } from "@/lib/api";

type SubmissionStatus = "draft" | "submitted" | "reviewed" | "archived";

type Submission = {
  id: string;
  org_id: string;
  form_definition_id: string;
  form_version: number;
  submitted_by_user_id: string | null;
  payload_json: Record<string, unknown>;
  source_property_id: string | null;
  status: SubmissionStatus;
  created_at: string;
  submitted_at: string | null;
  form_slug: string | null;
  form_title_en: string | null;
  form_schema_json: JSONSchema | null;
};

type SubmissionList = {
  items: Submission[];
  total: number;
  page: number;
  page_size: number;
};

const STATUS_TONE: Record<SubmissionStatus, BadgeTone> = {
  draft: "neutral",
  submitted: "blue",
  reviewed: "teal",
  archived: "amber",
};

export function AdminSubmissionsClient({ formId }: { formId: string }) {
  const t = useTranslations("formSubmissions");
  const params = useParams();
  const locale = (params.locale as string) ?? "en";
  const router = useRouter();

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Submission | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<SubmissionList>(
        `/api/operations/form-submissions?form_definition_id=${formId}`
      );
      setSubmissions(data.items);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function transition(id: string, newStatus: SubmissionStatus) {
    await apiFetch(`/api/operations/form-submissions/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: newStatus }),
    });
    await load();
    if (detail?.id === id) setDetail(null);
  }

  return (
    <div className="grid gap-4" data-testid="admin-submissions-page">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(`/${locale}/dashboard/admin/forms` as unknown as Parameters<typeof router.push>[0])}
          className="text-xs text-cortai-teal hover:underline"
        >
          ← {t("backToForms")}
        </button>
      </div>

      <Card>
        <div className="border-b border-cortai-border px-4 py-3">
          <p className="text-sm font-semibold">{t("title")}</p>
          <p className="text-xs text-cortai-text2">
            {total} {t("total")}
          </p>
        </div>

        <div className="p-4">
          {loading ? (
            <p className="text-xs text-cortai-text2">{t("loading")}</p>
          ) : submissions.length === 0 ? (
            <p className="text-xs text-cortai-text2">{t("empty")}</p>
          ) : (
            <Table
              headers={[
                t("submittedBy"),
                t("submittedAt"),
                t("version"),
                t("status"),
                t("actions"),
              ]}
            >
              {submissions.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-cortai-border hover:bg-cortai-bg4/40"
                  data-testid={`submission-row-${s.id}`}
                >
                  <Td>
                    <span className="font-mono text-[10px] text-cortai-text2">
                      {s.submitted_by_user_id?.slice(0, 8) ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    {s.submitted_at
                      ? new Date(s.submitted_at).toLocaleString()
                      : "—"}
                  </Td>
                  <Td>v{s.form_version}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="ghost"
                        onClick={() => setDetail(s)}
                        data-testid={`submission-view-${s.id}`}
                      >
                        {t("view")}
                      </Button>
                      {s.status === "submitted" && (
                        <Button
                          variant="ghost"
                          onClick={() => void transition(s.id, "reviewed")}
                          data-testid={`submission-review-${s.id}`}
                        >
                          {t("markReviewed")}
                        </Button>
                      )}
                      {(s.status === "submitted" || s.status === "reviewed") && (
                        <Button
                          variant="ghost"
                          onClick={() => void transition(s.id, "archived")}
                          data-testid={`submission-archive-${s.id}`}
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
        </div>
      </Card>

      {detail && detail.form_schema_json && (
        <Modal
          open
          title={`${t("view")}: ${detail.form_title_en ?? detail.form_slug ?? detail.id}`}
          closeLabel={t("close")}
          onClose={() => setDetail(null)}
        >
          <div className="grid gap-3" data-testid="submission-detail-modal">
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[detail.status]}>{detail.status}</Badge>
              <span className="text-xs text-cortai-text2">
                v{detail.form_version}
                {detail.submitted_at &&
                  ` · ${new Date(detail.submitted_at).toLocaleString()}`}
              </span>
            </div>
            <FormRenderer
              schema={detail.form_schema_json}
              defaultValues={detail.payload_json}
              onSubmit={async () => {}}
              submitLabel={t("close")}
              disabled
            />
          </div>
        </Modal>
      )}
    </div>
  );
}