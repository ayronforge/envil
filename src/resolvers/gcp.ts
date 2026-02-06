import { Effect } from "effect";

import { ResolverError, type ResolverResult } from "./types.ts";

export { ResolverError } from "./types.ts";

interface GcpSecretsClient {
  accessSecretVersion: (request: {
    name: string;
  }) => Promise<{ payload?: { data?: Uint8Array | string } }>;
}

interface GcpSecretsOptions<K extends string = string> {
  secrets: Record<K, string>;
  client?: GcpSecretsClient;
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

    let client = opts.client;
    if (!client) {
      client = yield* Effect.tryPromise({
        try: async () => {
          const sdk = await import("@google-cloud/secret-manager");
          const sdkClient = new sdk.SecretManagerServiceClient();
          return {
            accessSecretVersion: async (request: { name: string }) => {
              const [response] = await sdkClient.accessSecretVersion({ name: request.name });
              return { payload: { data: response.payload?.data ?? undefined } };
            },
          } satisfies GcpSecretsClient;
        },
        catch: (cause) =>
          new ResolverError({
            resolver: "gcp",
            message: "Failed to initialize GCP Secret Manager client",
            cause,
          }),
      });
    }

    const fetchClient = client;
    const entries = Object.entries(secrets);
    const results = yield* Effect.forEach(
      entries,
      ([envKey, secretName]) =>
        Effect.tryPromise(async () => {
          const name = secretName.startsWith("projects/")
            ? secretName
            : `projects/${projectId}/secrets/${secretName}/versions/${version}`;

          const response = await fetchClient.accessSecretVersion({ name });
          const data = response.payload?.data;
          const value = data instanceof Uint8Array ? new TextDecoder().decode(data) : data;
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
