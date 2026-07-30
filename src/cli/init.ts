import { parse } from "dotenv";

import type { EnvironmentTarget, SchemaKind } from "./types.ts";

const KNOWN_CLIENT_PREFIXES = ["VITE_", "EXPO_PUBLIC_", "PUBLIC_"] as const;
const NUXT_CLIENT_PREFIX = "NUXT_PUBLIC_";

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
    ...(clientPrefix === "EXPO_PUBLIC_"
      ? ['import { expo } from "@ayronforge/envil/presets";']
      : []),
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
    if (target === "client") {
      if (clientPrefix === "EXPO_PUBLIC_") {
        lines.push("    expo,");
      } else {
        const runtimeExpression =
          clientPrefix === "VITE_" || clientPrefix === "PUBLIC_"
            ? "import.meta.env"
            : "process.env";
        lines.push("    {", `      runtimeEnv: ${runtimeExpression},`);
        if (clientPrefix.length > 0) {
          lines.push(`      prefix: ${JSON.stringify(clientPrefix)},`);
        }
        lines.push("    },");
      }
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
    'import { client, createEnv, redacted, requiredString, server, url } from "@ayronforge/envil";',
    "",
    "export const appEnv = createEnv(",
    "  server({",
    "    DATABASE_URL: redacted(requiredString),",
    "  }),",
    "",
    "  client(",
    "    {",
    "      APP_URL: url,",
    "    },",
    "    {",
    "      runtimeEnv: import.meta.env,",
    '      prefix: "VITE_",',
    "    },",
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
    const connectionUrl =
      kind === "postgresUrl" || kind === "redisUrl" || kind === "mongoUrl" || kind === "mysqlUrl";
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
