import { z } from "zod";

export type JSONSchema = {
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
  readOnly?: boolean;
  nullable?: boolean;
  $ref?: string;
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  allOf?: JSONSchema[];
};

function primaryType(schema: JSONSchema): string {
  if (Array.isArray(schema.type)) {
    return schema.type.find((t) => t !== "null") ?? "string";
  }
  return schema.type ?? "string";
}

function isNullable(schema: JSONSchema): boolean {
  if (schema.nullable) return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  return false;
}

function convertProperty(schema: JSONSchema, required: boolean): z.ZodTypeAny {
  let zs: z.ZodTypeAny;

  // enum before type check — applies to any type
  if (schema.enum !== undefined && schema.enum.length > 0) {
    const values = schema.enum as [string, ...string[]];
    zs = z.enum(values);
  } else {
    const t = primaryType(schema);
    switch (t) {
      case "string": {
        let s = z.string();
        if (schema.minLength !== undefined) s = s.min(schema.minLength);
        if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
        if (schema.pattern !== undefined) s = s.regex(new RegExp(schema.pattern));
        if (schema.format === "email") s = s.email();
        if (schema.format === "uri") s = s.url();
        zs = s;
        break;
      }
      case "number":
      case "integer": {
        let n = t === "integer" ? z.number().int() : z.number();
        if (schema.minimum !== undefined) n = n.min(schema.minimum);
        if (schema.maximum !== undefined) n = n.max(schema.maximum);
        zs = n;
        break;
      }
      case "boolean":
        zs = z.boolean();
        break;
      case "array": {
        const items = schema.items ? convertProperty(schema.items, true) : z.unknown();
        let arr = z.array(items);
        if (schema.minItems !== undefined) arr = arr.min(schema.minItems);
        if (schema.maxItems !== undefined) arr = arr.max(schema.maxItems);
        zs = arr;
        break;
      }
      case "object": {
        const shape: Record<string, z.ZodTypeAny> = {};
        const reqSet = new Set(schema.required ?? []);
        for (const [key, child] of Object.entries(schema.properties ?? {})) {
          shape[key] = convertProperty(child, reqSet.has(key));
        }
        zs = z.object(shape);
        break;
      }
      default:
        zs = z.unknown();
    }
  }

  if (isNullable(schema)) zs = zs.nullable();
  if (!required) zs = zs.optional();
  return zs;
}

export function jsonSchemaToZod(schema: JSONSchema): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const reqSet = new Set(schema.required ?? []);
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    shape[key] = convertProperty(child, reqSet.has(key));
  }
  return z.object(shape);
}