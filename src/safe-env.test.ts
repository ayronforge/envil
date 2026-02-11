import { describe, expect, test } from "bun:test";

import { Effect, Redacted, Schema } from "effect";

import { EnvValidationError } from "./errors.ts";
import { ResolverError, type ResolverResult } from "./resolvers/types.ts";
import { safeCreateEnv } from "./safe-env.ts";
import { optional, redacted, requiredString, withDefault } from "./schemas.ts";

describe("safeCreateEnv", () => {
  function fakeResolver<T extends Record<string, string | undefined>>(
    result: T,
  ): Effect.Effect<ResolverResult<Extract<keyof T, string>>, ResolverError> {
    return Effect.succeed(result);
  }

  function failingResolver(message: string): Effect.Effect<ResolverResult, ResolverError> {
    return Effect.fail(new ResolverError({ resolver: "test", message }));
  }

  test("returns success result for sync parse success", () => {
    const result = safeCreateEnv({
      server: { MODE: withDefault(Schema.String, "production") },
      runtimeEnv: {},
      isServer: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MODE).toBe("production");
    }
  });

  test("returns failure result for sync parse failure", () => {
    const result = safeCreateEnv({
      server: { REQUIRED: requiredString },
      runtimeEnv: {},
      isServer: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(EnvValidationError);
    }
  });

  test("returns an Effect result object when resolvers are provided", async () => {
    const result = await Effect.runPromise(
      safeCreateEnv({
        server: { SECRET: requiredString },
        resolvers: [fakeResolver({ SECRET: "shhh" })],
        isServer: true,
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Redacted.isRedacted(result.data.SECRET)).toBe(true);
      expect(Redacted.value(result.data.SECRET)).toBe("shhh");
    }
  });

  test("resolver failures are returned as failure result objects", async () => {
    const result = await Effect.runPromise(
      safeCreateEnv({
        server: { SECRET: requiredString },
        resolvers: [failingResolver("boom")],
        isServer: true,
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ResolverError);
      expect(result.error.message).toBe("boom");
    }
  });

  test("resolvers: [] still returns an Effect result object", async () => {
    const result = await Effect.runPromise(
      safeCreateEnv({
        server: { OPTIONAL_VALUE: optional(Schema.String) },
        resolvers: [],
        runtimeEnv: {},
        isServer: true,
      }),
    );

    expect(result.success).toBe(true);
  });

  test("autoRedactResolver: false returns plain values from resolvers", async () => {
    const result = await Effect.runPromise(
      safeCreateEnv({
        server: { SECRET: redacted(Schema.String), PLAIN: requiredString },
        resolvers: [fakeResolver({ SECRET: "secret", PLAIN: "plain-value" })],
        autoRedactResolver: false,
        isServer: true,
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Redacted.isRedacted(result.data.SECRET)).toBe(true);
      expect(result.data.PLAIN).toBe("plain-value");
    }
  });
});
