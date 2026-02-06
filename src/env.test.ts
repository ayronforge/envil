import { afterEach, describe, expect, test } from "bun:test";

import { Effect, Schema } from "effect";

import { createEnv } from "./env.ts";
import { ClientAccessError, EnvValidationError } from "./errors.ts";
import { ResolverError, type ResolverResult } from "./resolvers/types.ts";
import {
  commaSeparated,
  optionalString,
  positiveNumber,
  redacted,
  requiredString,
  withDefault,
} from "./schemas.ts";

describe("createEnv", () => {
  describe("validation (happy path)", () => {
    test("validates and returns server vars", () => {
      const env = createEnv({
        server: { DB_URL: requiredString },
        runtimeEnv: { DB_URL: "postgres://localhost" },
        isServer: true,
      });
      expect(env.DB_URL).toBe("postgres://localhost");
    });

    test("validates and returns client vars", () => {
      const env = createEnv({
        client: { API_URL: requiredString },
        runtimeEnv: { API_URL: "http://api.test" },
        isServer: true,
      });
      expect(env.API_URL).toBe("http://api.test");
    });

    test("validates and returns shared vars", () => {
      const env = createEnv({
        shared: { APP_NAME: requiredString },
        runtimeEnv: { APP_NAME: "myapp" },
        isServer: true,
      });
      expect(env.APP_NAME).toBe("myapp");
    });

    test("works with all three dictionaries together", () => {
      const env = createEnv({
        server: { SECRET: requiredString },
        client: { API_URL: requiredString },
        shared: { APP_NAME: requiredString },
        runtimeEnv: { SECRET: "s", API_URL: "http://api", APP_NAME: "app" },
        isServer: true,
      });
      expect(env.SECRET).toBe("s");
      expect(env.API_URL).toBe("http://api");
      expect(env.APP_NAME).toBe("app");
    });

    test("works with empty schemas", () => {
      const env = createEnv({
        runtimeEnv: {},
        isServer: true,
      });
      expect(env).toBeDefined();
    });
  });

  describe("validation errors", () => {
    test("throws on missing required server var", () => {
      expect(() =>
        createEnv({
          server: { DB_URL: requiredString },
          runtimeEnv: {},
          isServer: true,
        }),
      ).toThrow("Invalid environment variables");
    });

    test("throws on missing required client var", () => {
      expect(() =>
        createEnv({
          client: { API_URL: requiredString },
          runtimeEnv: {},
          isServer: true,
        }),
      ).toThrow("Invalid environment variables");
    });

    test("throws on schema validation failure", () => {
      expect(() =>
        createEnv({
          server: { PORT: positiveNumber },
          runtimeEnv: { PORT: "not-a-number" },
          isServer: true,
        }),
      ).toThrow("Invalid environment variables");
    });

    test("collects multiple errors into single Error", () => {
      try {
        createEnv({
          server: { A: requiredString, B: requiredString },
          runtimeEnv: {},
          isServer: true,
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain("A:");
        expect(msg).toContain("B:");
      }
    });

    test("empty string fails requiredString", () => {
      expect(() =>
        createEnv({
          server: { NAME: requiredString },
          runtimeEnv: { NAME: "" },
          isServer: true,
        }),
      ).toThrow("Invalid environment variables");
    });

    test("throws EnvValidationError with structured errors and _tag", () => {
      try {
        createEnv({
          server: { A: requiredString, B: requiredString },
          runtimeEnv: {},
          isServer: true,
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(EnvValidationError);
        const err = e as EnvValidationError;
        expect(err._tag).toBe("EnvValidationError");
        expect(err.errors.length).toBe(2);
        expect(err.errors[0]).toContain("A:");
        expect(err.errors[1]).toContain("B:");
      }
    });
  });

  describe("client/server separation", () => {
    test("server vars are NOT validated when isServer is false", () => {
      // Should not throw even though DB_URL is missing
      const env = createEnv({
        server: { DB_URL: requiredString },
        client: { API_URL: requiredString },
        runtimeEnv: { API_URL: "http://api" },
        isServer: false,
      });
      expect(env.API_URL).toBe("http://api");
    });

    test("client + shared vars ARE validated on client", () => {
      expect(() =>
        createEnv({
          client: { API_URL: requiredString },
          shared: { APP: requiredString },
          runtimeEnv: {},
          isServer: false,
        }),
      ).toThrow("Invalid environment variables");
    });

    test("accessing server var from client proxy throws", () => {
      const env = createEnv({
        server: { SECRET: requiredString },
        client: { API_URL: requiredString },
        runtimeEnv: { API_URL: "http://api" },
        isServer: false,
      });
      expect(() => (env as Record<string, unknown>).SECRET).toThrow(
        'Attempted to access server-side env var "SECRET" on client',
      );
    });

    test("throws ClientAccessError with variableName and _tag", () => {
      const env = createEnv({
        server: { SECRET: requiredString },
        client: { API_URL: requiredString },
        runtimeEnv: { API_URL: "http://api" },
        isServer: false,
      });
      try {
        env.SECRET;
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ClientAccessError);
        const err = e as ClientAccessError;
        expect(err._tag).toBe("ClientAccessError");
        expect(err.variableName).toBe("SECRET");
      }
    });

    test("accessing client vars from client works fine", () => {
      const env = createEnv({
        server: { SECRET: requiredString },
        client: { API_URL: requiredString },
        runtimeEnv: { API_URL: "http://api" },
        isServer: false,
      });
      expect(env.API_URL).toBe("http://api");
    });

    test("accessing shared vars from client works fine", () => {
      const env = createEnv({
        server: { SECRET: requiredString },
        shared: { APP: requiredString },
        runtimeEnv: { APP: "myapp" },
        isServer: false,
      });
      expect(env.APP).toBe("myapp");
    });

    test("key in both server and client is accessible on client", () => {
      const env = createEnv({
        server: { DUAL: requiredString },
        client: { DUAL: requiredString },
        runtimeEnv: { DUAL: "value" },
        isServer: false,
      });
      expect(env.DUAL).toBe("value");
    });

    test("key in both server and shared is accessible on client", () => {
      const env = createEnv({
        server: { DUAL: requiredString },
        shared: { DUAL: requiredString },
        runtimeEnv: { DUAL: "value" },
        isServer: false,
      });
      expect(env.DUAL).toBe("value");
    });
  });

  describe("prefix", () => {
    test("prepends prefix to env key lookups", () => {
      const env = createEnv({
        server: { DB: requiredString },
        prefix: "MY_",
        runtimeEnv: { MY_DB: "value" },
        isServer: true,
      });
      expect(env.DB).toBe("value");
    });

    test("error messages include prefixed key name", () => {
      try {
        createEnv({
          server: { DB: requiredString },
          prefix: "MY_",
          runtimeEnv: {},
          isServer: true,
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("MY_DB:");
      }
    });

    test("empty prefix behaves like no prefix", () => {
      const env = createEnv({
        server: { DB: requiredString },
        prefix: "",
        runtimeEnv: { DB: "value" },
        isServer: true,
      });
      expect(env.DB).toBe("value");
    });
  });

  describe("redacted values", () => {
    test("proxy auto-unwraps Redacted values on access", () => {
      const env = createEnv({
        server: { SECRET: redacted(Schema.String) },
        runtimeEnv: { SECRET: "my-secret" },
        isServer: true,
      });
      expect(env.SECRET).toBe("my-secret");
    });

    test("non-redacted values pass through unchanged", () => {
      const env = createEnv({
        server: { NAME: requiredString },
        runtimeEnv: { NAME: "plain" },
        isServer: true,
      });
      expect(env.NAME).toBe("plain");
    });
  });

  describe("proxy edge cases", () => {
    test("returns undefined for Symbol properties", () => {
      const env = createEnv({
        server: { A: requiredString },
        runtimeEnv: { A: "val" },
        isServer: true,
      });
      expect((env as Record<symbol, unknown>)[Symbol("test")]).toBeUndefined();
    });

    test("returns undefined for non-existent keys", () => {
      const env = createEnv({
        server: { A: requiredString },
        runtimeEnv: { A: "val" },
        isServer: true,
      });
      expect((env as Record<string, unknown>).NONEXISTENT).toBeUndefined();
    });
  });

  describe("schema integration", () => {
    test("works with positiveNumber (string → number conversion)", () => {
      const env = createEnv({
        server: { PORT: positiveNumber },
        runtimeEnv: { PORT: "3000" },
        isServer: true,
      });
      expect(env.PORT).toBe(3000);
    });

    test("works with commaSeparated (string → array)", () => {
      const env = createEnv({
        server: { HOSTS: commaSeparated },
        runtimeEnv: { HOSTS: "a, b, c" },
        isServer: true,
      });
      expect(env.HOSTS).toEqual(["a", "b", "c"]);
    });

    test("works with withDefault (undefined → default value)", () => {
      const env = createEnv({
        server: { MODE: withDefault(Schema.String, "production") },
        runtimeEnv: {},
        isServer: true,
      });
      expect(env.MODE).toBe("production");
    });

    test("works with optionalString (undefined passes through)", () => {
      const env = createEnv({
        server: { OPT: optionalString },
        runtimeEnv: {},
        isServer: true,
      });
      expect(env.OPT).toBeUndefined();
    });
  });

  describe("defaults (process.env / isServer)", () => {
    const originalProcessEnv = process.env;

    afterEach(() => {
      process.env = originalProcessEnv;
    });

    test("falls back to process.env when runtimeEnv not provided", () => {
      process.env = { ...originalProcessEnv, TEST_VAR: "from-process" };
      const env = createEnv({
        server: { TEST_VAR: requiredString },
        isServer: true,
      });
      expect(env.TEST_VAR).toBe("from-process");
    });

    test("defaults isServer to true in Bun (no window global)", () => {
      // In Bun, typeof window === "undefined" → isServer defaults to true
      // So server vars should be validated
      const env = createEnv({
        server: { DB: requiredString },
        runtimeEnv: { DB: "value" },
      });
      expect(env.DB).toBe("value");
    });
  });

  describe("better error messages", () => {
    test("error contains specific validation details", () => {
      try {
        createEnv({
          server: { PORT: positiveNumber },
          runtimeEnv: { PORT: "not-a-number" },
          isServer: true,
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain("PORT:");
        expect(msg).not.toContain("invalid or missing");
      }
    });

    test("error for missing var includes schema details", () => {
      try {
        createEnv({
          server: { DB: requiredString },
          runtimeEnv: {},
          isServer: true,
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toContain("DB:");
        expect(msg).not.toContain("invalid or missing");
      }
    });
  });

  describe("onValidationError", () => {
    test("callback is called with error array", () => {
      const captured: string[][] = [];
      expect(() =>
        createEnv({
          server: { A: requiredString },
          runtimeEnv: {},
          isServer: true,
          onValidationError: (errors) => {
            captured.push(errors);
          },
        }),
      ).toThrow("Invalid environment variables");
      expect(captured).toHaveLength(1);
      expect(captured[0]!.length).toBe(1);
      expect(captured[0]![0]).toContain("A:");
    });

    test("default throw still happens if callback returns", () => {
      expect(() =>
        createEnv({
          server: { A: requiredString },
          runtimeEnv: {},
          isServer: true,
          onValidationError: () => {},
        }),
      ).toThrow("Invalid environment variables");
    });

    test("callback can throw custom error", () => {
      expect(() =>
        createEnv({
          server: { A: requiredString },
          runtimeEnv: {},
          isServer: true,
          onValidationError: (errors) => {
            throw new Error(`Custom: ${errors.join(", ")}`);
          },
        }),
      ).toThrow("Custom:");
    });
  });

  describe("emptyStringAsUndefined", () => {
    test("empty string is treated as undefined when flag is true", () => {
      expect(() =>
        createEnv({
          server: { NAME: requiredString },
          runtimeEnv: { NAME: "" },
          isServer: true,
          emptyStringAsUndefined: true,
        }),
      ).toThrow("Invalid environment variables");
    });

    test("empty string is kept as empty string when flag is false", () => {
      const env = createEnv({
        server: { NAME: Schema.String },
        runtimeEnv: { NAME: "" },
        isServer: true,
        emptyStringAsUndefined: false,
      });
      expect(env.NAME).toBe("");
    });

    test("empty string is kept as empty string when flag is omitted", () => {
      const env = createEnv({
        server: { NAME: Schema.String },
        runtimeEnv: { NAME: "" },
        isServer: true,
      });
      expect(env.NAME).toBe("");
    });

    test("works with withDefault (empty string triggers default)", () => {
      const env = createEnv({
        server: { MODE: withDefault(Schema.String, "production") },
        runtimeEnv: { MODE: "" },
        isServer: true,
        emptyStringAsUndefined: true,
      });
      expect(env.MODE).toBe("production");
    });

    test("non-empty strings are unaffected", () => {
      const env = createEnv({
        server: { NAME: requiredString },
        runtimeEnv: { NAME: "hello" },
        isServer: true,
        emptyStringAsUndefined: true,
      });
      expect(env.NAME).toBe("hello");
    });

    test("undefined values are unaffected", () => {
      const env = createEnv({
        server: { OPT: optionalString },
        runtimeEnv: {},
        isServer: true,
        emptyStringAsUndefined: true,
      });
      expect(env.OPT).toBeUndefined();
    });
  });

  describe("extends", () => {
    test("merges values from a single extended env", () => {
      const baseEnv = createEnv({
        server: { DB_URL: requiredString },
        runtimeEnv: { DB_URL: "postgres://localhost" },
        isServer: true,
      });
      const env = createEnv({
        extends: [baseEnv],
        server: { API_KEY: requiredString },
        runtimeEnv: { API_KEY: "key123" },
        isServer: true,
      });
      expect(env.DB_URL).toBe("postgres://localhost");
      expect(env.API_KEY).toBe("key123");
    });

    test("new schemas override extended values for same key", () => {
      const baseEnv = createEnv({
        server: { MODE: requiredString },
        runtimeEnv: { MODE: "development" },
        isServer: true,
      });
      const env = createEnv({
        extends: [baseEnv],
        server: { MODE: requiredString },
        runtimeEnv: { MODE: "production" },
        isServer: true,
      });
      expect(env.MODE).toBe("production");
    });

    test("multiple extends merge left-to-right (later overrides earlier)", () => {
      const env1 = createEnv({
        server: { A: requiredString },
        runtimeEnv: { A: "from-env1" },
        isServer: true,
      });
      const env2 = createEnv({
        server: { A: requiredString, B: requiredString },
        runtimeEnv: { A: "from-env2", B: "b-value" },
        isServer: true,
      });
      const env = createEnv({
        extends: [env1, env2],
        server: { C: requiredString },
        runtimeEnv: { C: "c-value" },
        isServer: true,
      });
      expect(env.A).toBe("from-env2");
      expect(env.B).toBe("b-value");
      expect(env.C).toBe("c-value");
    });

    test("extended values are not re-validated", () => {
      const baseEnv = createEnv({
        server: { DB_URL: requiredString },
        runtimeEnv: { DB_URL: "postgres://localhost" },
        isServer: true,
      });
      // No runtimeEnv entry for DB_URL, but it comes from extends
      const env = createEnv({
        extends: [baseEnv],
        runtimeEnv: {},
        isServer: true,
      });
      expect(env.DB_URL).toBe("postgres://localhost");
    });

    test("empty extends array works", () => {
      const env = createEnv({
        extends: [],
        server: { A: requiredString },
        runtimeEnv: { A: "val" },
        isServer: true,
      });
      expect(env.A).toBe("val");
    });

    test("works with only extends, no new schemas", () => {
      const baseEnv = createEnv({
        server: { DB_URL: requiredString },
        runtimeEnv: { DB_URL: "postgres://localhost" },
        isServer: true,
      });
      const env = createEnv({
        extends: [baseEnv],
        runtimeEnv: {},
        isServer: true,
      });
      expect(env.DB_URL).toBe("postgres://localhost");
    });
  });

  describe("prefix as object", () => {
    test("client keys use client prefix", () => {
      const env = createEnv({
        client: { API_URL: requiredString },
        prefix: { client: "NEXT_PUBLIC_" },
        runtimeEnv: { NEXT_PUBLIC_API_URL: "http://api" },
        isServer: true,
      });
      expect(env.API_URL).toBe("http://api");
    });

    test("each category uses its own prefix", () => {
      const env = createEnv({
        server: { DB: requiredString },
        client: { API_URL: requiredString },
        shared: { APP_NAME: requiredString },
        prefix: { server: "SRV_", client: "NEXT_PUBLIC_", shared: "SHARED_" },
        runtimeEnv: {
          SRV_DB: "value",
          NEXT_PUBLIC_API_URL: "http://api",
          SHARED_APP_NAME: "app",
        },
        isServer: true,
      });
      expect(env.DB).toBe("value");
      expect(env.API_URL).toBe("http://api");
      expect(env.APP_NAME).toBe("app");
    });

    test("omitted categories in prefix object default to no prefix", () => {
      const env = createEnv({
        server: { DB: requiredString },
        client: { API_URL: requiredString },
        prefix: { client: "NEXT_PUBLIC_" },
        runtimeEnv: { DB: "value", NEXT_PUBLIC_API_URL: "http://api" },
        isServer: true,
      });
      expect(env.DB).toBe("value");
      expect(env.API_URL).toBe("http://api");
    });

    test("works with preset spread", () => {
      const mockedPreset = { prefix: { client: "NEXT_PUBLIC_" } };
      const env = createEnv({
        ...mockedPreset,
        server: { DB: requiredString },
        client: { API_URL: requiredString },
        runtimeEnv: { DB: "value", NEXT_PUBLIC_API_URL: "http://api" },
        isServer: true,
      });
      expect(env.DB).toBe("value");
      expect(env.API_URL).toBe("http://api");
    });
  });

  describe("resolvers", () => {
    function fakeResolver(result: ResolverResult): Effect.Effect<ResolverResult, ResolverError> {
      return Effect.succeed(result);
    }

    function failingResolver(message: string): Effect.Effect<ResolverResult, ResolverError> {
      return Effect.fail(new ResolverError({ resolver: "test", message }));
    }

    test("resolver result flows into env validation", async () => {
      const env = await Effect.runPromise(
        createEnv({
          server: { DB_PASS: requiredString },
          resolvers: [fakeResolver({ DB_PASS: "secret123" })],
          isServer: true,
        }),
      );
      expect(env.DB_PASS).toBe("secret123");
    });

    test("multiple resolvers merge (later overrides earlier)", async () => {
      const env = await Effect.runPromise(
        createEnv({
          server: { A: requiredString, B: requiredString },
          resolvers: [fakeResolver({ A: "first", B: "first-b" }), fakeResolver({ A: "second" })],
          isServer: true,
        }),
      );
      expect(env.A).toBe("second");
      expect(env.B).toBe("first-b");
    });

    test("resolver + runtimeEnv base merge", async () => {
      const env = await Effect.runPromise(
        createEnv({
          server: { DB_HOST: requiredString, DB_PASS: requiredString },
          resolvers: [fakeResolver({ DB_PASS: "secret" })],
          runtimeEnv: { DB_HOST: "localhost" },
          isServer: true,
        }),
      );
      expect(env.DB_HOST).toBe("localhost");
      expect(env.DB_PASS).toBe("secret");
    });

    test("resolver result overlays on top of runtimeEnv", async () => {
      const env = await Effect.runPromise(
        createEnv({
          server: { KEY: requiredString },
          resolvers: [fakeResolver({ KEY: "from-resolver" })],
          runtimeEnv: { KEY: "from-runtime" },
          isServer: true,
        }),
      );
      expect(env.KEY).toBe("from-resolver");
    });

    test("resolver failure → ResolverError in error channel", async () => {
      const result = await Effect.runPromiseExit(
        createEnv({
          server: { A: requiredString },
          resolvers: [failingResolver("boom")],
          isServer: true,
        }),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        const error = (result.cause as { _tag: string; error: unknown }).error;
        expect(error).toBeInstanceOf(ResolverError);
        expect((error as ResolverError).message).toBe("boom");
      }
    });

    test("resolver OK but validation fails → EnvValidationError in error channel", async () => {
      const result = await Effect.runPromiseExit(
        createEnv({
          server: { A: requiredString, B: requiredString },
          resolvers: [fakeResolver({ A: "value" })],
          isServer: true,
        }),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        const error = (result.cause as { _tag: string; error: unknown }).error;
        expect(error).toBeInstanceOf(EnvValidationError);
      }
    });

    test("works with prefix", async () => {
      const env = await Effect.runPromise(
        createEnv({
          server: { DB: requiredString },
          prefix: "MY_",
          resolvers: [fakeResolver({ MY_DB: "value" })],
          isServer: true,
        }),
      );
      expect(env.DB).toBe("value");
    });

    test("works with extends", async () => {
      const baseEnv = createEnv({
        server: { BASE_KEY: requiredString },
        runtimeEnv: { BASE_KEY: "base-value" },
        isServer: true,
      });
      const env = await Effect.runPromise(
        createEnv({
          extends: [baseEnv],
          server: { RESOLVED_KEY: requiredString },
          resolvers: [fakeResolver({ RESOLVED_KEY: "resolved-value" })],
          isServer: true,
        }),
      );
      expect(env.BASE_KEY).toBe("base-value");
      expect(env.RESOLVED_KEY).toBe("resolved-value");
    });

    test("works with redacted", async () => {
      const env = await Effect.runPromise(
        createEnv({
          server: { SECRET: redacted(Schema.String) },
          resolvers: [fakeResolver({ SECRET: "my-secret" })],
          isServer: true,
        }),
      );
      expect(env.SECRET).toBe("my-secret");
    });

    test("works with withDefault", async () => {
      const env = await Effect.runPromise(
        createEnv({
          server: { MODE: withDefault(Schema.String, "production") },
          resolvers: [fakeResolver({})],
          isServer: true,
        }),
      );
      expect(env.MODE).toBe("production");
    });
  });
});
