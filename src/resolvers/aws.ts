import { Effect } from "effect";

import { ResolverError, type ResolverResult } from "./types.ts";

export { ResolverError } from "./types.ts";

interface AwsSecretsOptions<K extends string = string> {
  secrets: Record<K, string>;
  region?: string;
}

function createSdkClient(region?: string): Effect.Effect<
  {
    getSecret: (secretId: string) => Promise<string | undefined>;
    getSecrets: (secretIds: string[]) => Promise<Map<string, string | undefined>>;
  },
  ResolverError
> {
  return Effect.tryPromise({
    try: async () => {
      const sdk = await import("@aws-sdk/client-secrets-manager");
      const sdkClient = new sdk.SecretsManagerClient(region ? { region } : {});
      return {
        getSecret: async (secretId: string) => {
          const response = await sdkClient.send(
            new sdk.GetSecretValueCommand({ SecretId: secretId }),
          );
          return response.SecretString ?? undefined;
        },
        getSecrets: async (secretIds: string[]) => {
          const result = new Map<string, string | undefined>();
          for (let i = 0; i < secretIds.length; i += 20) {
            const batch = secretIds.slice(i, i + 20);
            const response = await sdkClient.send(
              new sdk.BatchGetSecretValueCommand({ SecretIdList: batch }),
            );
            for (const sv of response.SecretValues ?? []) {
              if (sv.Name) result.set(sv.Name, sv.SecretString ?? undefined);
            }
            for (const id of batch) {
              if (!result.has(id)) result.set(id, undefined);
            }
          }
          return result;
        },
      };
    },
    catch: (cause) =>
      new ResolverError({
        resolver: "aws",
        message: "Failed to initialize AWS Secrets Manager client",
        cause,
      }),
  });
}

export function fromAwsSecrets<K extends string>(
  opts: AwsSecretsOptions<K>,
): Effect.Effect<ResolverResult<K>, ResolverError>;
export function fromAwsSecrets(
  opts: AwsSecretsOptions,
): Effect.Effect<ResolverResult, ResolverError> {
  return Effect.gen(function* () {
    const client = yield* createSdkClient(opts.region);

    // Group env keys by secret ID to minimize API calls
    const secretIdToKeys = new Map<string, { envKey: string; jsonKey?: string }[]>();
    for (const [envKey, ref] of Object.entries(opts.secrets)) {
      const hashIdx = ref.indexOf("#");
      const secretId = hashIdx >= 0 ? ref.slice(0, hashIdx) : ref;
      const jsonKey = hashIdx >= 0 ? ref.slice(hashIdx + 1) : undefined;

      const existing = secretIdToKeys.get(secretId) ?? [];
      existing.push({ envKey, jsonKey });
      secretIdToKeys.set(secretId, existing);
    }

    const uniqueSecretIds = [...secretIdToKeys.keys()];
    const secretValues = new Map<string, string | undefined>();

    if (uniqueSecretIds.length === 1) {
      const value = yield* Effect.tryPromise(() => client.getSecret(uniqueSecretIds[0]!)).pipe(
        Effect.orElseSucceed(() => undefined),
      );
      secretValues.set(uniqueSecretIds[0]!, value);
    } else {
      const batchResult = yield* Effect.tryPromise(() =>
        client.getSecrets(uniqueSecretIds),
      ).pipe(Effect.orElseSucceed(() => new Map<string, string | undefined>()));
      for (const [id, value] of batchResult) {
        secretValues.set(id, value);
      }
      for (const id of uniqueSecretIds) {
        if (!secretValues.has(id)) secretValues.set(id, undefined);
      }
    }

    const result: Record<string, string | undefined> = {};
    for (const [secretId, entries] of secretIdToKeys) {
      const raw = secretValues.get(secretId);
      for (const { envKey, jsonKey } of entries) {
        if (raw === undefined) {
          result[envKey] = undefined;
          continue;
        }
        if (jsonKey) {
          try {
            const parsed = JSON.parse(raw);
            result[envKey] = parsed[jsonKey] !== undefined ? String(parsed[jsonKey]) : undefined;
          } catch {
            result[envKey] = undefined;
          }
        } else {
          result[envKey] = raw;
        }
      }
    }

    return result;
  });
}
