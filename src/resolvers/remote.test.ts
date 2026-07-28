import { describe, expect, test } from "bun:test";

import { Effect, Option, Redacted } from "effect";

import { SecretSource, SecretSourceRequestFailed, customSecretsAdapter } from "./remote.ts";

describe("SecretSource", () => {
  test("fromPromise redacts present strings immediately", async () => {
    const layer = SecretSource.fromPromise({
      get: async () => Option.some("secret-value"),
    });
    const result = await Effect.runPromise(
      customSecretsAdapter
        .resolve({
          secrets: { TOKEN: "remote-reference" },
        })
        .pipe(Effect.provide(layer)),
    );

    expect(Option.isSome(result.TOKEN)).toBe(true);
    if (Option.isSome(result.TOKEN)) {
      expect(Redacted.isRedacted(result.TOKEN.value)).toBe(true);
      expect(Redacted.value(result.TOKEN.value)).toBe("secret-value");
    }
  });

  test("preserves explicit absence", async () => {
    const layer = SecretSource.fromPromise({
      get: async () => Option.none(),
    });
    const result = await Effect.runPromise(
      customSecretsAdapter
        .resolve({
          secrets: { TOKEN: "remote-reference" },
        })
        .pipe(Effect.provide(layer)),
    );

    expect(Option.isNone(result.TOKEN)).toBe(true);
  });

  test("sanitizes Promise rejection", async () => {
    const secret = "secret-in-provider-error";
    const layer = SecretSource.fromPromise({
      get: async () => {
        throw new Error(secret);
      },
    });
    const exit = await Effect.runPromiseExit(
      customSecretsAdapter
        .resolve({
          secrets: { TOKEN: "private-reference" },
        })
        .pipe(Effect.provide(layer)),
    );

    expect(exit._tag).toBe("Failure");
    expect(String(exit)).toContain("SecretSourceRequestFailed");
    expect(String(exit)).not.toContain(secret);
    expect(String(exit)).not.toContain("private-reference");
  });

  test("direct services may retain granular typed errors", async () => {
    const layer = SecretSource.of({
      get: () => Effect.fail(new SecretSourceRequestFailed()),
    });
    const exit = await Effect.runPromiseExit(
      customSecretsAdapter
        .resolve({ secrets: { TOKEN: "reference" } })
        .pipe(Effect.provideService(SecretSource, layer)),
    );

    expect(exit._tag).toBe("Failure");
  });
});
