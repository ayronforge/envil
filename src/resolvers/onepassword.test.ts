import { describe, expect, test } from "bun:test";

import { Effect, Exit } from "effect";

import { fromOnePassword } from "./onepassword.ts";

function mockClient(responses: Record<string, string>) {
  return {
    secrets: {
      resolveAll: async (refs: string[]) => {
        return refs.map((ref) => {
          const value = responses[ref];
          if (value === undefined) throw new Error(`Secret "${ref}" not found`);
          return value;
        });
      },
    },
  };
}

describe("fromOnePassword", () => {
  test("resolves secrets via batch resolution", async () => {
    const client = mockClient({
      "op://vault/item/password": "s3cret",
      "op://vault/item/api-key": "key123",
    });

    const result = await Effect.runPromise(
      fromOnePassword({
        secrets: {
          DB_PASSWORD: "op://vault/item/password",
          API_KEY: "op://vault/item/api-key",
        },
        client,
      }),
    );

    expect(result.DB_PASSWORD).toBe("s3cret");
    expect(result.API_KEY).toBe("key123");
  });

  test("returns all undefined on batch failure", async () => {
    const client = {
      secrets: {
        resolveAll: async (_refs: string[]) => {
          throw new Error("Service unavailable");
        },
      },
    };

    const result = await Effect.runPromise(
      fromOnePassword({
        secrets: { A: "op://vault/item/a", B: "op://vault/item/b" },
        client,
      }),
    );

    expect(result.A).toBeUndefined();
    expect(result.B).toBeUndefined();
  });

  test("fails with ResolverError if neither client nor token is provided", async () => {
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
