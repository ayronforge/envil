import { toCodeLiteral } from "./literals.ts";
import type { InferredModel, SchemaKind } from "./types.ts";

const BUCKET_ORDER = ["server", "client", "shared"] as const;

type Bucket = (typeof BUCKET_ORDER)[number];

interface RenderedVariable {
  readonly key: string;
  readonly expression: string;
}

export function generateEnvTs(model: InferredModel): string {
  const sortedVariables = [...model.variables].sort((left, right) => {
    if (left.bucket !== right.bucket) return left.bucket.localeCompare(right.bucket);
    return left.schemaKey.localeCompare(right.schemaKey);
  });

  const grouped: Record<Bucket, RenderedVariable[]> = {
    server: [],
    client: [],
    shared: [],
  };

  const helperImports = new Set<string>(["createEnv"]);
  let needsSchemaImport = false;

  for (const variable of sortedVariables) {
    const rendered = renderSchemaExpression(variable.kind, {
      optional: variable.optional,
      hasDefault: variable.hasDefault,
      defaultValue: variable.defaultValue,
      redacted: variable.redacted,
      stringEnumValues: variable.stringEnumValues,
    });
    for (const helper of rendered.helpers) {
      helperImports.add(helper);
    }
    needsSchemaImport ||= rendered.needsSchemaImport;

    grouped[variable.bucket].push({
      key: quoteObjectKey(variable.schemaKey),
      expression: rendered.expression,
    });
  }

  const importLine = `import { ${[...helperImports].sort().join(", ")} } from "@ayronforge/envil";`;
  const schemaImportLine = needsSchemaImport ? `import { Schema } from "effect";` : "";

  const sourceLines = [
    importLine,
    schemaImportLine,
    "",
    "export const envDefinition = {",
    "  prefix: {",
    `    server: ${JSON.stringify(model.prefix.server)},`,
    `    client: ${JSON.stringify(model.prefix.client)},`,
    `    shared: ${JSON.stringify(model.prefix.shared)},`,
    "  },",
    "  server: {",
    ...renderBucketEntries(grouped.server),
    "  },",
    "  client: {",
    ...renderBucketEntries(grouped.client),
    "  },",
    "  shared: {",
    ...renderBucketEntries(grouped.shared),
    "  },",
    "} as const;",
    "",
    "export const env = createEnv(envDefinition);",
    "",
  ];

  return sourceLines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
}

function renderBucketEntries(entries: ReadonlyArray<RenderedVariable>): string[] {
  if (entries.length === 0) {
    return [];
  }

  return entries.map((entry) => `    ${entry.key}: ${entry.expression},`);
}

function renderSchemaExpression(
  kind: SchemaKind,
  wrappers: {
    optional: boolean;
    hasDefault: boolean;
    defaultValue: unknown;
    redacted: boolean;
    stringEnumValues?: readonly string[];
  },
): { expression: string; helpers: Set<string>; needsSchemaImport: boolean } {
  let expression = kind === "stringEnum" && wrappers.stringEnumValues
    ? `stringEnum([${wrappers.stringEnumValues.map((v) => JSON.stringify(v)).join(", ")}])`
    : (SPECIAL_EXPRESSIONS[kind] ?? kind);
  const helpers = new Set<string>([kind]);
  const needsSchemaImport = kind === "json";

  if (wrappers.optional && !wrappers.hasDefault) {
    expression = `optional(${expression})`;
    helpers.add("optional");
  }

  if (wrappers.hasDefault) {
    expression = `withDefault(${expression}, ${toCodeLiteral(wrappers.defaultValue)})`;
    helpers.add("withDefault");
  }

  if (wrappers.redacted) {
    expression = `redacted(${expression})`;
    helpers.add("redacted");
  }

  return { expression, helpers, needsSchemaImport };
}

const SPECIAL_EXPRESSIONS: Partial<Record<SchemaKind, string>> = {
  json: "json(Schema.Unknown)",
  stringEnum: "stringEnum([])",
};

function quoteObjectKey(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}
