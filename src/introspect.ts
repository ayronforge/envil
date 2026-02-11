import { Option, Redacted, Schema, SchemaAST } from "effect";

import { encodeDotenvText } from "./cli/dotenv-codec.ts";
import type { Bucket, SchemaKind } from "./cli/types.ts";
import {
  DEFAULT_VALUE_ANNOTATION,
  OPTIONAL_ANNOTATION,
  PLACEHOLDER_ANNOTATION,
  REDACTED_ANNOTATION,
  SCHEMA_KIND_ANNOTATION,
  STRING_ENUM_VALUES_ANNOTATION,
} from "./schemas.ts";
import type { SchemaDict } from "./types.ts";

const BUCKETS = ["server", "client", "shared"] as const;

interface EnvDefinition {
  prefix?: { server?: string; client?: string; shared?: string };
  server?: SchemaDict;
  client?: SchemaDict;
  shared?: SchemaDict;
}

export interface ExaminedSchema {
  readonly kind: SchemaKind | undefined;
  readonly placeholder: string | undefined;
  readonly optional: boolean;
  readonly hasDefault: boolean;
  readonly defaultValue: unknown;
  readonly redacted: boolean;
  readonly stringEnumValues?: readonly string[];
}

function getAnn<T>(ast: SchemaAST.Annotated, key: symbol): T | undefined {
  return Option.getOrUndefined(SchemaAST.getAnnotation<T>(ast, key));
}

export function examineSchema(schema: Schema.Schema.Any): ExaminedSchema {
  let ast: SchemaAST.AST = schema.ast;
  let isRedacted = false;
  let isOptional = false;
  let hasDefault = false;
  let defaultValue: unknown = undefined;

  // Peel redacted layer (outermost Transformation with REDACTED_ANNOTATION)
  if (SchemaAST.isTransformation(ast) && getAnn<boolean>(ast, REDACTED_ANNOTATION)) {
    isRedacted = true;
    ast = ast.from;
  }

  // Peel withDefault layer (Transformation with DEFAULT_VALUE_ANNOTATION)
  if (SchemaAST.isTransformation(ast) && getAnn(ast, DEFAULT_VALUE_ANNOTATION) !== undefined) {
    hasDefault = true;
    defaultValue = getAnn(ast, DEFAULT_VALUE_ANNOTATION);
    // withDefault wraps UndefinedOr(schema) -> schema, `from` is the Union
    const fromAst = ast.from;
    if (SchemaAST.isUnion(fromAst)) {
      const nonUndefined = fromAst.types.find((t) => !SchemaAST.isUndefinedKeyword(t));
      if (nonUndefined) ast = nonUndefined;
    }
  }

  // Peel optional layer (Union with OPTIONAL_ANNOTATION)
  if (SchemaAST.isUnion(ast) && getAnn<boolean>(ast, OPTIONAL_ANNOTATION)) {
    isOptional = true;
    const nonUndefined = ast.types.find((t) => !SchemaAST.isUndefinedKeyword(t));
    if (nonUndefined) ast = nonUndefined;
  }

  const kind = getAnn<SchemaKind>(ast, SCHEMA_KIND_ANNOTATION);
  const placeholder = getAnn<string>(ast, PLACEHOLDER_ANNOTATION);
  const stringEnumValues =
    kind === "stringEnum"
      ? getAnn<readonly string[]>(ast, STRING_ENUM_VALUES_ANNOTATION)
      : undefined;

  return {
    kind,
    placeholder,
    optional: isOptional,
    hasDefault,
    defaultValue,
    redacted: isRedacted,
    stringEnumValues,
  };
}

export function buildEnvExample(definition: EnvDefinition): string {
  const prefix = {
    server: definition.prefix?.server ?? "",
    client: definition.prefix?.client ?? "",
    shared: definition.prefix?.shared ?? "",
  };

  const entries = [];
  let line = 1;

  for (const bucket of BUCKETS) {
    const schemas = definition[bucket] ?? {};
    const keys = Object.keys(schemas).sort();

    for (const key of keys) {
      const schema = schemas[key];
      const examined = examineSchema(schema);
      const runtimeKey = `${prefix[bucket]}${key}`;

      let value: string;
      if (examined.hasDefault) {
        value = encodeDefault(schema, examined);
      } else {
        value = examined.placeholder ?? "CHANGE_ME";
      }

      entries.push({
        key: runtimeKey,
        value,
        line,
        sectionBucket: bucket as Bucket,
        directives: {
          type: examined.kind,
          bucket: bucket as Bucket,
          optional: examined.optional,
          hasDefault: examined.hasDefault,
          redacted: examined.redacted,
          stringEnumValues: examined.stringEnumValues,
        },
      });
      line += 1;
    }
  }

  const hasPrefix = Object.values(prefix).some((v) => v.length > 0);
  return encodeDotenvText({ entries, ...(hasPrefix ? { prefix } : {}) });
}

function encodeDefault(schema: Schema.Schema.Any, examined: ExaminedSchema): string {
  // Encode the default value back to its string representation using the
  // schema's encode direction. For redacted schemas we wrap in Redacted first.
  try {
    let valueToEncode = examined.defaultValue;
    if (examined.redacted) {
      valueToEncode = Redacted.make(valueToEncode);
    }
    const encoded = Schema.encodeSync(schema as Schema.Schema<unknown, unknown, never>)(
      valueToEncode,
    );
    return String(encoded ?? "");
  } catch {
    return stringifyDefault(examined);
  }
}

function stringifyDefault(examined: ExaminedSchema): string {
  const val = examined.defaultValue;
  if (val === undefined || val === null) return "";
  if (Array.isArray(val)) return val.map(String).join(",");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
