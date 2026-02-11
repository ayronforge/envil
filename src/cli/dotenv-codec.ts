import { Schema } from "effect";

import { parseBooleanDirective, toEnvValueLiteral } from "./literals.ts";
import {
  BUCKETS,
  SCHEMA_KINDS,
  type Bucket,
  type DotenvDocument,
  type SchemaKind,
} from "./types.ts";

type MutableDirectives = {
  type?: SchemaKind;
  optional?: boolean;
  hasDefault?: boolean;
  redacted?: boolean;
  bucket?: Bucket;
  stringEnumValues?: readonly string[];
};

const SENTINEL_DIRECTIVE_PREFIX = "@";
const KEY_ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

const DotenvCodec = Schema.transform(Schema.String, Schema.Unknown, {
  decode: (text) => parseDotenvText(String(text)),
  encode: (value) => stringifyDotenvDocument(value as DotenvDocument),
});

export function decodeDotenvText(text: string): DotenvDocument {
  return Schema.decodeUnknownSync(DotenvCodec)(text) as DotenvDocument;
}

export function encodeDotenvText(document: DotenvDocument): string {
  return Schema.encodeSync(DotenvCodec)(document) as string;
}

function parseDotenvText(text: string): DotenvDocument {
  const lines = text.split(/\r?\n/);
  const entries: Array<DotenvDocument["entries"][number]> = [];
  const prefix: Partial<Record<Bucket, string>> = {};
  let activeBucket: Bucket | undefined;
  let pendingDirectives: MutableDirectives = {};

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.startsWith("#")) {
      const comment = trimmed.slice(1).trim();
      if (comment.startsWith(SENTINEL_DIRECTIVE_PREFIX)) {
        const directiveResult = parseDirectiveGroup(comment, lineNumber, pendingDirectives);
        if (directiveResult.sectionBucket) {
          activeBucket = directiveResult.sectionBucket;
          if (directiveResult.sectionPrefix) {
            prefix[directiveResult.sectionBucket] = directiveResult.sectionPrefix;
          }
          pendingDirectives = {};
        } else {
          pendingDirectives = directiveResult.directives;
        }
      }
      continue;
    }

    const assignmentMatch = KEY_ASSIGNMENT_PATTERN.exec(trimmed);
    if (!assignmentMatch) {
      throw new Error(`Malformed assignment at line ${lineNumber}: "${line}"`);
    }

    const key = assignmentMatch[1];
    const rightHandSide = assignmentMatch[2];
    const split = splitValueAndInlineComment(rightHandSide);
    const value = normalizeAssignedValue(split.value.trim());

    let directives = { ...pendingDirectives };
    if (split.comment) {
      const inlineComment = split.comment.trim();
      if (inlineComment.startsWith(SENTINEL_DIRECTIVE_PREFIX)) {
        const parsedInline = parseDirectiveGroup(inlineComment, lineNumber, directives);
        if (parsedInline.sectionBucket) {
          throw new Error(`Section directives are not allowed inline at line ${lineNumber}`);
        }
        directives = parsedInline.directives;
      }
    }

    entries.push({
      key,
      value,
      line: lineNumber,
      sectionBucket: activeBucket,
      directives,
    });
    pendingDirectives = {};
  }

  const hasPrefix = Object.values(prefix).some((v) => v && v.length > 0);
  return { entries, ...(hasPrefix ? { prefix } : {}) };
}

function stringifyDotenvDocument(document: DotenvDocument): string {
  if (!document || !Array.isArray(document.entries)) {
    throw new Error("Invalid dotenv document: expected an entries array");
  }

  const grouped = {
    server: [] as Array<DotenvDocument["entries"][number]>,
    client: [] as Array<DotenvDocument["entries"][number]>,
    shared: [] as Array<DotenvDocument["entries"][number]>,
  };

  const sortedEntries = [...document.entries].sort((left, right) => {
    if (left.line !== right.line) return left.line - right.line;
    return left.key.localeCompare(right.key);
  });

  for (const entry of sortedEntries) {
    const bucket: Bucket = entry.directives.bucket ?? entry.sectionBucket ?? "server";
    grouped[bucket].push(entry);
  }

  const lines: string[] = [];

  for (const bucket of BUCKETS) {
    const pfx = document.prefix?.[bucket];
    lines.push(pfx && pfx.length > 0 ? `# @${bucket} ${pfx}` : `# @${bucket}`);
    lines.push("");

    for (const entry of grouped[bucket]) {
      const optional = entry.directives.optional ?? false;
      const redacted = entry.directives.redacted ?? false;
      const noDefault = entry.directives.hasDefault === false;

      if (entry.directives.type === "stringEnum" && entry.directives.stringEnumValues) {
        lines.push(`# @type enum ${entry.directives.stringEnumValues.join(",")}`);
      }
      if (optional) lines.push("# @optional");
      if (noDefault) lines.push("# @no-default");
      if (redacted) lines.push("# @redacted");
      lines.push(`${entry.key}=${serializeEnvValue(entry.value)}`);
      lines.push("");
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return `${lines.join("\n")}\n`;
}

function splitValueAndInlineComment(value: string): { value: string; comment?: string } {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "#") {
      return {
        value: value.slice(0, index).trimEnd(),
        comment: value.slice(index + 1),
      };
    }
  }

  return { value };
}

function parseDirectiveGroup(
  directiveText: string,
  lineNumber: number,
  base: MutableDirectives,
): { directives: MutableDirectives; sectionBucket?: Bucket; sectionPrefix?: string } {
  const directives = { ...base };
  const tokens = directiveText
    .split(/\s+(?=@)/g)
    .map((token) => token.trim())
    .filter(Boolean);

  let sectionBucket: Bucket | undefined;
  let sectionPrefix: string | undefined;
  for (const token of tokens) {
    const parsed = parseDirectiveToken(token, lineNumber);
    if ("type" in parsed) directives.type = parsed.type;
    if ("optional" in parsed) directives.optional = parsed.optional;
    if ("hasDefault" in parsed) directives.hasDefault = parsed.hasDefault;
    if ("redacted" in parsed) directives.redacted = parsed.redacted;
    if ("bucket" in parsed) directives.bucket = parsed.bucket;
    if ("stringEnumValues" in parsed) directives.stringEnumValues = parsed.stringEnumValues;
    if ("sectionBucket" in parsed) sectionBucket = parsed.sectionBucket;
    if ("sectionPrefix" in parsed) sectionPrefix = parsed.sectionPrefix;
  }

  return { directives, sectionBucket, sectionPrefix };
}

function parseDirectiveToken(
  token: string,
  lineNumber: number,
): MutableDirectives & { sectionBucket?: Bucket; sectionPrefix?: string } {
  if (!token.startsWith("@")) {
    throw new Error(`Malformed directive at line ${lineNumber}: "${token}"`);
  }

  const spaceIndex = token.indexOf(" ");
  const name = (spaceIndex === -1 ? token.slice(1) : token.slice(1, spaceIndex)).trim();
  const value = (spaceIndex === -1 ? "" : token.slice(spaceIndex + 1)).trim();

  if (name === "server" || name === "client" || name === "shared") {
    return value.length > 0
      ? { sectionBucket: name, sectionPrefix: value }
      : { sectionBucket: name };
  }

  if (name === "type") {
    if (value.length === 0) {
      throw new Error(`Directive "@type" requires a value at line ${lineNumber}`);
    }
    if (value === "enum" || value.startsWith("enum ")) {
      const raw = value.slice(4).trim();
      if (raw.length === 0) {
        throw new Error(
          `Directive "@type enum" requires comma-separated values at line ${lineNumber}`,
        );
      }
      const stringEnumValues = raw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (stringEnumValues.length === 0) {
        throw new Error(`Directive "@type enum" requires at least one value at line ${lineNumber}`);
      }
      return { type: "stringEnum", stringEnumValues };
    }
    return { type: parseSchemaKind(value, lineNumber) };
  }

  if (name === "optional") {
    return { optional: parseBooleanDirective(value || undefined, true) };
  }

  if (name === "no-default") {
    return { hasDefault: false };
  }

  if (name === "redacted") {
    return { redacted: parseBooleanDirective(value || undefined, true) };
  }

  if (name === "bucket") {
    if (value.length === 0) {
      throw new Error(`Directive "@bucket" requires a value at line ${lineNumber}`);
    }
    if (!isBucket(value)) {
      throw new Error(`Invalid bucket "${value}" at line ${lineNumber}`);
    }
    return { bucket: value };
  }

  throw new Error(`Unknown directive "@${name}" at line ${lineNumber}`);
}

function parseSchemaKind(rawValue: string, lineNumber: number): SchemaKind {
  const normalized = rawValue.trim().toLowerCase();
  const aliasMap: Record<string, SchemaKind> = {
    string: "requiredString",
    requiredstring: "requiredString",
    bool: "boolean",
    boolean: "boolean",
    int: "integer",
    integer: "integer",
    number: "number",
    port: "port",
    url: "url",
    postgresurl: "postgresUrl",
    redisurl: "redisUrl",
    mongourl: "mongoUrl",
    mysqlurl: "mysqlUrl",
    commaseparated: "commaSeparated",
    commaseparatednumbers: "commaSeparatedNumbers",
    commaseparatedurls: "commaSeparatedUrls",
    json: "json",
    "json(schema.unknown)": "json",
  };

  const resolved = aliasMap[normalized];
  if (!resolved || !SCHEMA_KINDS.includes(resolved)) {
    throw new Error(`Invalid @type value "${rawValue}" at line ${lineNumber}`);
  }

  return resolved;
}

function normalizeAssignedValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function serializeEnvValue(value: string): string {
  const literal = toEnvValueLiteral(value);
  if (literal.length === 0) return "";

  if (/[\s#]/.test(literal)) {
    return JSON.stringify(literal);
  }

  return literal;
}

function isBucket(value: string): value is Bucket {
  return BUCKETS.includes(value as Bucket);
}
