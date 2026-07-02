"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback } from "react";
import { useFieldArray, useForm, type UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/Button";
import { type JSONSchema, jsonSchemaToZod } from "@/lib/json-schema-to-zod";

// ── ui_hints_json shape ────────────────────────────────────────────────────────
// {
//   order?: string[];                 // field keys in render order
//   labels?: Record<string, string>;  // override title per key
//   placeholders?: Record<string, string>;
//   hidden?: string[];                // keys to skip rendering
//   readOnly?: string[];
// }
export type UIHints = {
  order?: string[];
  labels?: Record<string, string>;
  labels_fr?: Record<string, string>;
  placeholders?: Record<string, string>;
  hidden?: string[];
  readOnly?: string[];
};

type FieldProps = {
  name: string;
  schema: JSONSchema;
  hints: UIHints;
  locale?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  required: boolean;
};

// ── Field-level renderer ───────────────────────────────────────────────────────

function Field({ name, schema, hints, locale, form, required }: FieldProps) {
  const hidden = hints.hidden?.includes(name);
  if (hidden) return null;

  const readOnly = hints.readOnly?.includes(name) || schema.readOnly;
  const label =
    (locale === "fr" ? hints.labels_fr?.[name] : undefined) ??
    hints.labels?.[name] ??
    schema.title ??
    name;
  const placeholder = hints.placeholders?.[name] ?? schema.description ?? "";
  const error = form.formState.errors[name]?.message as string | undefined;
  const t = primaryType(schema);

  const baseInput =
    "w-full rounded-md border border-cortai-border bg-cortai-bg2 px-3 py-2 text-sm text-cortai-text outline-none transition placeholder:text-cortai-text3 focus:border-cortai-teal disabled:opacity-50";

  // Enum → <select>
  if (schema.enum !== undefined) {
    return (
      <label className="grid gap-1.5 text-xs text-cortai-text2">
        <span className="font-medium">
          {label}
          {required && <span className="ml-0.5 text-cortai-red">*</span>}
        </span>
        <select
          className={baseInput}
          disabled={readOnly}
          {...form.register(name)}
        >
          {!required && <option value="">—</option>}
          {(schema.enum as string[]).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        {error && <span className="text-[11px] text-cortai-red">{error}</span>}
      </label>
    );
  }

  // Object → nested fieldset
  if (t === "object" && schema.properties) {
    const childReq = new Set(schema.required ?? []);
    const childKeys = orderedKeys(schema, hints);
    return (
      <fieldset className="rounded-md border border-cortai-border p-3">
        <legend className="px-1 text-xs font-semibold text-cortai-text2">{label}</legend>
        <div className="grid gap-3">
          {childKeys.map((k) => (
            <Field
              key={k}
              name={`${name}.${k}`}
              schema={schema.properties![k]}
              hints={hints}
              locale={locale}
              form={form}
              required={childReq.has(k)}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  // Array → add/remove list
  if (t === "array") {
    return (
      <ArrayField
        name={name}
        schema={schema}
        hints={hints}
        locale={locale}
        form={form}
        label={label}
        required={required}
        readOnly={!!readOnly}
      />
    );
  }

  // Boolean → checkbox
  if (t === "boolean") {
    return (
      <label className="flex items-center gap-2 text-xs text-cortai-text2">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-cortai-border accent-cortai-teal"
          disabled={readOnly}
          {...form.register(name)}
        />
        <span className="font-medium">
          {label}
          {required && <span className="ml-0.5 text-cortai-red">*</span>}
        </span>
        {error && <span className="ml-2 text-[11px] text-cortai-red">{error}</span>}
      </label>
    );
  }

  // date / datetime-local
  if (t === "string" && (schema.format === "date" || schema.format === "date-time")) {
    return (
      <label className="grid gap-1.5 text-xs text-cortai-text2">
        <span className="font-medium">
          {label}
          {required && <span className="ml-0.5 text-cortai-red">*</span>}
        </span>
        <input
          type={schema.format === "date" ? "date" : "datetime-local"}
          className={baseInput}
          disabled={readOnly}
          {...form.register(name)}
        />
        {error && <span className="text-[11px] text-cortai-red">{error}</span>}
      </label>
    );
  }

  // file
  if (t === "string" && schema.format === "file") {
    return (
      <label className="grid gap-1.5 text-xs text-cortai-text2">
        <span className="font-medium">
          {label}
          {required && <span className="ml-0.5 text-cortai-red">*</span>}
        </span>
        <input
          type="file"
          className={`${baseInput} file:mr-3 file:rounded file:border-0 file:bg-cortai-bg3 file:px-2 file:py-1 file:text-xs file:text-cortai-text`}
          disabled={readOnly}
          {...form.register(name)}
        />
        {error && <span className="text-[11px] text-cortai-red">{error}</span>}
      </label>
    );
  }

  // number / integer
  if (t === "number" || t === "integer") {
    return (
      <label className="grid gap-1.5 text-xs text-cortai-text2">
        <span className="font-medium">
          {label}
          {required && <span className="ml-0.5 text-cortai-red">*</span>}
        </span>
        <input
          type="number"
          step={t === "integer" ? 1 : "any"}
          min={schema.minimum}
          max={schema.maximum}
          placeholder={placeholder}
          className={baseInput}
          disabled={readOnly}
          {...form.register(name, { valueAsNumber: true })}
        />
        {error && <span className="text-[11px] text-cortai-red">{error}</span>}
      </label>
    );
  }

  // Default: string (text / email / url / textarea by maxLength)
  const inputType =
    schema.format === "email"
      ? "email"
      : schema.format === "uri"
        ? "url"
        : "text";

  if (schema.maxLength !== undefined && schema.maxLength > 200) {
    return (
      <label className="grid gap-1.5 text-xs text-cortai-text2">
        <span className="font-medium">
          {label}
          {required && <span className="ml-0.5 text-cortai-red">*</span>}
        </span>
        <textarea
          rows={3}
          placeholder={placeholder}
          className={`${baseInput} resize-y`}
          disabled={readOnly}
          {...form.register(name)}
        />
        {error && <span className="text-[11px] text-cortai-red">{error}</span>}
      </label>
    );
  }

  return (
    <label className="grid gap-1.5 text-xs text-cortai-text2">
      <span className="font-medium">
        {label}
        {required && <span className="ml-0.5 text-cortai-red">*</span>}
      </span>
      <input
        type={inputType}
        placeholder={placeholder}
        className={baseInput}
        disabled={readOnly}
        {...form.register(name)}
      />
      {error && <span className="text-[11px] text-cortai-red">{error}</span>}
    </label>
  );
}

// ── Array field ────────────────────────────────────────────────────────────────

function ArrayField({
  name,
  schema,
  hints,
  locale,
  form,
  label,
  required,
  readOnly,
}: {
  name: string;
  schema: JSONSchema;
  hints: UIHints;
  locale?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  label: string;
  required: boolean;
  readOnly: boolean;
}) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name });
  const itemSchema = schema.items ?? { type: "string" };
  const isPrimitive =
    !itemSchema.type ||
    ["string", "number", "integer", "boolean"].includes(primaryType(itemSchema));

  return (
    <fieldset className="rounded-md border border-cortai-border p-3">
      <legend className="px-1 text-xs font-semibold text-cortai-text2">
        {label}
        {required && <span className="ml-0.5 text-cortai-red">*</span>}
      </legend>
      <div className="grid gap-2">
        {fields.map((field, idx) => (
          <div key={field.id} className="flex items-start gap-2">
            <div className="flex-1">
              {isPrimitive ? (
                <Field
                  name={`${name}.${idx}`}
                  schema={itemSchema}
                  hints={hints}
                  locale={locale}
                  form={form}
                  required={false}
                />
              ) : (
                <Field
                  name={`${name}.${idx}`}
                  schema={itemSchema}
                  hints={hints}
                  locale={locale}
                  form={form}
                  required={false}
                />
              )}
            </div>
            {!readOnly && (
              <button
                type="button"
                onClick={() => remove(idx)}
                className="mt-5 text-xs text-cortai-red hover:underline"
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            className="w-fit text-xs"
            onClick={() => append(isPrimitive ? "" : {})}
          >
            + Add item
          </Button>
        )}
      </div>
    </fieldset>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function primaryType(schema: JSONSchema): string {
  if (Array.isArray(schema.type)) {
    return schema.type.find((t) => t !== "null") ?? "string";
  }
  return schema.type ?? "string";
}

function orderedKeys(schema: JSONSchema, hints: UIHints): string[] {
  const keys = Object.keys(schema.properties ?? {});
  const order = hints.order ?? [];
  const ordered = order.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !order.includes(k));
  return [...ordered, ...rest];
}

// ── Public FormRenderer ────────────────────────────────────────────────────────

type FormRendererProps = {
  schema: JSONSchema;
  uiHints?: UIHints;
  locale?: string;
  defaultValues?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  submitLabel?: string;
  disabled?: boolean;
};

export function FormRenderer({
  schema,
  uiHints = {},
  locale,
  defaultValues,
  onSubmit,
  submitLabel = "Submit",
  disabled = false,
}: FormRendererProps) {
  const zodSchema = jsonSchemaToZod(schema);
  const form = useForm({
    resolver: zodResolver(zodSchema),
    defaultValues: defaultValues ?? {},
  });

  const handleSubmit = useCallback(
    async (data: Record<string, unknown>) => {
      await onSubmit(data);
    },
    [onSubmit]
  );

  const reqSet = new Set(schema.required ?? []);
  const keys = orderedKeys(schema, uiHints);
  const props = schema.properties ?? {};

  return (
    <form
      onSubmit={form.handleSubmit(handleSubmit)}
      className="grid gap-4"
      data-testid="form-renderer"
    >
      {keys.map((key) => (
        <Field
          key={key}
          name={key}
          schema={props[key]}
          hints={uiHints}
          locale={locale}
          form={form}
          required={reqSet.has(key)}
        />
      ))}
      <Button
        type="submit"
        disabled={disabled || form.formState.isSubmitting}
        data-testid="form-renderer-submit"
      >
        {form.formState.isSubmitting ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}