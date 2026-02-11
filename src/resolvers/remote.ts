import { Effect } from "effect";

import { ResolverError, type ResolverResult, type SecretClient } from "./types.ts";
import { fillMissingMapValues, keyValueResultsToRecord, strictOrElse } from "./utils.ts";

export { ResolverError } from "./types.ts";

interface RemoteSecretsOptions<K extends string = string> {
  secrets: Record<K, string>;
  client: SecretClient;
  strict?: boolean;
}

export function fromRemoteSecrets<K extends string>(
  opts: RemoteSecretsOptions<K>,
): Effect.Effect<ResolverResult<K>, ResolverError>;
export function fromRemoteSecrets(
  opts: RemoteSecretsOptions,
): Effect.Effect<ResolverResult, ResolverError> {
  return Effect.gen(function* () {
    const { secrets, client, strict = false } = opts;
    const entries = Object.entries(secrets);
    const secretIds = entries.map(([, id]) => id);

    const secretValues = new Map<string, string | undefined>();

    if (client.getSecrets && secretIds.length > 1) {
      const batchResult = yield* strictOrElse(
        Effect.tryPromise(() => client.getSecrets!(secretIds)),
        {
          strict,
          resolver: "remote",
          message: "Failed to resolve remote secrets batch",
          fallback: () => new Map<string, string | undefined>(),
        },
      );

      for (const [id, value] of batchResult) {
        secretValues.set(id, value);
      }
      fillMissingMapValues(secretIds, secretValues);
    } else {
      const results = yield* Effect.forEach(
        secretIds,
        (secretId) =>
          strictOrElse(
            Effect.tryPromise(() => client.getSecret(secretId)),
            {
              strict,
              resolver: "remote",
              message: `Failed to resolve remote secret "${secretId}"`,
              fallback: () => undefined,
            },
          ).pipe(Effect.map((value) => ({ envKey: secretId, value }))),
        { concurrency: "unbounded" },
      );

      for (const { envKey, value } of results) {
        secretValues.set(envKey, value);
      }
    }

    return keyValueResultsToRecord(
      entries.map(([envKey, secretId]) => ({
        envKey,
        value: secretValues.get(secretId),
      })),
    );
  });
}
