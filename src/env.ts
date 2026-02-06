import { Effect, Either, ParseResult, Redacted, Schema } from "effect";

import { ClientAccessError, EnvValidationError } from "./errors.ts";
import type { ResolverError, ResolverResult } from "./resolvers/types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = Schema.Schema<any, any, never>;
type SchemaDict = Record<string, AnySchema>;
type UnwrapRedacted<T> = T extends Redacted.Redacted<infer A> ? A : T;
type InferEnv<T extends SchemaDict> = { [K in keyof T]: UnwrapRedacted<Schema.Schema.Type<T[K]>> };

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
      result[key] = parsed.right;
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
      const value = Reflect.get(target, prop);
      return Redacted.isRedacted(value) ? Redacted.value(value) : value;
    },
  }) as EnvResult<TExtends, TServer, TClient, TShared>;
}

export function createEnv<
  TServer extends SchemaDict = {},
  TClient extends SchemaDict = {},
  TShared extends SchemaDict = {},
  const TExtends extends readonly AnyEnv[] = readonly [],
>(
  opts: EnvOptions<TServer, TClient, TShared, TExtends> & {
    resolvers: readonly Effect.Effect<ResolverResult, ResolverError>[];
  },
): Effect.Effect<
  EnvResult<TExtends, TServer, TClient, TShared>,
  ResolverError | EnvValidationError
>;

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
  },
) {
  if (opts.resolvers?.length) {
    return Effect.all(opts.resolvers, { concurrency: "unbounded" }).pipe(
      Effect.map((results) => Object.assign({}, opts.runtimeEnv ?? process.env, ...results)),
      Effect.flatMap((mergedEnv) =>
        Effect.try({
          try: () => buildEnv({ ...opts, runtimeEnv: mergedEnv }),
          catch: (e) => (e instanceof EnvValidationError ? e : new EnvValidationError([String(e)])),
        }),
      ),
    );
  }
  return buildEnv(opts);
}
