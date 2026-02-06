import { Effect } from "effect";

import { ResolverError, type ResolverResult } from "./types.ts";

export { ResolverError } from "./types.ts";

interface OnePasswordOptions {
  secrets: Record<string, string>;
  client?: {
    secrets: {
      resolveAll: (refs: string[]) => Promise<string[]>;
    };
  };
  serviceAccountToken?: string;
}

export function fromOnePassword(
  opts: OnePasswordOptions,
): Effect.Effect<ResolverResult, ResolverError> {
  return Effect.gen(function* () {
    const { secrets } = opts;

    let client = opts.client;
    if (!client) {
      const token = opts.serviceAccountToken ?? process.env.OP_SERVICE_ACCOUNT_TOKEN;
      if (!token) {
        return yield* new ResolverError({
          resolver: "1password",
          message:
            "Either client or serviceAccountToken (or OP_SERVICE_ACCOUNT_TOKEN env var) must be provided",
        });
      }
      client = yield* Effect.tryPromise({
        try: async () => {
          const sdk = await import("@1password/sdk");
          return (await sdk.createClient({
            auth: token,
            integrationName: "better-env",
            integrationVersion: "1.0.0",
          })) as unknown as {
            secrets: {
              resolveAll: (refs: string[]) => Promise<string[]>;
            };
          };
        },
        catch: (cause) =>
          new ResolverError({
            resolver: "1password",
            message: "Failed to initialize 1Password client",
            cause,
          }),
      });
    }

    const resolveClient = client;
    const entries = Object.entries(secrets);
    const refs = entries.map(([, ref]) => ref);

    const resolved = yield* Effect.tryPromise(() => resolveClient.secrets.resolveAll(refs)).pipe(
      Effect.orElseSucceed(() => null),
    );

    const result: ResolverResult = {};
    if (resolved) {
      for (let i = 0; i < entries.length; i++) {
        result[entries[i]![0]] = resolved[i] ?? undefined;
      }
    } else {
      for (const [envKey] of entries) {
        result[envKey] = undefined;
      }
    }
    return result;
  });
}
