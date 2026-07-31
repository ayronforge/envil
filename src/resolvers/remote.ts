import { Context, Effect, Layer, Option, Redacted } from "effect";

import type { ResolverAdapter, ResolverResult } from "./types.ts";
import { resolverEntries, resolverRecord } from "./utils.ts";

/** Base contract for secret-safe custom source failures. */
export interface SecretSourceError {
  readonly _tag: string;
  readonly message: string;
}

/** A sanitized failure returned by a custom secret source. */
export class SecretSourceRequestFailed extends Error implements SecretSourceError {
  readonly _tag = "SecretSourceRequestFailed" as const;

  constructor() {
    super(
      "The custom secret source could not read a secret. Check the source implementation and try again.",
    );
    this.name = "SecretSourceRequestFailed";
  }
}

/** Service contract implemented by custom secret providers. */
export interface SecretSourceService {
  readonly get: (
    reference: string,
  ) => Effect.Effect<Option.Option<Redacted.Redacted<string>>, SecretSourceError>;
}

/** Effect service used only by `customSecretsAdapter`. */
export class SecretSource extends Context.Service<SecretSource, SecretSourceService>()(
  "@ayronforge/envil/SecretSource",
) {
  /**
   * Builds a SecretSource Layer from a Promise callback that explicitly
   * distinguishes absence with `Option`.
   */
  static fromPromise(options: {
    readonly get: (reference: string) => Promise<Option.Option<string>>;
  }): Layer.Layer<SecretSource> {
    return Layer.succeed(SecretSource, {
      get: (reference) =>
        Effect.tryPromise({
          try: () => options.get(reference),
          catch: () => new SecretSourceRequestFailed(),
        }).pipe(Effect.map(Option.map((value) => Redacted.make(value)))),
    });
  }
}

function resolveCustomSecrets<const Keys extends string>(options: {
  readonly referencesByKey: Readonly<Record<Keys, string>>;
}): Effect.Effect<ResolverResult<Keys>, SecretSourceError, SecretSource> {
  return Effect.gen(function* () {
    const source = yield* SecretSource;
    const entries = yield* Effect.forEach(
      resolverEntries(options.referencesByKey),
      ([key, reference]) =>
        source.get(reference).pipe(Effect.map((value) => [key, value] as const)),
      { concurrency: "unbounded" },
    );
    return resolverRecord(entries);
  });
}

/** Resolver adapter backed by the user-provided `SecretSource` service. */
export const customSecretsAdapter: ResolverAdapter<
  "custom",
  string,
  object,
  SecretSourceError,
  SecretSource
> = {
  name: "custom",
  resolve: resolveCustomSecrets,
};
