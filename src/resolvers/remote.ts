import { Effect } from "effect";

import { ResolverError, type ResolverResult, type SecretClient } from "./types.ts";

export { ResolverError } from "./types.ts";

interface RemoteSecretsOptions<K extends string = string> {
  secrets: Record<K, string>;
  client: SecretClient;
}

export function fromRemoteSecrets<K extends string>(
  opts: RemoteSecretsOptions<K>,
): Effect.Effect<ResolverResult<K>, ResolverError>;
export function fromRemoteSecrets(
  opts: RemoteSecretsOptions,
): Effect.Effect<ResolverResult, ResolverError> {
  return Effect.gen(function* () {
    const { secrets, client } = opts;
    const entries = Object.entries(secrets);
    const secretIds = entries.map(([, id]) => id);

    const secretValues = new Map<string, string | undefined>();

    if (client.getSecrets && secretIds.length > 1) {
      const batchResult = yield* Effect.tryPromise(() =>
        client.getSecrets!(secretIds),
      ).pipe(Effect.orElseSucceed(() => new Map<string, string | undefined>()));
      for (const [id, value] of batchResult) {
        secretValues.set(id, value);
      }
      for (const id of secretIds) {
        if (!secretValues.has(id)) secretValues.set(id, undefined);
      }
    } else {
      const results = yield* Effect.forEach(
        secretIds,
        (secretId) =>
          Effect.tryPromise(() => client.getSecret(secretId)).pipe(
            Effect.map((value) => [secretId, value] as const),
            Effect.orElseSucceed(() => [secretId, undefined] as const),
          ),
        { concurrency: "unbounded" },
      );
      for (const [id, value] of results) {
        secretValues.set(id, value);
      }
    }

    const result: Record<string, string | undefined> = {};
    for (const [envKey, secretId] of entries) {
      result[envKey] = secretValues.get(secretId);
    }
    return result;
  });
}
