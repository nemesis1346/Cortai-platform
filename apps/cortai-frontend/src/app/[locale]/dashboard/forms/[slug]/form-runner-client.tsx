"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormRenderer } from "@/components/forms/FormRenderer";
import type { UIHints } from "@/components/forms/FormRenderer";
import type { JSONSchema } from "@/lib/json-schema-to-zod";
import { apiFetch } from "@/lib/api";

type FormDefinition = {
  id: string;
  slug: string;
  title_en: string;
  title_fr: string;
  schema_json: JSONSchema;
  ui_hints_json: UIHints;
  version: number;
};

type Props = { slug: string; locale: string };

export function FormRunnerClient({ slug, locale }: Props) {
  const t = useTranslations("formRunner");
  const router = useRouter();

  const [form, setForm] = useState<FormDefinition | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<FormDefinition>(
        `/api/admin/form-definitions/by-slug/${encodeURIComponent(slug)}`
      );
      setForm(data);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = useCallback(
    async (data: Record<string, unknown>) => {
      if (!form) return;
      setSubmitting(true);
      try {
        await apiFetch("/api/operations/form-submissions", {
          method: "POST",
          body: JSON.stringify({
            form_definition_id: form.id,
            payload_json: data,
          }),
        });
        setSubmitted(true);
      } finally {
        setSubmitting(false);
      }
    },
    [form]
  );

  const title = form
    ? locale === "fr"
      ? form.title_fr
      : form.title_en
    : "";

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-cortai-text2">{t("loading")}</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div
        className="flex min-h-[40vh] flex-col items-center justify-center gap-4"
        data-testid="form-runner-not-found"
      >
        <p className="text-sm font-semibold text-cortai-text">{t("notFound")}</p>
        <p className="text-xs text-cortai-text2">{t("notFoundDetail")}</p>
        <Button
          variant="ghost"
          onClick={() =>
            router.push(
              `/${locale}/dashboard/operations/forms` as unknown as Parameters<
                typeof router.push
              >[0]
            )
          }
        >
          {t("backToForms")}
        </Button>
      </div>
    );
  }

  if (submitted) {
    return (
      <div
        className="flex min-h-[40vh] flex-col items-center justify-center gap-4"
        data-testid="form-runner-success"
      >
        <p className="text-sm font-semibold text-cortai-teal">{t("successTitle")}</p>
        <p className="text-xs text-cortai-text2">{t("successDetail")}</p>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setSubmitted(false);
            }}
          >
            {t("submitAnother")}
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              router.push(
                `/${locale}/dashboard/operations/forms` as unknown as Parameters<
                  typeof router.push
                >[0]
              )
            }
          >
            {t("backToForms")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl" data-testid="form-runner-page">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-cortai-text">{title}</h1>
        <p className="text-xs text-cortai-text2 font-mono mt-0.5">
          {form!.slug} · v{form!.version}
        </p>
      </div>
      <Card>
        <div className="p-6">
          <FormRenderer
            schema={form!.schema_json}
            uiHints={form!.ui_hints_json}
            locale={locale}
            onSubmit={handleSubmit}
            submitLabel={t("submit")}
            disabled={submitting}
          />
        </div>
      </Card>
    </div>
  );
}