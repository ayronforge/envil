import type {
  DotenvDocument,
  InferredModel,
  InferredVariable,
  PrefixConfig,
  SchemaKind,
} from "./types.ts";

interface InferOptions {
  readonly prefix: PrefixConfig;
}

const STRING_KINDS = new Set<SchemaKind>([
  "requiredString",
  "url",
  "postgresUrl",
  "redisUrl",
  "mongoUrl",
  "mysqlUrl",
]);

const BUCKET_ORDER: Record<InferredVariable["bucket"], number> = {
  server: 0,
  client: 1,
  shared: 2,
};

export function inferModel(document: DotenvDocument, options: InferOptions): InferredModel {
  const runtimeEnv: Record<string, string | undefined> = {};
  const inferredVariables: InferredVariable[] = [];

  for (const entry of document.entries) {
    runtimeEnv[entry.key] = entry.value;
    const { bucket, schemaKey } = resolveBucketAndSchemaKey(entry.key, options.prefix, {
      explicitBucket: entry.directives.bucket,
      sectionBucket: entry.sectionBucket,
    });

    const resolvedKind = entry.directives.type ?? inferSchemaKind(entry.key, entry.value);
    const hasValue = entry.value.trim().length > 0;
    const hasDefault = entry.directives.hasDefault === false ? false : hasValue;
    const defaultValue = hasDefault ? normalizeDefaultValue(resolvedKind, entry.value) : undefined;
    const optionalFlag = entry.directives.optional ?? false;
    const redactedFlag = entry.directives.redacted ?? false;

    const duplicate = inferredVariables.find(
      (candidate) => candidate.bucket === bucket && candidate.schemaKey === schemaKey,
    );
    if (duplicate) {
      throw new Error(
        `Duplicate schema key "${schemaKey}" in bucket "${bucket}" at line ${entry.line}.`,
      );
    }

    inferredVariables.push({
      schemaKey,
      runtimeKey: entry.key,
      bucket,
      kind: resolvedKind,
      optional: optionalFlag,
      hasDefault,
      defaultValue,
      redacted: redactedFlag,
      sourceLine: entry.line,
      stringEnumValues: entry.directives.stringEnumValues,
    });
  }

  inferredVariables.sort((left, right) => {
    const bucketOrder = BUCKET_ORDER[left.bucket] - BUCKET_ORDER[right.bucket];
    if (bucketOrder !== 0) return bucketOrder;
    return left.schemaKey.localeCompare(right.schemaKey);
  });

  return {
    prefix: options.prefix,
    variables: inferredVariables,
    runtimeEnv,
  };
}

function resolveBucketAndSchemaKey(
  runtimeKey: string,
  prefix: PrefixConfig,
  options: {
    explicitBucket?: InferredVariable["bucket"];
    sectionBucket?: InferredVariable["bucket"];
  },
): { bucket: InferredVariable["bucket"]; schemaKey: string } {
  const explicitBucket = options.explicitBucket ?? options.sectionBucket;
  if (explicitBucket) {
    return {
      bucket: explicitBucket,
      schemaKey: stripPrefix(runtimeKey, prefix[explicitBucket]),
    };
  }

  const inferredFromPrefix = inferBucketFromPrefix(runtimeKey, prefix);
  if (inferredFromPrefix) {
    return inferredFromPrefix;
  }

  return {
    bucket: "server",
    schemaKey: runtimeKey,
  };
}

function inferBucketFromPrefix(
  runtimeKey: string,
  prefix: PrefixConfig,
): { bucket: InferredVariable["bucket"]; schemaKey: string } | undefined {
  const candidates = [
    { bucket: "client", prefix: prefix.client },
    { bucket: "server", prefix: prefix.server },
    { bucket: "shared", prefix: prefix.shared },
  ]
    .filter((candidate) => candidate.prefix.length > 0 && runtimeKey.startsWith(candidate.prefix))
    .sort((left, right) => right.prefix.length - left.prefix.length) as Array<{
    bucket: InferredVariable["bucket"];
    prefix: string;
  }>;

  const best = candidates[0];
  if (!best) return undefined;

  return {
    bucket: best.bucket,
    schemaKey: stripPrefix(runtimeKey, best.prefix),
  };
}

function stripPrefix(key: string, prefix: string): string {
  if (!prefix || !key.startsWith(prefix)) {
    return key;
  }

  const stripped = key.slice(prefix.length);
  return stripped.length > 0 ? stripped : key;
}

function inferSchemaKind(key: string, rawValue: string): SchemaKind {
  const value = rawValue.trim();
  const lowerValue = value.toLowerCase();
  const upperKey = key.toUpperCase();

  if (isJsonCandidate(value)) {
    return "json";
  }

  if (lowerValue.startsWith("postgres://") || lowerValue.startsWith("postgresql://")) {
    return "postgresUrl";
  }
  if (lowerValue.startsWith("redis://") || lowerValue.startsWith("rediss://")) {
    return "redisUrl";
  }
  if (lowerValue.startsWith("mongodb://") || lowerValue.startsWith("mongodb+srv://")) {
    return "mongoUrl";
  }
  if (lowerValue.startsWith("mysql://") || lowerValue.startsWith("mysqls://")) {
    return "mysqlUrl";
  }

  if (isCommaSeparatedCandidate(value)) {
    const parts = splitCommaValues(value);
    if (parts.length > 0 && parts.every((part) => isIntegerString(part) || isNumberString(part))) {
      return "commaSeparatedNumbers";
    }
    if (parts.length > 0 && parts.every((part) => isHttpUrl(part))) {
      return "commaSeparatedUrls";
    }
    return "commaSeparated";
  }

  if (isHttpUrl(value)) {
    return "url";
  }

  if (isBooleanString(lowerValue)) {
    return "boolean";
  }

  if (isIntegerString(value)) {
    const numberValue = Number(value);
    if (upperKey.includes("PORT") && numberValue >= 1 && numberValue <= 65535) {
      return "port";
    }
    return "integer";
  }

  if (isNumberString(value)) {
    return "number";
  }

  return "requiredString";
}

function isBooleanString(value: string): boolean {
  return value === "true" || value === "false" || value === "1" || value === "0";
}

function isIntegerString(value: string): boolean {
  return /^[+-]?\d+$/.test(value);
}

function isNumberString(value: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isCommaSeparatedCandidate(value: string): boolean {
  return value.includes(",") && !value.startsWith("{") && !value.startsWith("[");
}

function splitCommaValues(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function isJsonCandidate(value: string): boolean {
  const trimmed = value.trim();
  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return false;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function normalizeDefaultValue(kind: SchemaKind, value: unknown): unknown {
  if (kind === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.toLowerCase();
      return normalized === "true" || normalized === "1";
    }
    return Boolean(value);
  }

  if (kind === "integer") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.trunc(numeric);
  }

  if (kind === "number") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  if (kind === "port") {
    const numeric = Math.trunc(Number(value));
    if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 65535) {
      return numeric;
    }
    return 3000;
  }

  if (kind === "commaSeparated") {
    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }
    if (typeof value === "string") {
      return splitCommaValues(value);
    }
    return [String(value ?? "")];
  }

  if (kind === "commaSeparatedNumbers") {
    if (Array.isArray(value)) {
      return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
    }
    if (typeof value === "string") {
      return splitCommaValues(value)
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? [numeric] : [0];
  }

  if (kind === "commaSeparatedUrls") {
    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }
    if (typeof value === "string") {
      return splitCommaValues(value);
    }
    return [String(value ?? "https://example.com")];
  }

  if (kind === "json") {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    }
    return value ?? {};
  }

  if (kind === "stringEnum") {
    return String(value ?? "");
  }

  if (STRING_KINDS.has(kind)) {
    const stringValue = String(value ?? "");
    return stringValue.length > 0 ? stringValue : "value";
  }

  return value;
}
