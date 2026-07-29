import { describe, expect, mock, test } from "bun:test";

import type { KeyVaultSecret } from "@azure/keyvault-secrets";
import { Effect, Option, Redacted } from "effect";

import { azureKeyVaultAdapter } from "./azure.ts";

let getAzureSecret: (name: string) => Promise<KeyVaultSecret>;

mock.module("@azure/keyvault-secrets", () => ({
  SecretClient: class {
    getSecret(name: string) {
      return getAzureSecret(name);
    }
  },
}));

mock.module("@azure/identity", () => ({
  DefaultAzureCredential: class {},
}));

describe("azureKeyVaultAdapter", () => {
  test("fails empty vault configuration before initializing the SDK", async () => {
    const exit = await Effect.runPromiseExit(
      azureKeyVaultAdapter.resolve({
        vaultUrl: "",
        referencesByKey: { TOKEN: "remote-reference" },
      }),
    );

    expect(exit._tag).toBe("Failure");
    expect(String(exit)).toContain("ResolverConfigurationError");
    expect(String(exit)).toContain('Set "vaultUrl"');
    expect(String(exit)).not.toContain("remote-reference");
  });

  test("maps the SDK 404 signal to Option.none", async () => {
    getAzureSecret = () => Promise.reject({ statusCode: 404 });

    const result = await Effect.runPromise(
      azureKeyVaultAdapter.resolve({
        vaultUrl: "https://vault.example.com",
        referencesByKey: { TOKEN: "missing-secret" },
      }),
    );

    expect(Option.isNone(result.TOKEN)).toBe(true);
  });

  test("reads and redacts the official SDK response", async () => {
    getAzureSecret = () =>
      Promise.resolve({
        name: "token",
        value: "resolved-value",
        properties: { name: "token", vaultUrl: "https://vault.example.com" },
      });

    const result = await Effect.runPromise(
      azureKeyVaultAdapter.resolve({
        vaultUrl: "https://vault.example.com",
        referencesByKey: { TOKEN: "token" },
      }),
    );

    expect(Option.isSome(result.TOKEN)).toBe(true);
    if (Option.isSome(result.TOKEN)) {
      expect(Redacted.value(result.TOKEN.value)).toBe("resolved-value");
    }
  });

  test("sanitizes operational SDK failures", async () => {
    getAzureSecret = () => Promise.reject(new Error("private provider response"));

    const exit = await Effect.runPromiseExit(
      azureKeyVaultAdapter.resolve({
        vaultUrl: "https://private-vault.example.com",
        referencesByKey: { TOKEN: "private-reference" },
      }),
    );

    expect(String(exit)).toContain("ResolverRequestFailed");
    expect(String(exit)).not.toContain("private provider response");
    expect(String(exit)).not.toContain("private-vault");
    expect(String(exit)).not.toContain("private-reference");
  });
});
