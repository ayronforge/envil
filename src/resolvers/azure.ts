import type { TokenCredential } from "@azure/core-auth";
import { Effect } from "effect";

import {
  ResolverConfigurationError,
  type ResolverAdapter,
  type ResolverError,
  type ResolverResult,
} from "./types.ts";
import {
  hasFailureField,
  initializeAdapter,
  requestSecret,
  resolverEntries,
  resolverRecord,
} from "./utils.ts";

/** Azure Key Vault adapter options. */
export interface AzureKeyVaultAdapterOptions {
  readonly vaultUrl: string;
  readonly credential?: TokenCredential;
}

function isAzureNotFound(failure: unknown): boolean {
  return hasFailureField(failure, "statusCode", 404);
}

function resolveAzureSecrets<const Keys extends string>(
  options: AzureKeyVaultAdapterOptions & {
    readonly secrets: Readonly<Record<Keys, string>>;
  },
): Effect.Effect<ResolverResult<Keys>, ResolverError> {
  return Effect.gen(function* () {
    if (options.vaultUrl.length === 0) {
      return yield* new ResolverConfigurationError({
        adapter: "azure",
        operation: "configure",
        message: "vaultUrl is required by the Azure Key Vault adapter",
      });
    }

    const client = yield* initializeAdapter("azure", async () => {
      const keyVault = await import("@azure/keyvault-secrets");
      const identity = await import("@azure/identity");
      const credential = options.credential ?? new identity.DefaultAzureCredential();
      return new keyVault.SecretClient(options.vaultUrl, credential);
    });
    const entries = yield* Effect.forEach(
      resolverEntries(options.secrets),
      ([key, secretName]) =>
        requestSecret(
          "azure",
          "read",
          async () => (await client.getSecret(secretName)).value,
          isAzureNotFound,
        ).pipe(Effect.map((value) => [key, value] as const)),
      { concurrency: "unbounded" },
    );

    return resolverRecord(entries);
  });
}

/** Resolver adapter for Azure Key Vault. */
export const azureKeyVaultAdapter: ResolverAdapter<
  "azure",
  string,
  AzureKeyVaultAdapterOptions,
  ResolverError,
  never
> = {
  name: "azure",
  resolve: resolveAzureSecrets,
};
