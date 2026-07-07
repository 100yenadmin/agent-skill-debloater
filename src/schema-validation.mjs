import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CAPABILITY_LABELS = [
  "read-only",
  "file-write",
  "network",
  "browser",
  "external-posting",
  "api-key-use",
  "customer-data",
  "dangerous"
];

const SCHEMAS_BY_DIR = {
  catalogs: "catalog.schema.json",
  locks: "lock.schema.json",
  overlays: "overlay.schema.json",
  packs: "pack.schema.json"
};

function jsonPointerPath(parent, key) {
  if (parent === "$") return `$.${key}`;
  return `${parent}.${key}`;
}

function describeType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function matchesType(value, expectedType) {
  if (expectedType === "array") return Array.isArray(value);
  if (expectedType === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expectedType === "integer") return Number.isInteger(value);
  if (expectedType === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === expectedType;
}

function validateValue(value, schema, pointer, errors) {
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pointer} must be one of ${schema.enum.join(", ")}`);
    return;
  }

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${pointer} must be ${schema.type}, received ${describeType(value)}`);
    return;
  }

  if (schema.type === "string") {
    if (schema.minLength && value.length < schema.minLength) {
      errors.push(`${pointer} must contain at least ${schema.minLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${pointer} must match ${schema.pattern}`);
    }
    if (schema.format === "uri") {
      try {
        new URL(value);
      } catch {
        errors.push(`${pointer} must be a valid URI`);
      }
    }
  }

  if (schema.type === "integer" && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${pointer} must be >= ${schema.minimum}`);
  }

  if (schema.type === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${pointer} must contain at least ${schema.minItems} items`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          errors.push(`${pointer} must not contain duplicate items`);
          break;
        }
        seen.add(key);
      }
    }
    if (schema.items) {
      value.forEach((item, index) => validateValue(item, schema.items, `${pointer}[${index}]`, errors));
    }
  }

  if (schema.type === "object") {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        errors.push(`${pointer}.${required} is required`);
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        validateValue(child, properties[key], jsonPointerPath(pointer, key), errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${pointer}.${key} is not an allowed property`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validateValue(child, schema.additionalProperties, jsonPointerPath(pointer, key), errors);
      }
    }
  }
}

export function validateJsonWithSchema(value, schema, { label = "JSON artifact" } = {}) {
  const errors = [];
  validateValue(value, schema, "$", errors);
  if (errors.length > 0) {
    const shown = errors.slice(0, 10).join("; ");
    const suffix = errors.length > 10 ? `; and ${errors.length - 10} more` : "";
    throw new Error(`Schema validation failed for ${label}: ${shown}${suffix}`);
  }
}

export async function loadJsonSchema(name, { schemaDir = path.join(repoRoot, "schemas") } = {}) {
  const schemaPath = path.join(schemaDir, name);
  return JSON.parse(await readFile(schemaPath, "utf8"));
}

export async function validateArtifactSchema(value, dir, { label, schemaDir } = {}) {
  const schemaName = SCHEMAS_BY_DIR[dir];
  if (!schemaName) return;
  const schema = await loadJsonSchema(schemaName, { schemaDir });
  validateJsonWithSchema(value, schema, { label });
}

export function schemaNameForDirectory(dir) {
  return SCHEMAS_BY_DIR[dir];
}
