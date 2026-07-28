import { Either, Option, Redacted, Schema } from "effect";

import {
  ClientAccessError,
  EnvConfigurationError,
  EnvValidationError,
  type EnvValidationIssue,
} from "../errors.ts";
import { resolvePrefixMap } from "../prefix.ts";
import { getSchemaIdentifier, isRedactedSchema } from "../schema-metadata.ts";
import type { AnyEnv, EnvOptions, PrefixMap, SchemaDict } from "../types.ts";

interface EnvMeta {
  readonly serverKeys: ReadonlySet<string>;
  readonly clientKeys: ReadonlySet<string>;
  readonly sharedKeys: ReadonlySet<string>;
}

interface AggregatedKeys {
  readonly serverKeys: Set<string>;
  readonly clientKeys: Set<string>;
  readonly sharedKeys: Set<string>;
}

type EnvCategory = keyof Required<PrefixMap>;

/** Erased options consumed by the internal environment runtime. */
export type RuntimeOptions = EnvOptions<
  SchemaDict,
  SchemaDict,
  SchemaDict,
  readonly AnyEnv[],
  string | PrefixMap | undefined
>;

const envMetaStore = new WeakMap<object, EnvMeta>();

/** Returns whether a value was created by this Envil runtime. */
export function isEnvValue(value: unknown): value is AnyEnv {
  return typeof value === "object" && value !== null && envMetaStore.has(value);
}

function addToSet(target: Set<string>, values: Iterable<string>): void {
  for (const value of values) {
    target.add(value);
  }
}

function getEnvMeta(env: unknown): EnvMeta | undefined {
  if (!isEnvValue(env)) {
    return undefined;
  }

  return envMetaStore.get(env);
}

function normalizeRuntimeEnv(
  runtimeEnv: Readonly<Record<string, string | undefined>>,
  emptyStringAsUndefined: boolean | undefined,
): Readonly<Record<string, string | undefined>> {
  if (!emptyStringAsUndefined) {
    return runtimeEnv;
  }

  return Object.fromEntries(
    Object.entries(runtimeEnv).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
}

function aggregateEnvKeys(
  server: SchemaDict,
  client: SchemaDict,
  shared: SchemaDict,
  extendsEnvs: readonly AnyEnv[],
): AggregatedKeys {
  const serverKeys = new Set<string>(Object.keys(server));
  const clientKeys = new Set<string>(Object.keys(client));
  const sharedKeys = new Set<string>(Object.keys(shared));

  for (const extendedEnv of extendsEnvs) {
    const metadata = getEnvMeta(extendedEnv);
    if (metadata === undefined) {
      continue;
    }
    addToSet(serverKeys, metadata.serverKeys);
    addToSet(clientKeys, metadata.clientKeys);
    addToSet(sharedKeys, metadata.sharedKeys);
  }

  return { serverKeys, clientKeys, sharedKeys };
}

function assertNoLogicalCollisions(keys: AggregatedKeys): void {
  for (const key of keys.serverKeys) {
    if (keys.clientKeys.has(key) || keys.sharedKeys.has(key)) {
      throw new EnvConfigurationError(
        `Environment variable "${key}" is configured in more than one bucket`,
      );
    }
  }

  for (const key of keys.clientKeys) {
    if (keys.sharedKeys.has(key)) {
      throw new EnvConfigurationError(
        `Environment variable "${key}" is configured in more than one bucket`,
      );
    }
  }
}

function assertNoPhysicalCollisions(
  server: SchemaDict,
  client: SchemaDict,
  shared: SchemaDict,
  prefixMap: Required<PrefixMap>,
): void {
  const physicalKeys = new Map<string, string>();

  for (const [bucket, schemas] of [
    ["server", server],
    ["client", client],
    ["shared", shared],
  ] as const) {
    for (const logicalKey of Object.keys(schemas)) {
      const physicalKey = `${prefixMap[bucket]}${logicalKey}`;
      const previous = physicalKeys.get(physicalKey);
      if (previous !== undefined) {
        throw new EnvConfigurationError(
          `Physical environment key "${physicalKey}" is produced by both ${previous} and ${bucket}.${logicalKey}`,
        );
      }
      physicalKeys.set(physicalKey, `${bucket}.${logicalKey}`);
    }
  }
}

function assertNoPublicSecrets(client: SchemaDict, shared: SchemaDict): void {
  for (const [bucket, schemas] of [
    ["client", client],
    ["shared", shared],
  ] as const) {
    for (const [key, schema] of Object.entries(schemas)) {
      if (isRedactedSchema(schema)) {
        throw new EnvConfigurationError(
          `Redacted schema "${key}" cannot be configured in the ${bucket} bucket`,
        );
      }
    }
  }
}

function selectSchemaForRuntime(
  isServer: boolean,
  server: SchemaDict,
  client: SchemaDict,
  shared: SchemaDict,
): SchemaDict {
  return isServer ? { ...server, ...client, ...shared } : { ...client, ...shared };
}

function getKeyCategory(key: string, client: SchemaDict, shared: SchemaDict): EnvCategory {
  if (key in client) {
    return "client";
  }
  if (key in shared) {
    return "shared";
  }
  return "server";
}

function parseSchemaValues(
  schema: SchemaDict,
  options: {
    readonly client: SchemaDict;
    readonly shared: SchemaDict;
    readonly runtimeEnv: Readonly<Record<string, string | undefined>>;
    readonly prefixMap: Required<PrefixMap>;
    readonly resolvedSecrets: ReadonlyMap<string, Option.Option<Redacted.Redacted<string>>>;
  },
): { readonly values: Record<string, unknown>; readonly issues: EnvValidationIssue[] } {
  const values: Record<string, unknown> = {};
  const issues: EnvValidationIssue[] = [];

  for (const [key, validator] of Object.entries(schema)) {
    const category = getKeyCategory(key, options.client, options.shared);
    const runtimeKey = `${options.prefixMap[category]}${key}`;
    const resolvedSecret = category === "server" ? options.resolvedSecrets.get(key) : undefined;
    const rawValue =
      resolvedSecret === undefined
        ? options.runtimeEnv[runtimeKey]
        : Option.match(resolvedSecret, {
            onNone: () => undefined,
            onSome: Redacted.value,
          });
    const parsed = Schema.decodeUnknownEither(validator)(rawValue);

    if (Either.isLeft(parsed)) {
      const schemaIdentifier = getSchemaIdentifier(validator);
      issues.push({
        _tag: rawValue === undefined ? "MissingVariable" : "InvalidVariable",
        key: runtimeKey,
        ...(schemaIdentifier === undefined ? {} : { schemaIdentifier }),
        sensitive: resolvedSecret !== undefined || isRedactedSchema(validator),
      });
      continue;
    }

    const decoded =
      Redacted.isRedacted(parsed.right) && Redacted.value(parsed.right) === undefined
        ? undefined
        : parsed.right;
    values[key] =
      resolvedSecret !== undefined && decoded !== undefined && !Redacted.isRedacted(decoded)
        ? Redacted.make(decoded)
        : decoded;
  }

  return { values, issues };
}

function mergeExtendedEnvs(
  extendsEnvs: readonly AnyEnv[],
  parsedValues: Record<string, unknown>,
): Record<string, unknown> {
  const mergedValues: Record<string, unknown> = {};

  for (const extendedEnv of extendsEnvs) {
    for (const [key, value] of Object.entries(extendedEnv)) {
      mergedValues[key] = value;
    }
  }

  for (const [key, value] of Object.entries(parsedValues)) {
    mergedValues[key] = value;
  }

  return mergedValues;
}

function createClientBlockedKeys(aggregated: AggregatedKeys): Set<string> {
  const blockedKeys = new Set<string>();

  for (const key of aggregated.serverKeys) {
    blockedKeys.add(key);
  }

  return blockedKeys;
}

function createReadOnlyEnv<Output extends AnyEnv>(
  envValues: Record<string, unknown>,
  options: {
    readonly isServer: boolean;
    readonly clientBlockedKeys: ReadonlySet<string>;
  },
): Output {
  const frozenValues = Object.freeze(envValues);
  const env = new Proxy(frozenValues, {
    get(target, property) {
      if (typeof property !== "string") {
        return Reflect.get(target, property);
      }
      if (!options.isServer && options.clientBlockedKeys.has(property)) {
        throw new ClientAccessError(property);
      }

      return Reflect.get(target, property);
    },
    set() {
      throw new TypeError("Environment object is read-only");
    },
    deleteProperty() {
      throw new TypeError("Environment object is read-only");
    },
    defineProperty() {
      throw new TypeError("Environment object is read-only");
    },
  });

  // SAFETY: The schemas were decoded above, the object is immutable, and the
  // EnvContractCarrier field is deliberately phantom and absent at runtime.
  return env as Output;
}

/** Validates, composes, and protects one runtime environment value. */
export function buildEnv(
  options: RuntimeOptions,
  resolvedSecrets: ReadonlyMap<string, Option.Option<Redacted.Redacted<string>>>,
): AnyEnv {
  const extendsEnvs = options.extends ?? [];
  const runtimeEnv = normalizeRuntimeEnv(
    options.runtimeEnv ?? process.env,
    options.emptyStringAsUndefined,
  );
  const isServer = options.isServer ?? typeof window === "undefined";
  const server = options.server ?? {};
  const client = options.client ?? {};
  const shared = options.shared ?? {};
  const aggregated = aggregateEnvKeys(server, client, shared, extendsEnvs);
  const prefixMap = resolvePrefixMap(options.prefix);

  assertNoLogicalCollisions(aggregated);
  assertNoPhysicalCollisions(server, client, shared, prefixMap);
  assertNoPublicSecrets(client, shared);

  for (const key of resolvedSecrets.keys()) {
    if (!(key in server)) {
      throw new EnvConfigurationError(
        `Resolver key "${key}" is not configured in the server bucket`,
      );
    }
  }

  const runtimeSchema = selectSchemaForRuntime(isServer, server, client, shared);
  const { values: parsedValues, issues } = parseSchemaValues(runtimeSchema, {
    client,
    shared,
    runtimeEnv,
    prefixMap,
    resolvedSecrets,
  });

  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  const mergedValues = mergeExtendedEnvs(extendsEnvs, parsedValues);
  const env = createReadOnlyEnv(mergedValues, {
    isServer,
    clientBlockedKeys: createClientBlockedKeys(aggregated),
  });

  envMetaStore.set(env, {
    serverKeys: aggregated.serverKeys,
    clientKeys: aggregated.clientKeys,
    sharedKeys: aggregated.sharedKeys,
  });

  return env;
}
