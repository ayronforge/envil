import { Effect } from "effect";

import { ResolverError, type ResolverResult } from "./types.ts";

export { ResolverError } from "./types.ts";

interface GcpSecretsOptions<K extends string = string> {
  secrets: Record<K, string>;
  projectId?: string;
  version?: string;
}

export function fromGcpSecrets<K extends string>(
  opts: GcpSecretsOptions<K>,
): Effect.Effect<ResolverResult<K>, ResolverError>;
export function fromGcpSecrets(
  opts: GcpSecretsOptions,
): Effect.Effect<ResolverResult, ResolverError> {
  return Effect.gen(function* () {
    const { secrets, projectId, version = "latest" } = opts;

    const client = yield* Effect.tryPromise({
      try: async () => {
        const sdk = await import("@google-cloud/secret-manager");
        const sdkClient = new sdk.SecretManagerServiceClient();
        return {
          getSecret: async (name: string) => {
            const [response] = await sdkClient.accessSecretVersion({ name });
            const data = response.payload?.data;
            return data instanceof Uint8Array ? new TextDecoder().decode(data) : data ?? undefined;
          },
        };
      },
      catch: (cause) =>
        new ResolverError({
          resolver: "gcp",
          message: "Failed to initialize GCP Secret Manager client",
          cause,
        }),
    });

    const entries = Object.entries(secrets);
    const results = yield* Effect.forEach(
      entries,
      ([envKey, secretName]) =>
        Effect.tryPromise(async () => {
          const name = secretName.startsWith("projects/")
            ? secretName
            : `projects/${projectId}/secrets/${secretName}/versions/${version}`;

          const value = await client.getSecret(name);
          return { envKey, value };
        }).pipe(Effect.orElseSucceed(() => ({ envKey, value: undefined }))),
      { concurrency: "unbounded" },
    );

    const result: Record<string, string | undefined> = {};
    for (const { envKey, value } of results) {
      result[envKey] = value;
    }
    return result;
  });
}
