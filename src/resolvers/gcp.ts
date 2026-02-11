import { Effect } from "effect";

import { ResolverError, type ResolverResult } from "./types.ts";
import {
  keyValueResultsToRecord,
  strictOrElse,
  toResolverError,
  tryInitializeClient,
} from "./utils.ts";

export { ResolverError } from "./types.ts";

interface GcpSecretsOptions<K extends string = string> {
  secrets: Record<K, string>;
  projectId?: string;
  version?: string;
  strict?: boolean;
}

export function fromGcpSecrets<K extends string>(
  opts: GcpSecretsOptions<K>,
): Effect.Effect<ResolverResult<K>, ResolverError>;
export function fromGcpSecrets(
  opts: GcpSecretsOptions,
): Effect.Effect<ResolverResult, ResolverError> {
  return Effect.gen(function* () {
    const { secrets, projectId, version = "latest", strict = false } = opts;
    const usesShortSecretName = Object.values(secrets).some(
      (secretName) => !secretName.startsWith("projects/"),
    );

    if (usesShortSecretName && !projectId) {
      return yield* toResolverError(
        "gcp",
        "projectId must be provided when using short secret names",
      );
    }

    const client = yield* tryInitializeClient(
      "gcp",
      "Failed to initialize GCP Secret Manager client",
      async () => {
        const sdk = await import("@google-cloud/secret-manager");
        const sdkClient = new sdk.SecretManagerServiceClient();
        return {
          getSecret: async (name: string) => {
            const [response] = await sdkClient.accessSecretVersion({ name });
            const data = response.payload?.data;
            return data instanceof Uint8Array
              ? new TextDecoder().decode(data)
              : (data ?? undefined);
          },
        };
      },
    );

    const results = yield* Effect.forEach(
      Object.entries(secrets),
      ([envKey, secretName]) => {
        const name = secretName.startsWith("projects/")
          ? secretName
          : `projects/${projectId}/secrets/${secretName}/versions/${version}`;

        return strictOrElse(
          Effect.tryPromise(() => client.getSecret(name)),
          {
            strict,
            resolver: "gcp",
            message: `Failed to resolve secret "${secretName}" for env key "${envKey}"`,
            fallback: () => undefined,
          },
        ).pipe(Effect.map((value) => ({ envKey, value })));
      },
      { concurrency: "unbounded" },
    );

    return keyValueResultsToRecord(results);
  });
}
