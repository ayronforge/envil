import { Effect } from "effect";

import { ResolverError, type ResolverResult } from "./types.ts";
import { fillMissingMapValues, strictOrElse, toResolverError, tryInitializeClient } from "./utils.ts";

export { ResolverError } from "./types.ts";

interface AwsSecretsOptions<K extends string = string> {
  secrets: Record<K, string>;
  region?: string;
  strict?: boolean;
}

function createSdkClient(region?: string): Effect.Effect<
  {
    getSecret: (secretId: string) => Promise<string | undefined>;
    getSecrets: (secretIds: string[]) => Promise<Map<string, string | undefined>>;
  },
  ResolverError
> {
  return tryInitializeClient("aws", "Failed to initialize AWS Secrets Manager client", async () => {
    const sdk = await import("@aws-sdk/client-secrets-manager");
    const sdkClient = new sdk.SecretsManagerClient(region ? { region } : {});

    return {
      getSecret: async (secretId: string) => {
        const response = await sdkClient.send(new sdk.GetSecretValueCommand({ SecretId: secretId }));
        return response.SecretString ?? undefined;
      },
      getSecrets: async (secretIds: string[]) => {
        const result = new Map<string, string | undefined>();

        for (let i = 0; i < secretIds.length; i += 20) {
          const batch = secretIds.slice(i, i + 20);
          const response = await sdkClient.send(
            new sdk.BatchGetSecretValueCommand({ SecretIdList: batch }),
          );

          for (const secretValue of response.SecretValues ?? []) {
            if (secretValue.Name) {
              result.set(secretValue.Name, secretValue.SecretString ?? undefined);
            }
          }

          fillMissingMapValues(batch, result);
        }

        return result;
      },
    };
  });
}

export function fromAwsSecrets<K extends string>(
  opts: AwsSecretsOptions<K>,
): Effect.Effect<ResolverResult<K>, ResolverError>;
export function fromAwsSecrets(
  opts: AwsSecretsOptions,
): Effect.Effect<ResolverResult, ResolverError> {
  return Effect.gen(function* () {
    const strict = opts.strict ?? false;
    const client = yield* createSdkClient(opts.region);

    // Group env keys by secret ID to minimize API calls.
    const secretIdToKeys = new Map<string, { envKey: string; jsonKey?: string }[]>();
    for (const [envKey, ref] of Object.entries(opts.secrets)) {
      const hashIndex = ref.indexOf("#");
      const secretId = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref;
      const jsonKey = hashIndex >= 0 ? ref.slice(hashIndex + 1) : undefined;

      const existing = secretIdToKeys.get(secretId) ?? [];
      existing.push({ envKey, jsonKey });
      secretIdToKeys.set(secretId, existing);
    }

    const uniqueSecretIds = [...secretIdToKeys.keys()];
    const secretValues = new Map<string, string | undefined>();

    if (uniqueSecretIds.length === 1) {
      const secretId = uniqueSecretIds[0]!;
      const value = yield* strictOrElse(Effect.tryPromise(() => client.getSecret(secretId)), {
        strict,
        resolver: "aws",
        message: `Failed to resolve secret "${secretId}"`,
        fallback: () => undefined,
      });
      secretValues.set(secretId, value);
    } else {
      const batchResult = yield* strictOrElse(Effect.tryPromise(() => client.getSecrets(uniqueSecretIds)), {
        strict,
        resolver: "aws",
        message: "Failed to resolve AWS secrets batch",
        fallback: () => new Map<string, string | undefined>(),
      });

      for (const [id, value] of batchResult) {
        secretValues.set(id, value);
      }
      fillMissingMapValues(uniqueSecretIds, secretValues);
    }

    const result: Record<string, string | undefined> = {};
    for (const [secretId, entries] of secretIdToKeys) {
      const rawValue = secretValues.get(secretId);
      for (const { envKey, jsonKey } of entries) {
        if (rawValue === undefined) {
          result[envKey] = undefined;
          continue;
        }

        if (!jsonKey) {
          result[envKey] = rawValue;
          continue;
        }

        try {
          const parsed = JSON.parse(rawValue) as Record<string, unknown>;
          result[envKey] = parsed[jsonKey] !== undefined ? String(parsed[jsonKey]) : undefined;
        } catch (cause) {
          if (strict) {
            return yield* toResolverError(
              "aws",
              `Failed to parse secret "${secretId}" as JSON while extracting key "${jsonKey}"`,
              cause,
            );
          }

          result[envKey] = undefined;
        }
      }
    }

    return result;
  });
}
