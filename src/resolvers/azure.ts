import { Effect } from "effect";

import { ResolverError, type ResolverResult } from "./types.ts";

export { ResolverError } from "./types.ts";

interface AzureKeyVaultOptions<K extends string = string> {
  secrets: Record<K, string>;
  vaultUrl: string;
  credential?: unknown;
}

export function fromAzureKeyVault<K extends string>(
  opts: AzureKeyVaultOptions<K>,
): Effect.Effect<ResolverResult<K>, ResolverError>;
export function fromAzureKeyVault(
  opts: AzureKeyVaultOptions,
): Effect.Effect<ResolverResult, ResolverError> {
  return Effect.gen(function* () {
    const { secrets, vaultUrl } = opts;

    if (!vaultUrl) {
      return yield* new ResolverError({
        resolver: "azure",
        message: "vaultUrl must be provided",
      });
    }

    const client = yield* Effect.tryPromise({
      try: async () => {
        const kvModule = await import("@azure/keyvault-secrets");
        const idModule = await import("@azure/identity");
        const credential = opts.credential ?? new idModule.DefaultAzureCredential();
        const sdkClient = new kvModule.SecretClient(vaultUrl, credential);
        return {
          getSecret: async (name: string) => {
            const secret = await sdkClient.getSecret(name);
            return secret.value;
          },
        };
      },
      catch: (cause) =>
        new ResolverError({
          resolver: "azure",
          message: "Failed to initialize Azure Key Vault client",
          cause,
        }),
    });

    const entries = Object.entries(secrets);
    const results = yield* Effect.forEach(
      entries,
      ([envKey, secretName]) =>
        Effect.tryPromise(() => client.getSecret(secretName)).pipe(
          Effect.map((value) => ({ envKey, value })),
          Effect.orElseSucceed(() => ({ envKey, value: undefined })),
        ),
      { concurrency: "unbounded" },
    );

    const result: Record<string, string | undefined> = {};
    for (const { envKey, value } of results) {
      result[envKey] = value;
    }
    return result;
  });
}
