import { Effect, Either, Predicate, type Layer } from "effect";

import { isEnvValue } from "./env/runtime.ts";
import type { EnvironmentCreationOptions } from "./env/secret-resolution.ts";
import { createEnvEffect } from "./env/secret-resolution.ts";
import { EnvConfigurationError, EnvValidationError } from "./errors.ts";
import type { AnyResolverDefinition } from "./resolvers/types.ts";
import type {
  AnyEnv,
  BuildEnvContract,
  ComposedEnvContract,
  EnvContractCarrier,
  EnvOptions,
  EnvValue,
  PrefixMap,
  ResolverErrors,
  ResolverRequirements,
  ResolverTools,
  SchemaDict,
  ValidEnvOptions,
  ValidResolverTuple,
} from "./types.ts";

type EnvFailure<Resolvers extends readonly AnyResolverDefinition[]> =
  | ResolverErrors<Resolvers>
  | EnvConfigurationError
  | EnvValidationError;

type EffectExtends<Extends extends readonly AnyEnv[]> = {
  readonly [Index in keyof Extends]: Extends[Index] extends PromiseLike<unknown>
    ? never
    : Extends[Index];
};

type PromiseExtends<Extends extends readonly AnyEnv[]> = {
  readonly [Index in keyof Extends]: Extends[Index] extends Effect.Effect<unknown, unknown, unknown>
    ? never
    : Extends[Index];
};

type SyncExtends<Extends extends readonly AnyEnv[]> = {
  readonly [Index in keyof Extends]: Extends[Index] extends
    | Effect.Effect<unknown, unknown, unknown>
    | PromiseLike<unknown>
    ? never
    : Extends[Index];
};

type ExtendedEffects<Extends extends readonly AnyEnv[]> = Extract<
  Extends[number],
  Effect.Effect<unknown, unknown, unknown>
>;

type ExtendedEnvErrors<Extends extends readonly AnyEnv[]> = [ExtendedEffects<Extends>] extends [
  never,
]
  ? never
  : ExtendedEffects<Extends> extends Effect.Effect<unknown, infer Error, unknown>
    ? Error
    : never;

type ExtendedEnvRequirements<Extends extends readonly AnyEnv[]> = [
  ExtendedEffects<Extends>,
] extends [never]
  ? never
  : ExtendedEffects<Extends> extends Effect.Effect<unknown, unknown, infer Requirements>
    ? Requirements
    : never;

/**
 * Creates an Effect that resolves and validates an immutable environment.
 */
export function createEnv<
  const Resolvers extends readonly AnyResolverDefinition[],
  Server extends SchemaDict = {},
  Client extends SchemaDict = {},
  Shared extends SchemaDict = {},
  const Extends extends readonly AnyEnv[] = readonly [],
  const Prefix extends string | PrefixMap | undefined = undefined,
>(
  options: Omit<EnvOptions<Server, Client, Shared, Extends, Prefix>, "extends"> & {
    readonly extends?: EffectExtends<Extends>;
    readonly resolvers: (tools: ResolverTools<Server>) => ValidResolverTuple<Resolvers>;
  } & ValidEnvOptions<Server, Client, Shared, Prefix>,
): Effect.Effect<
  EnvValue<
    Extends,
    ComposedEnvContract<Extends, BuildEnvContract<Server, Client, Shared, Prefix, Resolvers>>
  >,
  EnvFailure<Resolvers> | ExtendedEnvErrors<Extends>,
  ResolverRequirements<Resolvers> | ExtendedEnvRequirements<Extends>
> &
  EnvContractCarrier<
    ComposedEnvContract<Extends, BuildEnvContract<Server, Client, Shared, Prefix, Resolvers>>
  >;

/**
 * Creates an Effect that validates an immutable runtime-only environment.
 */
export function createEnv<
  Server extends SchemaDict = {},
  Client extends SchemaDict = {},
  Shared extends SchemaDict = {},
  const Extends extends readonly AnyEnv[] = readonly [],
  const Prefix extends string | PrefixMap | undefined = undefined,
>(
  options: Omit<EnvOptions<Server, Client, Shared, Extends, Prefix>, "extends"> & {
    readonly extends?: EffectExtends<Extends>;
    readonly resolvers?: never;
  } & ValidEnvOptions<Server, Client, Shared, Prefix>,
): Effect.Effect<
  EnvValue<
    Extends,
    ComposedEnvContract<Extends, BuildEnvContract<Server, Client, Shared, Prefix, readonly []>>
  >,
  EnvConfigurationError | EnvValidationError | ExtendedEnvErrors<Extends>,
  ExtendedEnvRequirements<Extends>
> &
  EnvContractCarrier<
    ComposedEnvContract<Extends, BuildEnvContract<Server, Client, Shared, Prefix, readonly []>>
  >;

export function createEnv(
  options: EnvironmentCreationOptions,
): Effect.Effect<AnyEnv, unknown, unknown> {
  return Effect.forEach(
    options.extends ?? [],
    (extendedEnv) => {
      if (Effect.isEffect(extendedEnv)) {
        return Effect.flatMap(extendedEnv, (resolvedEnv) =>
          isEnvValue(resolvedEnv)
            ? Effect.succeed(resolvedEnv)
            : Effect.fail(
                new EnvConfigurationError(
                  "createEnv extends Effects must resolve to environments created by Envil",
                ),
              ),
        );
      }
      if (Predicate.isPromiseLike(extendedEnv)) {
        return Effect.fail(
          new EnvConfigurationError(
            "createEnv extends accepts Effects or resolved environment values, not Promises",
          ),
        );
      }
      return isEnvValue(extendedEnv)
        ? Effect.succeed(extendedEnv)
        : Effect.fail(
            new EnvConfigurationError(
              "createEnv extends accepts only environments created by Envil",
            ),
          );
    },
    { concurrency: "unbounded" },
  ).pipe(
    Effect.flatMap((resolvedExtends) =>
      createEnvEffect({
        ...options,
        extends: resolvedExtends,
      }),
    ),
  );
}

/**
 * Synchronously validates an environment that has no resolvers.
 */
export function createEnvSync<
  Server extends SchemaDict = {},
  Client extends SchemaDict = {},
  Shared extends SchemaDict = {},
  const Extends extends readonly AnyEnv[] = readonly [],
  const Prefix extends string | PrefixMap | undefined = undefined,
>(
  options: Omit<EnvOptions<Server, Client, Shared, Extends, Prefix>, "extends"> & {
    readonly extends?: SyncExtends<Extends>;
    readonly resolvers?: never;
  } & ValidEnvOptions<Server, Client, Shared, Prefix>,
): EnvValue<
  Extends,
  ComposedEnvContract<Extends, BuildEnvContract<Server, Client, Shared, Prefix, readonly []>>
> {
  for (const extendedEnv of options.extends ?? []) {
    if (Effect.isEffect(extendedEnv) || Predicate.isPromiseLike(extendedEnv)) {
      throw new EnvConfigurationError(
        "createEnvSync extends accepts resolved environment values only",
      );
    }
    if (!isEnvValue(extendedEnv)) {
      throw new EnvConfigurationError(
        "createEnvSync extends accepts only environments created by Envil",
      );
    }
  }

  // SAFETY: createEnvSync rejects resolvers in its public contract and async
  // extends values above, so the internal Effect has no remaining requirements.
  const effect = createEnvEffect(options) as Effect.Effect<
    EnvValue<
      Extends,
      ComposedEnvContract<Extends, BuildEnvContract<Server, Client, Shared, Prefix, readonly []>>
    >,
    unknown,
    never
  >;
  const result = Effect.runSync(Effect.either(effect));
  if (Either.isLeft(result)) {
    throw result.left;
  }
  return result.right;
}

/**
 * Resolves an environment at a Promise boundary, requiring a Layer only when
 * configured adapters leave Effect services unprovided.
 */
export function createEnvPromise<
  const Resolvers extends readonly AnyResolverDefinition[],
  Provided,
  Server extends SchemaDict = {},
  Client extends SchemaDict = {},
  Shared extends SchemaDict = {},
  const Extends extends readonly AnyEnv[] = readonly [],
  const Prefix extends string | PrefixMap | undefined = undefined,
>(
  options: Omit<EnvOptions<Server, Client, Shared, Extends, Prefix>, "extends"> & {
    readonly extends?: PromiseExtends<Extends>;
    readonly resolvers: (tools: ResolverTools<Server, Provided>) => ValidResolverTuple<Resolvers>;
  } & ValidEnvOptions<Server, Client, Shared, Prefix>,
  layerOptions: {
    readonly layer: Layer.Layer<Provided, unknown, never>;
  },
): Promise<
  EnvValue<
    Extends,
    ComposedEnvContract<Extends, BuildEnvContract<Server, Client, Shared, Prefix, Resolvers>>
  >
> &
  EnvContractCarrier<
    ComposedEnvContract<Extends, BuildEnvContract<Server, Client, Shared, Prefix, Resolvers>>
  >;

/**
 * Resolves an environment whose adapters require no Effect services.
 */
export function createEnvPromise<
  const Resolvers extends readonly AnyResolverDefinition[],
  Server extends SchemaDict = {},
  Client extends SchemaDict = {},
  Shared extends SchemaDict = {},
  const Extends extends readonly AnyEnv[] = readonly [],
  const Prefix extends string | PrefixMap | undefined = undefined,
>(
  options: Omit<EnvOptions<Server, Client, Shared, Extends, Prefix>, "extends"> & {
    readonly extends?: PromiseExtends<Extends>;
    readonly resolvers: (tools: ResolverTools<Server, never>) => ValidResolverTuple<Resolvers>;
  } & ValidEnvOptions<Server, Client, Shared, Prefix>,
): Promise<
  EnvValue<
    Extends,
    ComposedEnvContract<Extends, BuildEnvContract<Server, Client, Shared, Prefix, Resolvers>>
  >
> &
  EnvContractCarrier<
    ComposedEnvContract<Extends, BuildEnvContract<Server, Client, Shared, Prefix, Resolvers>>
  >;

/**
 * Validates a runtime-only environment at a Promise boundary.
 */
export function createEnvPromise<
  Server extends SchemaDict = {},
  Client extends SchemaDict = {},
  Shared extends SchemaDict = {},
  const Extends extends readonly AnyEnv[] = readonly [],
  const Prefix extends string | PrefixMap | undefined = undefined,
>(
  options: Omit<EnvOptions<Server, Client, Shared, Extends, Prefix>, "extends"> & {
    readonly extends?: PromiseExtends<Extends>;
    readonly resolvers?: never;
  } & ValidEnvOptions<Server, Client, Shared, Prefix>,
): Promise<
  EnvValue<
    Extends,
    ComposedEnvContract<Extends, BuildEnvContract<Server, Client, Shared, Prefix, readonly []>>
  >
> &
  EnvContractCarrier<
    ComposedEnvContract<Extends, BuildEnvContract<Server, Client, Shared, Prefix, readonly []>>
  >;

export function createEnvPromise(
  options: EnvironmentCreationOptions,
  ...layerOptions: readonly [
    options?: {
      readonly layer: Layer.Layer<unknown, unknown, never>;
    },
  ]
): Promise<AnyEnv> {
  for (const extendedEnv of options.extends ?? []) {
    if (Effect.isEffect(extendedEnv)) {
      return Promise.reject(
        new EnvConfigurationError(
          "createEnvPromise extends accepts Promises or resolved environment values, not Effects",
        ),
      );
    }
  }

  return Promise.all(options.extends ?? []).then((resolvedExtends) => {
    for (const extendedEnv of resolvedExtends) {
      if (!isEnvValue(extendedEnv)) {
        throw new EnvConfigurationError(
          "createEnvPromise extends accepts only environments created by Envil",
        );
      }
    }

    const effect = createEnvEffect({
      ...options,
      extends: resolvedExtends,
    });
    const runnable =
      layerOptions[0] === undefined ? effect : Effect.provide(effect, layerOptions[0].layer);

    // SAFETY: The public overload requires a Layer whenever resolver
    // requirements are non-never, so the Promise boundary has no services left.
    return Effect.runPromise(runnable as Effect.Effect<AnyEnv, unknown, never>);
  });
}
