import { Effect, Option, Redacted } from "effect";

import { EnvConfigurationError, EnvValidationError } from "../errors.ts";
import type {
  AnyResolverAdapter,
  AnyResolverDefinition,
  ResolverResult,
} from "../resolvers/types.ts";
import type { AnyEnv, ResolverTools, SchemaDict } from "../types.ts";

import { buildEnv, type RuntimeOptions } from "./runtime.ts";

/** Erased creation options consumed by the internal resolution pipeline. */
export type EnvironmentCreationOptions = RuntimeOptions & {
  readonly resolvers?: (tools: ResolverTools<SchemaDict>) => readonly AnyResolverDefinition[];
};

function makeResolverTools<Server extends SchemaDict>(): ResolverTools<Server> {
  // SAFETY: The implementation forwards the adapter's own options unchanged
  // and derives keys from the exact secrets object. The public signature
  // retains the adapter name, error, and requirement generics.
  const resolve = ((
    adapter: AnyResolverAdapter,
    options: object & {
      readonly secrets: Readonly<Record<string, unknown>>;
    },
  ) => {
    const runtimeAdapter = adapter as AnyResolverAdapter & {
      readonly resolve: (
        resolverOptions: object,
      ) => Effect.Effect<ResolverResult, unknown, unknown>;
    };
    return {
      adapterName: adapter.name,
      keys: Object.keys(options.secrets),
      effect: runtimeAdapter.resolve(options),
    };
  }) as ResolverTools<Server>["resolve"];

  return { resolve };
}

function assertResolverDefinitions(
  server: SchemaDict,
  definitions: readonly AnyResolverDefinition[],
): void {
  const resolvedKeys = new Set<string>();

  for (const definition of definitions) {
    for (const key of definition.keys) {
      if (!(key in server)) {
        throw new EnvConfigurationError(
          `Resolver "${definition.adapterName}" targets unknown server key "${key}"`,
        );
      }
      if (resolvedKeys.has(key)) {
        throw new EnvConfigurationError(
          `Environment variable "${key}" is configured by more than one resolver`,
        );
      }
      resolvedKeys.add(key);
    }
  }
}

function collectResolvedSecrets(
  definitions: readonly AnyResolverDefinition[],
  results: readonly ResolverResult[],
): ReadonlyMap<string, Option.Option<Redacted.Redacted<string>>> {
  const resolvedSecrets = new Map<string, Option.Option<Redacted.Redacted<string>>>();

  for (const [index, definition] of definitions.entries()) {
    const result = results[index];
    if (result === undefined) {
      throw new EnvConfigurationError(
        `Resolver "${definition.adapterName}" returned an incomplete result`,
      );
    }
    for (const key of definition.keys) {
      const value = result[key];
      if (value === undefined || !Option.isOption(value)) {
        throw new EnvConfigurationError(
          `Resolver "${definition.adapterName}" returned an incomplete result`,
        );
      }
      resolvedSecrets.set(key, value);
    }
  }

  return resolvedSecrets;
}

/** Resolves configured secrets before constructing the immutable environment. */
export function createEnvEffect(
  options: EnvironmentCreationOptions,
): Effect.Effect<AnyEnv, unknown, unknown> {
  const definitions = options.resolvers?.(makeResolverTools()) ?? [];
  const shouldResolveSecrets = options.isServer ?? typeof window === "undefined";
  const activeDefinitions = shouldResolveSecrets ? definitions : [];

  return Effect.try({
    try: () => assertResolverDefinitions(options.server ?? {}, definitions),
    catch: (failure: unknown) =>
      failure instanceof EnvConfigurationError
        ? failure
        : new EnvConfigurationError("Resolver configuration failed unexpectedly"),
  }).pipe(
    Effect.flatMap(() =>
      Effect.all(
        activeDefinitions.map((definition) => definition.effect),
        { concurrency: "unbounded" },
      ),
    ),
    Effect.flatMap((results) =>
      Effect.try({
        try: () => buildEnv(options, collectResolvedSecrets(activeDefinitions, results)),
        catch: (failure: unknown) =>
          failure instanceof EnvValidationError || failure instanceof EnvConfigurationError
            ? failure
            : new EnvConfigurationError("Environment creation failed unexpectedly"),
      }),
    ),
  );
}
