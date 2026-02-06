import { Effect } from "effect";

import { ResolverError, type ResolverResult } from "./types.ts";

export { ResolverError } from "./types.ts";

interface OnePasswordOptions<K extends string = string> {
  secrets: Record<K, string>;
  serviceAccountToken?: string;
}

export function fromOnePassword<K extends string>(
  opts: OnePasswordOptions<K>,
): Effect.Effect<ResolverResult<K>, ResolverError>;
export function fromOnePassword(
  opts: OnePasswordOptions,
): Effect.Effect<ResolverResult, ResolverError> {
  return Effect.gen(function* () {
    const { secrets } = opts;

    const token = opts.serviceAccountToken ?? process.env.OP_SERVICE_ACCOUNT_TOKEN;
    if (!token) {
      return yield* new ResolverError({
        resolver: "1password",
        message: "serviceAccountToken (or OP_SERVICE_ACCOUNT_TOKEN env var) must be provided",
      });
    }

    const client = yield* Effect.tryPromise({
      try: async () => {
        const sdk = await import("@1password/sdk");
        const sdkClient = await sdk.createClient({
          auth: token,
          integrationName: "better-env",
          integrationVersion: "1.0.0",
        });
        return {
          resolveAll: async (refs: string[]) => {
            return sdkClient.secrets.resolveAll(refs);
          },
        };
      },
      catch: (cause) =>
        new ResolverError({
          resolver: "1password",
          message: "Failed to initialize 1Password client",
          cause,
        }),
    });

    const entries = Object.entries(secrets);
    const refs = entries.map(([, ref]) => ref);

    const resolved = yield* Effect.tryPromise(() => client.resolveAll(refs)).pipe(
      Effect.orElseSucceed(() => null),
    );

    const result: Record<string, string | undefined> = {};
    if (resolved) {
      for (let i = 0; i < entries.length; i++) {
        result[entries[i]![0]] = resolved[i];
      }
    } else {
      for (const [envKey] of entries) {
        result[envKey] = undefined;
      }
    }
    return result;
  });
}
