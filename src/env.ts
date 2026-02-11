import { Effect, Either, ParseResult, Redacted, Schema } from "effect";

import { ClientAccessError, EnvValidationError } from "./errors.ts";
import { resolvePrefixMap } from "./prefix.ts";
import type { ResolverError, ResolverResult } from "./resolvers/types.ts";
import type {
  AnyEnv,
  EnvOptions,
  EnvResult,
  EnvResultAutoRedacted,
  ExtractResolverKeys,
  InternalEnvOptions,
  PrefixMap,
  PrefixStr,
  SchemaDict,
} from "./types.ts";

interface EnvMeta {
  readonly serverKeys: ReadonlySet<string>;
  readonly clientKeys: ReadonlySet<string>;
  readonly sharedKeys: ReadonlySet<string>;
}

interface AggregatedKeys {
  serverKeys: Set<string>;
  clientKeys: Set<string>;
  sharedKeys: Set<string>;
}

const envMetaStore = new WeakMap<object, EnvMeta>();

type EnvCategory = keyof Required<PrefixMap>;

function addToSet(target: Set<string>, values: Iterable<string>) {
  for (const value of values) {
    target.add(value);
  }
}

function getEnvMeta(env: unknown): EnvMeta | undefined {
  if (typeof env !== "object" || env === null) {
    return undefined;
  }

  return envMetaStore.get(env);
}

function normalizeRuntimeEnv(
  runtimeEnv: Record<string, string | undefined>,
  emptyStringAsUndefined: boolean | undefined,
): Record<string, string | undefined> {
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

  for (const ext of extendsEnvs) {
    const meta = getEnvMeta(ext);
    if (!meta) continue;
    addToSet(serverKeys, meta.serverKeys);
    addToSet(clientKeys, meta.clientKeys);
    addToSet(sharedKeys, meta.sharedKeys);
  }

  return { serverKeys, clientKeys, sharedKeys };
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
  if (key in client) return "client";
  if (key in shared) return "shared";
  return "server";
}

function parseSchemaValues(
  schema: SchemaDict,
  options: {
    client: SchemaDict;
    shared: SchemaDict;
    runtimeEnv: Record<string, string | undefined>;
    prefixMap: Required<PrefixMap>;
    autoRedactKeys?: ReadonlySet<string>;
  },
): { values: Record<string, unknown>; errors: string[] } {
  const values: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [key, validator] of Object.entries(schema)) {
    const category = getKeyCategory(key, options.client, options.shared);
    const envKey = `${options.prefixMap[category]}${key}`;
    const rawValue = options.runtimeEnv[envKey];
    const parsed = Schema.decodeUnknownEither(validator)(rawValue);

    if (Either.isLeft(parsed)) {
      const detail = ParseResult.TreeFormatter.formatErrorSync(parsed.left);
      errors.push(`${envKey}: ${detail}`);
      continue;
    }

    let finalValue = parsed.right;
    if (options.autoRedactKeys?.has(envKey) && !Redacted.isRedacted(finalValue)) {
      finalValue = Redacted.make(finalValue);
    }

    values[key] = finalValue;
  }

  return { values, errors };
}

function raiseValidationErrors(
  errors: string[],
  onValidationError?: (errors: string[]) => void,
): void {
  if (errors.length === 0) {
    return;
  }

  if (onValidationError) {
    try {
      onValidationError(errors);
    } catch (error) {
      throw error instanceof EnvValidationError ? error : new EnvValidationError([String(error)]);
    }
  }

  throw new EnvValidationError(errors);
}

function mergeExtendedEnvs(
  extendsEnvs: readonly AnyEnv[],
  parsedValues: Record<string, unknown>,
): Record<string, unknown> {
  const mergedValues: Record<string, unknown> = {};

  for (const ext of extendsEnvs) {
    for (const [key, value] of Object.entries(ext)) {
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
    if (!aggregated.clientKeys.has(key) && !aggregated.sharedKeys.has(key)) {
      blockedKeys.add(key);
    }
  }

  return blockedKeys;
}

function createReadOnlyEnv<T extends AnyEnv>(
  envValues: Record<string, unknown>,
  options: {
    isServer: boolean;
    clientBlockedKeys: ReadonlySet<string>;
  },
): T {
  const frozenValues = Object.freeze(envValues);

  return new Proxy(frozenValues, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (!options.isServer && options.clientBlockedKeys.has(prop)) {
        throw new ClientAccessError(prop);
      }

      return Reflect.get(target, prop);
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
  }) as T;
}

function buildEnv<
  TServer extends SchemaDict = {},
  TClient extends SchemaDict = {},
  TShared extends SchemaDict = {},
  const TExtends extends readonly AnyEnv[] = readonly [],
>(
  opts: InternalEnvOptions<TServer, TClient, TShared, TExtends>,
): EnvResult<TExtends, TServer, TClient, TShared> {
  const extendsEnvs = opts.extends ?? [];
  const runtimeEnv = normalizeRuntimeEnv(
    opts.runtimeEnv ?? process.env,
    opts.emptyStringAsUndefined,
  );
  const isServer = opts.isServer ?? typeof window === "undefined";

  const server = opts.server ?? ({} as TServer);
  const client = opts.client ?? ({} as TClient);
  const shared = opts.shared ?? ({} as TShared);

  const aggregated = aggregateEnvKeys(server, client, shared, extendsEnvs);
  const prefixMap = resolvePrefixMap(opts.prefix);
  const runtimeSchema = selectSchemaForRuntime(isServer, server, client, shared);
  const { values: parsedValues, errors } = parseSchemaValues(runtimeSchema, {
    client,
    shared,
    runtimeEnv,
    prefixMap,
    autoRedactKeys: opts._autoRedactKeys,
  });

  raiseValidationErrors(errors, opts.onValidationError);

  const mergedValues = mergeExtendedEnvs(extendsEnvs, parsedValues);
  const clientBlockedKeys = createClientBlockedKeys(aggregated);
  const env = createReadOnlyEnv<EnvResult<TExtends, TServer, TClient, TShared>>(mergedValues, {
    isServer,
    clientBlockedKeys,
  });

  envMetaStore.set(env as object, {
    serverKeys: aggregated.serverKeys,
    clientKeys: aggregated.clientKeys,
    sharedKeys: aggregated.sharedKeys,
  });

  return env;
}

export function createEnv<
  TServer extends SchemaDict = {},
  TClient extends SchemaDict = {},
  TShared extends SchemaDict = {},
  const TExtends extends readonly AnyEnv[] = readonly [],
  const TResolvers extends readonly Effect.Effect<ResolverResult<any>, ResolverError>[] =
    readonly [],
>(
  opts: EnvOptions<TServer, TClient, TShared, TExtends> & {
    resolvers: TResolvers;
    autoRedactResolver: false;
  },
): Effect.Effect<
  EnvResult<TExtends, TServer, TClient, TShared>,
  ResolverError | EnvValidationError
>;

// Overload: with resolvers (autoRedactResolver defaults to true) -> auto-redact resolver keys
export function createEnv<
  TServer extends SchemaDict = {},
  TClient extends SchemaDict = {},
  TShared extends SchemaDict = {},
  const TExtends extends readonly AnyEnv[] = readonly [],
  const TResolvers extends readonly Effect.Effect<ResolverResult<any>, ResolverError>[] =
    readonly [],
  const TPrefix extends string | PrefixMap | undefined = undefined,
>(
  opts: EnvOptions<TServer, TClient, TShared, TExtends> & {
    resolvers: TResolvers;
    autoRedactResolver?: true;
    prefix?: TPrefix;
  },
): Effect.Effect<
  EnvResultAutoRedacted<
    TExtends,
    TServer,
    TClient,
    TShared,
    ExtractResolverKeys<TResolvers>,
    PrefixStr<TPrefix>
  >,
  ResolverError | EnvValidationError
>;

// Overload: without resolvers -> synchronous
export function createEnv<
  TServer extends SchemaDict = {},
  TClient extends SchemaDict = {},
  TShared extends SchemaDict = {},
  const TExtends extends readonly AnyEnv[] = readonly [],
>(
  opts: EnvOptions<TServer, TClient, TShared, TExtends>,
): EnvResult<TExtends, TServer, TClient, TShared>;

export function createEnv(
  opts: EnvOptions<SchemaDict, SchemaDict, SchemaDict, readonly AnyEnv[]> & {
    resolvers?: readonly Effect.Effect<ResolverResult, ResolverError>[];
    autoRedactResolver?: boolean;
  },
) {
  if (process.env.ENVIL_INTROSPECT_ONLY === "1") {
    return new Proxy({}, { get: () => undefined }) as any;
  }

  if (opts.resolvers?.length) {
    const shouldAutoRedact = opts.autoRedactResolver !== false;
    return Effect.all(opts.resolvers, { concurrency: "unbounded" }).pipe(
      Effect.map((results) => {
        const autoRedactKeys = new Set<string>();
        if (shouldAutoRedact) {
          for (const result of results) {
            for (const [key, value] of Object.entries(result)) {
              if (value !== undefined) {
                autoRedactKeys.add(key);
              }
            }
          }
        }

        return {
          mergedEnv: Object.assign({}, opts.runtimeEnv ?? process.env, ...results),
          autoRedactKeys,
        };
      }),
      Effect.flatMap(({ mergedEnv, autoRedactKeys }) =>
        Effect.try({
          try: () =>
            buildEnv({
              ...opts,
              runtimeEnv: mergedEnv,
              _autoRedactKeys: shouldAutoRedact ? autoRedactKeys : undefined,
            }),
          catch: (error) =>
            error instanceof EnvValidationError ? error : new EnvValidationError([String(error)]),
        }),
      ),
    );
  }

  return buildEnv(opts);
}
