import { Effect } from "effect";

import { ResolverError, type ResolverResult } from "./types.ts";
import { keyValueResultsToRecord, strictOrElse, toResolverError, tryInitializeClient } from "./utils.ts";

export { ResolverError } from "./types.ts";

interface OnePasswordOptions<K extends string = string> {
  secrets: Record<K, string>;
  serviceAccountToken?: string;
  strict?: boolean;
}

export function fromOnePassword<K extends string>(
  opts: OnePasswordOptions<K>,
): Effect.Effect<ResolverResult<K>, ResolverError>;
export function fromOnePassword(
  opts: OnePasswordOptions,
): Effect.Effect<ResolverResult, ResolverError> {
  return Effect.gen(function* () {
    const { secrets, strict = false } = opts;

    const token = opts.serviceAccountToken ?? process.env.OP_SERVICE_ACCOUNT_TOKEN;
    if (!token) {
      return yield* toResolverError(
        "1password",
        "serviceAccountToken (or OP_SERVICE_ACCOUNT_TOKEN env var) must be provided",
      );
    }

    const client = yield* tryInitializeClient(
      "1password",
      "Failed to initialize 1Password client",
      async () => {
        const sdk = await import("@1password/sdk");
        const sdkClient = await sdk.createClient({
          auth: token,
          integrationName: "better-env",
          integrationVersion: "1.0.0",
        });

        return {
          resolveAll: async (refs: string[]) => sdkClient.secrets.resolveAll(refs),
        };
      },
    );

    const entries = Object.entries(secrets);
    const refs = entries.map(([, ref]) => ref);

    const resolved = yield* strictOrElse(
      Effect.tryPromise(() => client.resolveAll(refs)).pipe(
        Effect.map((values) => values as string[] | null),
      ),
      {
        strict,
        resolver: "1password",
        message: "Failed to resolve 1Password secrets",
        fallback: () => null,
      },
    );

    if (!resolved) {
      return keyValueResultsToRecord(entries.map(([envKey]) => ({ envKey, value: undefined })));
    }

    return keyValueResultsToRecord(
      entries.map(([envKey], index) => ({
        envKey,
        value: resolved[index],
      })),
    );
  });
}
