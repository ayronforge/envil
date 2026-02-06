import { Effect } from "effect";

import { ResolverError, type ResolverResult } from "./types.ts";

export { ResolverError } from "./types.ts";

interface AzureKeyVaultClient {
  getSecret: (name: string) => Promise<{ value?: string }>;
}

interface AzureKeyVaultOptions {
  secrets: Record<string, string>;
  client?: AzureKeyVaultClient;
  vaultUrl?: string;
  credential?: unknown;
}

export function fromAzureKeyVault(
  opts: AzureKeyVaultOptions,
): Effect.Effect<ResolverResult, ResolverError> {
  return Effect.gen(function* () {
    const { secrets } = opts;

    let client = opts.client;
    if (!client) {
      if (!opts.vaultUrl) {
        return yield* new ResolverError({
          resolver: "azure",
          message: "Either client or vaultUrl must be provided",
        });
      }
      const vaultUrl = opts.vaultUrl;
      client = yield* Effect.tryPromise({
        try: async () => {
          const kvModule = await import("@azure/keyvault-secrets");
          const idModule = await import("@azure/identity");
          const credential = opts.credential ?? new idModule.DefaultAzureCredential();
          const sdkClient = new kvModule.SecretClient(vaultUrl, credential);
          return {
            getSecret: async (name: string) => {
              const secret = await sdkClient.getSecret(name);
              return { value: secret.value };
            },
          } satisfies AzureKeyVaultClient;
        },
        catch: (cause) =>
          new ResolverError({
            resolver: "azure",
            message: "Failed to initialize Azure Key Vault client",
            cause,
          }),
      });
    }

    const fetchClient = client;
    const entries = Object.entries(secrets);
    const results = yield* Effect.forEach(
      entries,
      ([envKey, secretName]) =>
        Effect.tryPromise(() => fetchClient.getSecret(secretName)).pipe(
          Effect.map((response) => ({ envKey, value: response.value })),
          Effect.orElseSucceed(() => ({ envKey, value: undefined as string | undefined })),
        ),
      { concurrency: "unbounded" },
    );

    const result: ResolverResult = {};
    for (const { envKey, value } of results) {
      result[envKey] = value;
    }
    return result;
  });
}
