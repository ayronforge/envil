import { Effect, Option, Redacted } from "effect";

import {
  ResolverInitializationError,
  ResolverRequestFailed,
  type ResolvedSecret,
} from "./types.ts";

/** Converts an optional provider string into the internal secret representation. */
export function toResolvedSecret(value: string | undefined): ResolvedSecret {
  return value === undefined ? Option.none() : Option.some(Redacted.make(value));
}

/** Initializes an SDK without exposing the provider's thrown value. */
export function initializeAdapter<Client>(
  adapter: string,
  initialize: () => Promise<Client>,
): Effect.Effect<Client, ResolverInitializationError> {
  return Effect.tryPromise({
    try: initialize,
    catch: () =>
      new ResolverInitializationError({
        adapter,
        operation: "initialize",
        message: `Could not start the ${adapter} secret resolver. Check that its SDK and credentials are configured, then try again.`,
      }),
  });
}

/** Executes one provider request with reliable not-found classification. */
export function requestSecret(
  adapter: string,
  operation: string,
  request: () => Promise<string | undefined>,
  isNotFound: (failure: unknown) => boolean,
): Effect.Effect<ResolvedSecret, ResolverRequestFailed> {
  return Effect.tryPromise({
    try: request,
    catch: (failure: unknown) => failure,
  }).pipe(
    Effect.matchEffect({
      onFailure: (failure) =>
        isNotFound(failure)
          ? Effect.succeed(Option.none())
          : Effect.fail(
              new ResolverRequestFailed({
                adapter,
                operation,
                message: `The ${adapter} resolver could not read a secret. Check provider access and try again.`,
              }),
            ),
      onSuccess: (value) => Effect.succeed(toResolvedSecret(value)),
    }),
  );
}

/** Converts logical key/value pairs into an immutable resolver record. */
export function resolverRecord<Keys extends string>(
  entries: ReadonlyArray<readonly [Keys, ResolvedSecret]>,
): Readonly<Record<Keys, ResolvedSecret>> {
  // SAFETY: Every requested key is added exactly once by the adapter.
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<Keys, ResolvedSecret>>;
}

/** Returns typed entries while preserving a finite resolver key union. */
export function resolverEntries<Keys extends string>(
  values: Readonly<Record<Keys, string>>,
): Array<[Keys, string]> {
  // SAFETY: Object.entries preserves every own string key and string value from
  // the input record; it only loses the finite key union in the standard type.
  return Object.entries(values) as Array<[Keys, string]>;
}

/** Checks a property on an unknown SDK failure without retaining the failure. */
export function hasFailureField(
  failure: unknown,
  field: string,
  expected: string | number,
): boolean {
  if (typeof failure !== "object" || failure === null) {
    return false;
  }

  return Reflect.get(failure, field) === expected;
}
