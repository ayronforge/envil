import { afterEach, describe, expect, mock, test } from "bun:test";

import type { ResolveAllResponse } from "@1password/sdk";
import { Effect, Option, Redacted } from "effect";

import { onePasswordSecretsAdapter } from "./onepassword.ts";

const originalToken = process.env.OP_SERVICE_ACCOUNT_TOKEN;
let resolveOnePasswordReferences: (references: string[]) => Promise<ResolveAllResponse>;

mock.module("@1password/sdk", () => ({
  createClient: () =>
    Promise.resolve({
      secrets: {
        resolveAll: (references: string[]) => resolveOnePasswordReferences(references),
      },
    }),
}));

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
  } else {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = originalToken;
  }
});

describe("onePasswordSecretsAdapter", () => {
  test("fails missing credentials without exposing references", async () => {
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
    const exit = await Effect.runPromiseExit(
      onePasswordSecretsAdapter.resolve({
        secrets: { TOKEN: "op://private/item/field" },
      }),
    );

    expect(exit._tag).toBe("Failure");
    expect(String(exit)).toContain("ResolverConfigurationError");
    expect(String(exit)).not.toContain("op://private/item/field");
  });

  test("respects the SDK resolveAll response shape", async () => {
    const reference = "op://vault/item/field";
    resolveOnePasswordReferences = () =>
      Promise.resolve({
        individualResponses: {
          [reference]: {
            content: {
              secret: "resolved-value",
              itemId: "item",
              vaultId: "vault",
            },
          },
        },
      });

    const result = await Effect.runPromise(
      onePasswordSecretsAdapter.resolve({
        serviceAccountToken: "token",
        secrets: { TOKEN: reference },
      }),
    );

    expect(Option.isSome(result.TOKEN)).toBe(true);
    if (Option.isSome(result.TOKEN)) {
      expect(Redacted.value(result.TOKEN.value)).toBe("resolved-value");
    }
  });

  test("fails closed on a partial resolveAll response", async () => {
    const firstReference = "op://vault/item/first";
    const secondReference = "op://vault/item/second";
    resolveOnePasswordReferences = () =>
      Promise.resolve({
        individualResponses: {
          [firstReference]: {
            content: {
              secret: "resolved-value",
              itemId: "item",
              vaultId: "vault",
            },
          },
        },
      });

    const exit = await Effect.runPromiseExit(
      onePasswordSecretsAdapter.resolve({
        serviceAccountToken: "token",
        secrets: {
          FIRST: firstReference,
          SECOND: secondReference,
        },
      }),
    );

    expect(String(exit)).toContain("ResolverRequestFailed");
    expect(String(exit)).not.toContain(firstReference);
    expect(String(exit)).not.toContain(secondReference);
  });

  test("sanitizes provider rejection", async () => {
    resolveOnePasswordReferences = () => Promise.reject(new Error("private provider response"));

    const exit = await Effect.runPromiseExit(
      onePasswordSecretsAdapter.resolve({
        serviceAccountToken: "token",
        secrets: { TOKEN: "op://private/item/field" },
      }),
    );

    expect(String(exit)).toContain("ResolverRequestFailed");
    expect(String(exit)).not.toContain("private provider response");
    expect(String(exit)).not.toContain("op://private/item/field");
  });
});
