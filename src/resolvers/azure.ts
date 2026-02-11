import { Effect } from "effect";

import { ResolverError, type ResolverResult } from "./types.ts";
import { keyValueResultsToRecord, strictOrElse, toResolverError, tryInitializeClient } from "./utils.ts";

export { ResolverError } from "./types.ts";

interface AzureKeyVaultOptions<K extends string = string> {
  secrets: Record<K, string>;
  vaultUrl: string;
  credential?: unknown;
  strict?: boolean;
}

export function fromAzureKeyVault<K extends string>(
  opts: AzureKeyVaultOptions<K>,
): Effect.Effect<ResolverResult<K>, ResolverError>;
export function fromAzureKeyVault(
  opts: AzureKeyVaultOptions,
): Effect.Effect<ResolverResult, ResolverError> {
  return Effect.gen(function* () {
    const { secrets, vaultUrl, strict = false } = opts;

    if (!vaultUrl) {
      return yield* toResolverError("azure", "vaultUrl must be provided");
    }

    const client = yield* tryInitializeClient(
      "azure",
      "Failed to initialize Azure Key Vault client",
      async () => {
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
    );

    const results = yield* Effect.forEach(
      Object.entries(secrets),
      ([envKey, secretName]) =>
        strictOrElse(Effect.tryPromise(() => client.getSecret(secretName)), {
          strict,
          resolver: "azure",
          message: `Failed to resolve secret "${secretName}" for env key "${envKey}"`,
          fallback: () => undefined,
        }).pipe(Effect.map((value) => ({ envKey, value }))),
      { concurrency: "unbounded" },
    );

    return keyValueResultsToRecord(results);
  });
}
