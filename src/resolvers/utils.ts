import { Effect } from "effect";

import { ResolverError } from "./types.ts";

export function toResolverError(resolver: string, message: string, cause?: unknown): ResolverError {
  return new ResolverError({ resolver, message, cause });
}

export function tryInitializeClient<A>(
  resolver: string,
  message: string,
  initialize: () => Promise<A>,
): Effect.Effect<A, ResolverError> {
  return Effect.tryPromise({
    try: initialize,
    catch: (cause) => toResolverError(resolver, message, cause),
  });
}

export function strictOrElse<A>(
  effect: Effect.Effect<A, unknown>,
  options: {
    strict: boolean;
    resolver: string;
    message: string;
    fallback: () => A;
  },
): Effect.Effect<A, ResolverError> {
  return options.strict
    ? effect.pipe(
        Effect.mapError((cause) => toResolverError(options.resolver, options.message, cause)),
      )
    : effect.pipe(Effect.orElseSucceed(options.fallback));
}

export function keyValueResultsToRecord<K extends string>(
  values: ReadonlyArray<{ envKey: K; value: string | undefined }>,
): Record<K, string | undefined> {
  const result = {} as Record<K, string | undefined>;
  for (const { envKey, value } of values) {
    result[envKey] = value;
  }
  return result;
}

export function fillMissingMapValues(
  ids: readonly string[],
  values: Map<string, string | undefined>,
): void {
  for (const id of ids) {
    if (!values.has(id)) {
      values.set(id, undefined);
    }
  }
}
