import { Effect } from "effect";

import { createEnv } from "./env.ts";
import { EnvValidationError } from "./errors.ts";
import type { ResolverError, ResolverResult } from "./resolvers/types.ts";
import type {
  AnyEnv,
  EnvOptions,
  EnvResult,
  EnvResultAutoRedacted,
  ExtractResolverKeys,
  PrefixMap,
  PrefixStr,
  SchemaDict,
} from "./types.ts";

export type SafeCreateEnvSuccess<T> = Readonly<{ success: true; data: T }>;
export type SafeCreateEnvFailure<E> = Readonly<{ success: false; error: E }>;
export type SafeCreateEnvResult<T, E> = SafeCreateEnvSuccess<T> | SafeCreateEnvFailure<E>;

function normalizeEnvValidationError(error: unknown): EnvValidationError {
  return error instanceof EnvValidationError ? error : new EnvValidationError([String(error)]);
}

// Overload: with resolvers + autoRedactResolver false
export function safeCreateEnv<
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
  SafeCreateEnvResult<
    EnvResult<TExtends, TServer, TClient, TShared>,
    ResolverError | EnvValidationError
  >,
  never
>;

// Overload: with resolvers + autoRedactResolver true (default)
export function safeCreateEnv<
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
  SafeCreateEnvResult<
    EnvResultAutoRedacted<
      TExtends,
      TServer,
      TClient,
      TShared,
      ExtractResolverKeys<TResolvers>,
      PrefixStr<TPrefix>
    >,
    ResolverError | EnvValidationError
  >,
  never
>;

// Overload: without resolvers + sync result object
export function safeCreateEnv<
  TServer extends SchemaDict = {},
  TClient extends SchemaDict = {},
  TShared extends SchemaDict = {},
  const TExtends extends readonly AnyEnv[] = readonly [],
>(
  opts: EnvOptions<TServer, TClient, TShared, TExtends>,
): SafeCreateEnvResult<EnvResult<TExtends, TServer, TClient, TShared>, EnvValidationError>;

export function safeCreateEnv(
  opts: EnvOptions<SchemaDict, SchemaDict, SchemaDict, readonly AnyEnv[]> & {
    resolvers?: readonly Effect.Effect<ResolverResult<any>, ResolverError>[];
    autoRedactResolver?: boolean;
  },
):
  | SafeCreateEnvResult<AnyEnv, EnvValidationError>
  | Effect.Effect<SafeCreateEnvResult<AnyEnv, ResolverError | EnvValidationError>, never> {
  if (opts.resolvers !== undefined) {
    try {
      const created = createEnv(opts);
      if (Effect.isEffect(created)) {
        const createdEffect = created as Effect.Effect<
          AnyEnv,
          ResolverError | EnvValidationError,
          never
        >;

        return createdEffect.pipe(
          Effect.match({
            onFailure: (error) => ({ success: false, error }) as const,
            onSuccess: (data) => ({ success: true, data }) as const,
          }),
        );
      }

      return Effect.succeed({ success: true, data: created } as const);
    } catch (error) {
      return Effect.succeed({
        success: false,
        error: normalizeEnvValidationError(error),
      } as const);
    }
  }

  try {
    return { success: true, data: createEnv(opts) } as const;
  } catch (error) {
    return { success: false, error: normalizeEnvValidationError(error) } as const;
  }
}
