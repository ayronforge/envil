import { beforeEach, describe, expect, mock, test } from "bun:test";

import { Effect, Exit } from "effect";

const secretStore = new Map<string, string>();

mock.module("@1password/sdk", () => ({
  createClient: async (_opts: any) => ({
    secrets: {
      resolveAll: async (refs: string[]) => {
        return refs.map((ref) => {
          const value = secretStore.get(ref);
          if (value === undefined) throw new Error(`Secret "${ref}" not found`);
          return value;
        });
      },
    },
  }),
}));

const { fromOnePassword, ResolverError } = await import("./onepassword.ts");

describe("fromOnePassword", () => {
  beforeEach(() => {
    secretStore.clear();
  });

  test("resolves secrets via batch resolution", async () => {
    secretStore.set("op://vault/item/password", "s3cret");
    secretStore.set("op://vault/item/api-key", "key123");

    const result = await Effect.runPromise(
      fromOnePassword({
        secrets: {
          DB_PASSWORD: "op://vault/item/password",
          API_KEY: "op://vault/item/api-key",
        },
        serviceAccountToken: "test-token",
      }),
    );

    expect(result.DB_PASSWORD).toBe("s3cret");
    expect(result.API_KEY).toBe("key123");
  });

  test("returns all undefined on batch failure", async () => {
    // secretStore is empty, so resolveAll will throw

    const result = await Effect.runPromise(
      fromOnePassword({
        secrets: { A: "op://vault/item/a", B: "op://vault/item/b" },
        serviceAccountToken: "test-token",
      }),
    );

    expect(result.A).toBeUndefined();
    expect(result.B).toBeUndefined();
  });

  test("strict mode fails on batch resolution error", async () => {
    const exit = await Effect.runPromiseExit(
      fromOnePassword({
        secrets: { A: "op://vault/item/a", B: "op://vault/item/b" },
        serviceAccountToken: "test-token",
        strict: true,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = (exit.cause as { _tag: string; error: unknown }).error;
      expect(error).toBeInstanceOf(ResolverError);
      expect((error as ResolverError).message).toBe("Failed to resolve 1Password secrets");
    }
  });

  test("fails with ResolverError if neither token nor env var is provided", async () => {
    const originalEnv = process.env.OP_SERVICE_ACCOUNT_TOKEN;
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;

    try {
      const exit = await Effect.runPromiseExit(
        fromOnePassword({ secrets: { A: "op://vault/item/a" } }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
    } finally {
      if (originalEnv !== undefined) {
        process.env.OP_SERVICE_ACCOUNT_TOKEN = originalEnv;
      }
    }
  });
});
