import { describe, expect, test } from "bun:test";

import { Effect, Exit } from "effect";

import { fromAzureKeyVault } from "./azure.ts";

function mockClient(secrets: Record<string, string | undefined>) {
  return {
    getSecret: async (name: string) => {
      const value = secrets[name];
      if (value === undefined) throw new Error(`Secret "${name}" not found`);
      return { value };
    },
  };
}

describe("fromAzureKeyVault", () => {
  test("resolves a single secret", async () => {
    const client = mockClient({ "my-secret": "secret-value" });

    const result = await Effect.runPromise(
      fromAzureKeyVault({ secrets: { DB_PASSWORD: "my-secret" }, client }),
    );

    expect(result.DB_PASSWORD).toBe("secret-value");
  });

  test("resolves multiple secrets concurrently", async () => {
    const client = mockClient({
      "secret-a": "value-a",
      "secret-b": "value-b",
      "secret-c": "value-c",
    });

    const result = await Effect.runPromise(
      fromAzureKeyVault({
        secrets: { A: "secret-a", B: "secret-b", C: "secret-c" },
        client,
      }),
    );

    expect(result.A).toBe("value-a");
    expect(result.B).toBe("value-b");
    expect(result.C).toBe("value-c");
  });

  test("returns undefined for missing secrets", async () => {
    const client = mockClient({ existing: "value" });

    const result = await Effect.runPromise(
      fromAzureKeyVault({
        secrets: { EXISTING: "existing", MISSING: "nonexistent" },
        client,
      }),
    );

    expect(result.EXISTING).toBe("value");
    expect(result.MISSING).toBeUndefined();
  });

  test("fails with ResolverError if neither client nor vaultUrl is provided", async () => {
    const exit = await Effect.runPromiseExit(fromAzureKeyVault({ secrets: { A: "secret" } }));

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
