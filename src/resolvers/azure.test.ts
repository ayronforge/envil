import { beforeEach, describe, expect, mock, test } from "bun:test";

import { Effect, Exit } from "effect";

const secretStore = new Map<string, string>();

mock.module("@azure/keyvault-secrets", () => ({
  SecretClient: class {
    constructor(_vaultUrl: string, _credential: unknown) {}
    getSecret(name: string) {
      const value = secretStore.get(name);
      if (value === undefined) return Promise.reject(new Error(`Secret "${name}" not found`));
      return Promise.resolve({ value });
    }
  },
}));

mock.module("@azure/identity", () => ({
  DefaultAzureCredential: class {},
}));

const { fromAzureKeyVault } = await import("./azure.ts");

describe("fromAzureKeyVault", () => {
  beforeEach(() => {
    secretStore.clear();
  });

  test("resolves a single secret", async () => {
    secretStore.set("my-secret", "secret-value");

    const result = await Effect.runPromise(
      fromAzureKeyVault({
        secrets: { DB_PASSWORD: "my-secret" },
        vaultUrl: "https://test-vault.vault.azure.net",
      }),
    );

    expect(result.DB_PASSWORD).toBe("secret-value");
  });

  test("resolves multiple secrets concurrently", async () => {
    secretStore.set("secret-a", "value-a");
    secretStore.set("secret-b", "value-b");
    secretStore.set("secret-c", "value-c");

    const result = await Effect.runPromise(
      fromAzureKeyVault({
        secrets: { A: "secret-a", B: "secret-b", C: "secret-c" },
        vaultUrl: "https://test-vault.vault.azure.net",
      }),
    );

    expect(result.A).toBe("value-a");
    expect(result.B).toBe("value-b");
    expect(result.C).toBe("value-c");
  });

  test("returns undefined for missing secrets", async () => {
    secretStore.set("existing", "value");

    const result = await Effect.runPromise(
      fromAzureKeyVault({
        secrets: { EXISTING: "existing", MISSING: "nonexistent" },
        vaultUrl: "https://test-vault.vault.azure.net",
      }),
    );

    expect(result.EXISTING).toBe("value");
    expect(result.MISSING).toBeUndefined();
  });

  test("fails with ResolverError if vaultUrl is empty", async () => {
    const exit = await Effect.runPromiseExit(
      fromAzureKeyVault({ secrets: { A: "secret" }, vaultUrl: "" as any }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
