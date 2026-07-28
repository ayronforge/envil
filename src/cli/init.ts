import { parse } from "dotenv";

import type { Bucket, SchemaKind } from "./types.ts";

const KNOWN_CLIENT_PREFIXES = [
  "NEXT_PUBLIC_",
  "VITE_",
  "EXPO_PUBLIC_",
  "NUXT_PUBLIC_",
  "PUBLIC_",
] as const;

interface ParsedVariable {
  readonly runtimeKey: string;
  readonly value: string;
}

interface GeneratedVariable {
  readonly bucket: Exclude<Bucket, "shared">;
  readonly logicalKey: string;
  readonly schema: string;
}

function parseDotenv(source: string): ReadonlyArray<ParsedVariable> {
  return Object.entries(parse(source)).map(([runtimeKey, value]) => ({ runtimeKey, value }));
}

function detectClientPrefix(
  variables: ReadonlyArray<ParsedVariable>,
  explicitPrefix: string | undefined,
): string {
  if (explicitPrefix !== undefined) {
    return explicitPrefix;
  }

  const detected = KNOWN_CLIENT_PREFIXES.filter((prefix) =>
    variables.some((variable) => variable.runtimeKey.startsWith(prefix)),
  );
  if (detected.length > 1) {
    throw new Error("Multiple known client prefixes were found; select one with --client-prefix");
  }
  return detected[0] ?? "";
}

function inferSchemaKind(key: string, value: string): SchemaKind {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (lower.startsWith("postgres://") || lower.startsWith("postgresql://")) {
    return "postgresUrl";
  }
  if (lower.startsWith("redis://") || lower.startsWith("rediss://")) {
    return "redisUrl";
  }
  if (lower.startsWith("mongodb://") || lower.startsWith("mongodb+srv://")) {
    return "mongoUrl";
  }
  if (lower.startsWith("mysql://") || lower.startsWith("mysqls://")) {
    return "mysqlUrl";
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return "url";
    }
  } catch {
    // The value is not a URL and falls through to the scalar checks.
  }
  if (["true", "false", "1", "0"].includes(lower)) {
    return "boolean";
  }
  if (/^[+-]?\d+$/.test(normalized)) {
    const numericValue = Number(normalized);
    if (key.toUpperCase().includes("PORT") && numericValue >= 1 && numericValue <= 65535) {
      return "port";
    }
    return "integer";
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) {
    return "number";
  }
  return "requiredString";
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toUpperCase();
  return (
    /(?:^|_)(?:PASSWORD|PASSWD|SECRET|TOKEN)(?:_|$)/.test(normalized) ||
    /(?:^|_)(?:API|PRIVATE|ACCESS|SIGNING|ENCRYPTION)_KEY(?:_|$)/.test(normalized) ||
    /(?:^|_)DATABASE_URL$/.test(normalized)
  );
}

function quoteKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function generateSource(variables: ReadonlyArray<GeneratedVariable>, clientPrefix: string): string {
  const helpers = new Set<string>(["createEnvSync"]);
  for (const variable of variables) {
    const baseSchema = variable.schema.startsWith("redacted(")
      ? variable.schema.slice("redacted(".length, -1)
      : variable.schema;
    helpers.add(baseSchema);
    if (variable.schema.startsWith("redacted(")) {
      helpers.add("redacted");
    }
  }
  const lines = [
    `import { ${[...helpers].sort().join(", ")} } from "@ayronforge/envil";`,
    "",
    "export const env = createEnvSync({",
  ];

  for (const bucket of ["server", "client"] as const) {
    const bucketVariables = variables
      .filter((variable) => variable.bucket === bucket)
      .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey));
    if (bucketVariables.length === 0) {
      continue;
    }
    lines.push(`  ${bucket}: {`);
    for (const variable of bucketVariables) {
      lines.push(`    ${quoteKey(variable.logicalKey)}: ${variable.schema},`);
    }
    lines.push("  },", "");
  }

  if (clientPrefix.length > 0) {
    lines.push("  prefix: {", `    client: ${JSON.stringify(clientPrefix)},`, "  },");
  } else if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  lines.push("});", "");
  return lines.join("\n");
}

/** Generates the safe default `env.ts` starter. */
export function generateDefaultEnvSource(): string {
  return [
    'import { createEnvSync, redacted, url } from "@ayronforge/envil";',
    "",
    "export const env = createEnvSync({",
    "  server: {",
    "    DATABASE_URL: redacted(url),",
    "  },",
    "",
    "  client: {",
    "    APP_URL: url,",
    "  },",
    "",
    "  prefix: {",
    '    client: "VITE_",',
    "  },",
    "});",
    "",
  ].join("\n");
}

/**
 * Generates an environment definition from dotenv values held only in memory.
 */
export function generateEnvSourceFromDotenv(source: string, explicitClientPrefix?: string): string {
  const parsed = parseDotenv(source);
  const clientPrefix = detectClientPrefix(parsed, explicitClientPrefix);
  const variables = parsed.map((variable): GeneratedVariable => {
    const isClient = clientPrefix.length > 0 && variable.runtimeKey.startsWith(clientPrefix);
    const logicalKey = isClient
      ? variable.runtimeKey.slice(clientPrefix.length)
      : variable.runtimeKey;
    if (logicalKey.length === 0) {
      throw new Error("A client-prefixed dotenv key has no logical name");
    }
    const kind = inferSchemaKind(variable.runtimeKey, variable.value);
    const schema = !isClient && isSensitiveKey(logicalKey) ? `redacted(${kind})` : kind;
    return {
      bucket: isClient ? "client" : "server",
      logicalKey,
      schema,
    };
  });
  const logicalKeys = new Set<string>();
  for (const variable of variables) {
    if (logicalKeys.has(variable.logicalKey)) {
      throw new Error(
        `Logical environment key "${variable.logicalKey}" would be generated in more than one bucket`,
      );
    }
    logicalKeys.add(variable.logicalKey);
  }

  return generateSource(variables, clientPrefix);
}
