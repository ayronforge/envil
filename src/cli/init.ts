import { parse } from "dotenv";
import { Option, Schema } from "effect";

import {
  boolean,
  integer,
  mongoUrl,
  mysqlUrl,
  number,
  port,
  postgresUrl,
  redisUrl,
  url,
} from "../schemas.ts";

import type { EnvironmentTarget, SchemaKind } from "./types.ts";

const KNOWN_CLIENT_PREFIXES = ["VITE_", "EXPO_PUBLIC_", "PUBLIC_"] as const;
const NUXT_CLIENT_PREFIX = "NUXT_PUBLIC_";
const DATABASE_SCHEMAS = [
  ["postgresUrl", postgresUrl],
  ["redisUrl", redisUrl],
  ["mongoUrl", mongoUrl],
  ["mysqlUrl", mysqlUrl],
] as const;
const DATABASE_URL_SCHEME = /^(?:postgres(?:ql)?|rediss?|mongodb(?:\+srv)?|mysqls?):\/\//i;

interface ParsedVariable {
  readonly runtimeKey: string;
  readonly value: string;
}

interface GeneratedVariable {
  readonly target: EnvironmentTarget;
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
  if (
    explicitPrefix === NUXT_CLIENT_PREFIX ||
    variables.some((variable) => variable.runtimeKey.startsWith(NUXT_CLIENT_PREFIX))
  ) {
    throw new Error(
      `Nuxt is not supported. "${NUXT_CLIENT_PREFIX}" requires Nuxt runtime config instead of a portable environment source.`,
    );
  }
  if (explicitPrefix !== undefined) {
    return explicitPrefix;
  }

  const detected = KNOWN_CLIENT_PREFIXES.filter((prefix) =>
    variables.some((variable) => variable.runtimeKey.startsWith(prefix)),
  );
  if (detected.length > 1) {
    throw new Error(
      `Found multiple client prefixes: ${detected.map((prefix) => `"${prefix}"`).join(", ")}. Use --client-prefix <prefix> to choose one.`,
    );
  }
  return detected[0] ?? "";
}

function inferSchemaKind(key: string, value: string): SchemaKind {
  for (const [kind, schema] of DATABASE_SCHEMAS) {
    if (Option.isSome(Schema.decodeUnknownOption(schema)(value))) {
      return kind;
    }
  }
  if (Option.isSome(Schema.decodeUnknownOption(url)(value))) {
    return "url";
  }
  if (
    key.toUpperCase().includes("PORT") &&
    Option.isSome(Schema.decodeUnknownOption(port)(value))
  ) {
    return "port";
  }
  if (Option.isSome(Schema.decodeUnknownOption(boolean)(value))) {
    return "boolean";
  }
  if (Option.isSome(Schema.decodeUnknownOption(integer)(value))) {
    return "integer";
  }
  if (Option.isSome(Schema.decodeUnknownOption(number)(value))) {
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
  if (key === "__proto__") {
    return `[${JSON.stringify(key)}]`;
  }
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function generateSource(variables: ReadonlyArray<GeneratedVariable>, clientPrefix: string): string {
  const helpers = new Set<string>(["createEnv"]);
  for (const target of ["server", "client"] as const) {
    if (variables.some((variable) => variable.target === target)) {
      helpers.add(target);
    }
  }
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
    "export const appEnv = createEnv(",
  ];

  for (const target of ["client", "server"] as const) {
    const targetVariables = variables
      .filter((variable) => variable.target === target)
      .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey));
    if (targetVariables.length === 0) {
      continue;
    }
    lines.push(`  ${target}(`, "    {");
    for (const variable of targetVariables) {
      lines.push(`      ${quoteKey(variable.logicalKey)}: ${variable.schema},`);
    }
    lines.push("    },");
    if (target === "client" && clientPrefix.length > 0) {
      lines.push("    {", `      prefix: ${JSON.stringify(clientPrefix)},`, "    },");
    }
    lines.push("  ),", "");
  }

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  lines.push(");", "");
  return lines.join("\n");
}

/** Generates the safe default `env.ts` starter. */
export function generateDefaultEnvSource(): string {
  return [
    'import { createEnv, redacted, requiredString, server } from "@ayronforge/envil";',
    "",
    "export const appEnv = createEnv(",
    "  server({",
    "    DATABASE_URL: redacted(requiredString),",
    "  }),",
    ");",
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
      throw new Error(
        `"${variable.runtimeKey}" contains only the client prefix and no variable name. Rename it to include a name, such as "${variable.runtimeKey}API_URL".`,
      );
    }
    const kind = inferSchemaKind(variable.runtimeKey, variable.value);
    const connectionUrl = DATABASE_URL_SCHEME.test(variable.value.trim());
    const schema =
      !isClient && (isSensitiveKey(logicalKey) || connectionUrl) ? `redacted(${kind})` : kind;
    return {
      target: isClient ? "client" : "server",
      logicalKey,
      schema,
    };
  });
  return generateSource(variables, clientPrefix);
}
