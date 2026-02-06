import { Effect, Either, ParseResult, Redacted, Schema } from "effect";

import { ClientAccessError, EnvValidationError } from "./errors.ts";
import type { ResolverError, ResolverResult } from "./resolvers/types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = Schema.Schema<any, any, never>;
type SchemaDict = Record<string, AnySchema>;
type InferEnv<T extends SchemaDict> = { [K in keyof T]: Schema.Schema.Type<T[K]> };

type MaybeRedact<T> = T extends Redacted.Redacted<infer _> ? T : Redacted.Redacted<T>;

type InferEnvAutoRedacted<
  T extends SchemaDict,
  ResolverKeys extends string,
  Prefix extends string = "",
> = {
  [K in keyof T]: `${Prefix}${K & string}` extends ResolverKeys
    ? MaybeRedact<Schema.Schema.Type<T[K]>>
    : Schema.Schema.Type<T[K]>;
};

// Extract resolver keys from resolver array type (distributive via infer U)
type ExtractResolverKeys<T extends readonly any[]> = // eslint-disable-line @typescript-eslint/no-explicit-any
  T[number] extends infer U // eslint-disable-line @typescript-eslint/no-explicit-any
    ? U extends Effect.Effect<ResolverResult<infer K>, any, any>
      ? K
      : never // eslint-disable-line @typescript-eslint/no-explicit-any
    : never;

// Extract string prefix for type-level matching (PrefixMap not supported, falls back to "")
type PrefixStr<P> = P extends string ? P : "";

type AnyEnv = Readonly<Record<string, unknown>>;

type MergeEnvs<T extends readonly AnyEnv[]> = T extends readonly [
  infer First extends AnyEnv,
  ...infer Rest extends readonly AnyEnv[],
]
  ? First & MergeEnvs<Rest>
  : {};

type KnownKeys<T> = keyof {
  [K in keyof T as string extends K ? never : K]: T[K];
};

type EnvResult<
  TExtends extends readonly AnyEnv[],
  TServer extends SchemaDict,
  TClient extends SchemaDict,
  TShared extends SchemaDict,
> = Readonly<
  Omit<MergeEnvs<TExtends>, KnownKeys<TServer> | KnownKeys<TClient> | KnownKeys<TShared>> &
    InferEnv<TServer & TClient & TShared>
>;

type EnvResultAutoRedacted<
  TExtends extends readonly AnyEnv[],
  TServer extends SchemaDict,
  TClient extends SchemaDict,
  TShared extends SchemaDict,
  ResolverKeys extends string,
  Prefix extends string = "",
> = Readonly<
  Omit<MergeEnvs<TExtends>, KnownKeys<TServer> | KnownKeys<TClient> | KnownKeys<TShared>> &
    InferEnvAutoRedacted<TServer & TClient & TShared, ResolverKeys, Prefix>
>;

interface PrefixMap {
  server?: string;
  client?: string;
  shared?: string;
}

interface EnvOptions<
  TServer extends SchemaDict,
  TClient extends SchemaDict,
  TShared extends SchemaDict,
  TExtends extends readonly AnyEnv[] = readonly [],
> {
  server?: TServer;
  client?: TClient;
  shared?: TShared;
  extends?: TExtends;
  prefix?: string | PrefixMap;
  runtimeEnv?: Record<string, string | undefined>;
  isServer?: boolean;
  emptyStringAsUndefined?: boolean;
  onValidationError?: (errors: string[]) => void;
  _autoRedactKeys?: Set<string>;
}

function buildEnv<
  TServer extends SchemaDict = {},
  TClient extends SchemaDict = {},
  TShared extends SchemaDict = {},
  const TExtends extends readonly AnyEnv[] = readonly [],
>(
  opts: EnvOptions<TServer, TClient, TShared, TExtends>,
): EnvResult<TExtends, TServer, TClient, TShared> {
  const runtimeEnv = opts.runtimeEnv ?? process.env;

  const processedEnv: Record<string, string | undefined> = opts.emptyStringAsUndefined
    ? Object.fromEntries(Object.entries(runtimeEnv).map(([k, v]) => [k, v === "" ? undefined : v]))
    : runtimeEnv;

  const isServer = opts.isServer ?? typeof window === "undefined";

  const server = opts.server ?? ({} as TServer);
  const client = opts.client ?? ({} as TClient);
  const shared = opts.shared ?? ({} as TShared);

  const prefixMap: Required<PrefixMap> =
    typeof opts.prefix === "string" || opts.prefix === undefined
      ? { server: opts.prefix ?? "", client: opts.prefix ?? "", shared: opts.prefix ?? "" }
      : {
          server: opts.prefix.server ?? "",
          client: opts.prefix.client ?? "",
          shared: opts.prefix.shared ?? "",
        };

  const schema = isServer ? { ...server, ...client, ...shared } : { ...client, ...shared };

  const result: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [key, validator] of Object.entries(schema)) {
    const category = key in client ? "client" : key in shared ? "shared" : "server";
    const envKey = `${prefixMap[category]}${key}`;
    const value = processedEnv[envKey];
    const parsed = Schema.decodeUnknownEither(validator)(value);

    if (Either.isLeft(parsed)) {
      const detail = ParseResult.TreeFormatter.formatErrorSync(parsed.left);
      errors.push(`${envKey}: ${detail}`);
    } else {
      let finalValue = parsed.right;
      if (opts._autoRedactKeys?.has(envKey) && !Redacted.isRedacted(finalValue)) {
        finalValue = Redacted.make(finalValue);
      }
      result[key] = finalValue;
    }
  }

  if (errors.length > 0) {
    if (opts.onValidationError) {
      opts.onValidationError(errors);
    }
    throw new EnvValidationError(errors);
  }

  const mergedResult: Record<string, unknown> = {};
  for (const ext of opts.extends ?? []) {
    for (const [key, value] of Object.entries(ext)) {
      mergedResult[key] = value;
    }
  }
  for (const [key, value] of Object.entries(result)) {
    mergedResult[key] = value;
  }

  return new Proxy(mergedResult, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (!isServer && prop in server && !(prop in client) && !(prop in shared)) {
        throw new ClientAccessError(prop);
      }
      return Reflect.get(target, prop);
    },
  }) as EnvResult<TExtends, TServer, TClient, TShared>;
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

// Overload: with resolvers (autoRedactResolver defaults to true) → auto-redact resolver keys
export function createEnv<
  TServer extends SchemaDict = {},
  TClient extends SchemaDict = {},
  TShared extends SchemaDict = {},
  const TExtends extends readonly AnyEnv[] = readonly [],
  const TResolvers extends readonly Effect.Effect<ResolverResult<any>, ResolverError>[] = // eslint-disable-line @typescript-eslint/no-explicit-any
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

// Overload: without resolvers → synchronous
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
  if (opts.resolvers?.length) {
    const shouldAutoRedact = opts.autoRedactResolver !== false;
    return Effect.all(opts.resolvers, { concurrency: "unbounded" }).pipe(
      Effect.map((results) => {
        const autoRedactKeys = new Set<string>();
        if (shouldAutoRedact) {
          for (const r of results) {
            for (const [k, v] of Object.entries(r)) {
              if (v !== undefined) autoRedactKeys.add(k);
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
          catch: (e) => (e instanceof EnvValidationError ? e : new EnvValidationError([String(e)])),
        }),
      ),
    );
  }
  return buildEnv(opts);
}
