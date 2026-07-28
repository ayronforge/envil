import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

import { Cause, Effect, Option, Redacted, Schema } from "effect";

import { ClientAccessError, EnvConfigurationError, EnvValidationError } from "./errors.ts";
import { asResult } from "./result.ts";

import {
  SecretSource,
  createEnv,
  createEnvPromise,
  createEnvSync,
  customSecretsAdapter,
  optional,
  redacted,
  requiredString,
} from "./index.ts";

describe("environment creation boundaries", () => {
  test("createEnv always returns an Effect", async () => {
    const effect = createEnv({
      server: { DATABASE_URL: requiredString },
      runtimeEnv: { DATABASE_URL: "postgres://localhost" },
    });

    expect(Effect.isEffect(effect)).toBe(true);
    expect((await Effect.runPromise(effect)).DATABASE_URL).toBe("postgres://localhost");
  });

  test("sync and Promise boundaries preserve decoded values", async () => {
    const options = {
      server: { PORT: Schema.NumberFromString },
      runtimeEnv: { PORT: "3000" },
    };

    expect(createEnvSync(options).PORT).toBe(3000);
    expect((await createEnvPromise(options)).PORT).toBe(3000);
  });

  test("composition preserves inherited values and applies local overrides", () => {
    const baseEnv = createEnvSync({
      server: {
        BASE_URL: requiredString,
        SERVICE_NAME: requiredString,
      },
      runtimeEnv: {
        BASE_URL: "https://base.example.com",
        SERVICE_NAME: "base",
      },
    });
    const env = createEnvSync({
      extends: [baseEnv],
      server: {
        SERVICE_NAME: requiredString,
      },
      runtimeEnv: {
        SERVICE_NAME: "local",
      },
    });

    expect(env.BASE_URL).toBe("https://base.example.com");
    expect(env.SERVICE_NAME).toBe("local");
  });

  test("composition does not reapply the current prefix to resolved environments", () => {
    const serverEnv = createEnvSync({
      server: { PUBLIC_URL: requiredString },
      runtimeEnv: { PUBLIC_URL: "server" },
    });
    const clientEnv = createEnvSync({
      client: { URL: requiredString },
      prefix: { client: "VITE_" },
      runtimeEnv: { VITE_URL: "client" },
    });

    const env = createEnvSync({
      extends: [serverEnv, clientEnv],
      prefix: { client: "PUBLIC_" },
    });

    expect(env.PUBLIC_URL).toBe("server");
    expect(env.URL).toBe("client");
  });

  test("each creation boundary resolves matching extends inputs", async () => {
    const effectBase = createEnv({
      server: { EFFECT_VALUE: requiredString },
      runtimeEnv: { EFFECT_VALUE: "effect" },
    });
    const promiseBase = createEnvPromise({
      server: { PROMISE_VALUE: requiredString },
      runtimeEnv: { PROMISE_VALUE: "promise" },
    });

    const effectEnv = await Effect.runPromise(createEnv({ extends: [effectBase] }));
    const promiseEnv = await createEnvPromise({ extends: [promiseBase] });

    expect(effectEnv.EFFECT_VALUE).toBe("effect");
    expect(promiseEnv.PROMISE_VALUE).toBe("promise");
  });

  test("resolver values are authoritative and automatically redacted", async () => {
    const layer = SecretSource.fromPromise({
      get: async () => Option.some("resolved-value"),
    });
    const env = await Effect.runPromise(
      createEnv({
        server: { TOKEN: requiredString },
        runtimeEnv: { TOKEN: "runtime-value" },
        resolvers: ({ resolve }) => [
          resolve(customSecretsAdapter, {
            secrets: { TOKEN: "remote-reference" },
          }),
        ],
      }).pipe(Effect.provide(layer)),
    );

    expect(Redacted.isRedacted(env.TOKEN)).toBe(true);
    expect(Redacted.value(env.TOKEN)).toBe("resolved-value");
  });

  test("resolver absence does not fall back to runtime values", async () => {
    const layer = SecretSource.fromPromise({
      get: async () => Option.none(),
    });
    const exit = await Effect.runPromiseExit(
      createEnv({
        server: { TOKEN: requiredString },
        runtimeEnv: { TOKEN: "must-not-be-used" },
        resolvers: ({ resolve }) => [
          resolve(customSecretsAdapter, {
            secrets: { TOKEN: "remote-reference" },
          }),
        ],
      }).pipe(Effect.provide(layer)),
    );

    expect(exit._tag).toBe("Failure");
    expect(String(exit)).not.toContain("must-not-be-used");
    expect(String(exit)).not.toContain("remote-reference");
  });

  test("optional resolver absence remains undefined outside Redacted", async () => {
    const layer = SecretSource.fromPromise({
      get: async () => Option.none(),
    });
    const env = await Effect.runPromise(
      createEnv({
        server: { TOKEN: optional(requiredString) },
        resolvers: ({ resolve }) => [
          resolve(customSecretsAdapter, {
            secrets: { TOKEN: "remote-reference" },
          }),
        ],
      }).pipe(Effect.provide(layer)),
    );

    expect(env.TOKEN).toBeUndefined();
  });

  test("createEnvPromise accepts the required custom Layer", async () => {
    const env = await createEnvPromise(
      {
        server: { TOKEN: requiredString },
        resolvers: ({ resolve }) => [
          resolve(customSecretsAdapter, {
            secrets: { TOKEN: "remote-reference" },
          }),
        ],
      },
      {
        layer: SecretSource.fromPromise({
          get: async () => Option.some("resolved-value"),
        }),
      },
    );

    expect(Redacted.value(env.TOKEN)).toBe("resolved-value");
  });
});

describe("validation and security", () => {
  test("redacted runtime schemas remain redacted", () => {
    const env = createEnvSync({
      server: { TOKEN: redacted(requiredString) },
      runtimeEnv: { TOKEN: "secret-value" },
    });

    expect(Redacted.isRedacted(env.TOKEN)).toBe(true);
    expect(String(env.TOKEN)).not.toContain("secret-value");
  });

  test("redacted optional schemas preserve undefined outside Redacted", () => {
    const outerRedacted = createEnvSync({
      server: { TOKEN: redacted(optional(requiredString)) },
      runtimeEnv: {},
    });
    const outerOptional = createEnvSync({
      server: { TOKEN: optional(redacted(requiredString)) },
      runtimeEnv: {},
    });

    expect(outerRedacted.TOKEN).toBeUndefined();
    expect(outerOptional.TOKEN).toBeUndefined();
  });

  test("validation issues never retain rejected values", () => {
    const secret = "invalid-secret-value";

    expect(() =>
      createEnvSync({
        server: { TOKEN: redacted(requiredString) },
        runtimeEnv: { TOKEN: "" },
      }),
    ).toThrow(EnvValidationError);

    try {
      createEnvSync({
        server: { TOKEN: redacted(Schema.Literal("expected")) },
        runtimeEnv: { TOKEN: secret },
        emptyStringAsUndefined: false,
      });
    } catch (failure: unknown) {
      expect(String(failure)).not.toContain(secret);
      if (failure instanceof EnvValidationError) {
        expect(JSON.stringify(failure.issues)).not.toContain(secret);
      }
    }
  });

  test("malformed secret JSON does not expose values or references", async () => {
    const secret = "{not-json-secret";
    const reference = "tenant/private-json";
    const layer = SecretSource.fromPromise({
      get: async () => Option.some(secret),
    });
    const exit = await Effect.runPromiseExit(
      createEnv({
        server: { JSON_SECRET: Schema.parseJson(Schema.Struct({ id: Schema.String })) },
        resolvers: ({ resolve }) => [
          resolve(customSecretsAdapter, {
            secrets: { JSON_SECRET: reference },
          }),
        ],
      }).pipe(Effect.provide(layer)),
    );

    expect(String(exit)).not.toContain(secret);
    expect(String(exit)).not.toContain(reference);
  });

  test("asResult captures typed failures", async () => {
    const result = await Effect.runPromise(
      createEnv({
        server: { REQUIRED: requiredString },
        runtimeEnv: {},
      }).pipe(asResult()),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(EnvValidationError);
    }
  });

  test("browser access to server keys is blocked", () => {
    const env = createEnvSync({
      server: { SECRET: requiredString },
      client: { PUBLIC: requiredString },
      runtimeEnv: { SECRET: "secret", PUBLIC: "public" },
      isServer: false,
    });

    expect(env.PUBLIC).toBe("public");
    expect(() => env.SECRET).toThrow(ClientAccessError);
  });

  test("client creation never calls server resolvers", async () => {
    let calls = 0;
    const layer = SecretSource.fromPromise({
      get: async () => {
        calls += 1;
        return Option.some("secret");
      },
    });
    const env = await Effect.runPromise(
      createEnv({
        server: { SECRET: requiredString },
        client: { PUBLIC: requiredString },
        runtimeEnv: { PUBLIC: "public" },
        isServer: false,
        resolvers: ({ resolve }) => [
          resolve(customSecretsAdapter, {
            secrets: { SECRET: "remote-reference" },
          }),
        ],
      }).pipe(Effect.provide(layer)),
    );

    expect(env.PUBLIC).toBe("public");
    expect(calls).toBe(0);
  });

  test("the environment is immutable", () => {
    const env = createEnvSync({
      server: { VALUE: requiredString },
      runtimeEnv: { VALUE: "one" },
    });

    expect(() => Reflect.set(env, "VALUE", "two")).toThrow(TypeError);
  });
});

describe("runtime invariant backstops for JavaScript consumers", () => {
  test("rejects extends inputs from a different creation boundary", async () => {
    const effectBase = createEnv({
      server: { EFFECT_VALUE: requiredString },
      runtimeEnv: { EFFECT_VALUE: "effect" },
    });
    const promiseBase = createEnvPromise({
      server: { PROMISE_VALUE: requiredString },
      runtimeEnv: { PROMISE_VALUE: "promise" },
    });

    expect(() => Reflect.apply(createEnvSync, undefined, [{ extends: [effectBase] }])).toThrow(
      EnvConfigurationError,
    );
    await expect(
      Reflect.apply(createEnvPromise, undefined, [{ extends: [effectBase] }]),
    ).rejects.toBeInstanceOf(EnvConfigurationError);

    const effect: unknown = Reflect.apply(createEnv, undefined, [{ extends: [promiseBase] }]);
    if (!Effect.isEffect(effect)) {
      throw new Error("Expected createEnv to return an Effect");
    }
    const exit = await Effect.runPromiseExit(effect);
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = Option.getOrUndefined(Cause.failureOption(exit.cause));
      expect(failure).toBeInstanceOf(EnvConfigurationError);
    }
  });

  test("rejects arbitrary objects passed to extends", async () => {
    const arbitraryObject = new Date();

    expect(() => Reflect.apply(createEnvSync, undefined, [{ extends: [arbitraryObject] }])).toThrow(
      EnvConfigurationError,
    );
    await expect(
      Reflect.apply(createEnvPromise, undefined, [{ extends: [arbitraryObject] }]),
    ).rejects.toBeInstanceOf(EnvConfigurationError);

    const effect: unknown = Reflect.apply(createEnv, undefined, [{ extends: [arbitraryObject] }]);
    if (!Effect.isEffect(effect)) {
      throw new Error("Expected createEnv to return an Effect");
    }
    const exit = await Effect.runPromiseExit(effect);
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = Option.getOrUndefined(Cause.failureOption(exit.cause));
      expect(failure).toBeInstanceOf(EnvConfigurationError);
    }
  });

  test("recognizes Promises created in another realm", async () => {
    const foreignPromise: unknown = runInNewContext("Promise.resolve({})");
    const effect: unknown = Reflect.apply(createEnv, undefined, [{ extends: [foreignPromise] }]);

    if (!Effect.isEffect(effect)) {
      throw new Error("Expected createEnv to return an Effect");
    }

    const exit = await Effect.runPromiseExit(effect);
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = Option.getOrUndefined(Cause.failureOption(exit.cause));
      expect(failure).toBeInstanceOf(EnvConfigurationError);
      expect(String(failure)).toContain("not Promises");
    }

    expect(() => Reflect.apply(createEnvSync, undefined, [{ extends: [foreignPromise] }])).toThrow(
      "resolved environment values only",
    );
  });

  test("rejects logical bucket collisions", () => {
    const options = {
      server: { DUPLICATE: requiredString },
      client: { DUPLICATE: requiredString },
      runtimeEnv: { DUPLICATE: "value" },
    };

    expect(() => Reflect.apply(createEnvSync, undefined, [options])).toThrow(EnvConfigurationError);
  });

  test("rejects physical prefix collisions", () => {
    const options = {
      server: { PUBLIC_URL: requiredString },
      client: { URL: requiredString },
      prefix: { client: "PUBLIC_" },
      runtimeEnv: { PUBLIC_URL: "value" },
    };

    expect(() => Reflect.apply(createEnvSync, undefined, [options])).toThrow(EnvConfigurationError);
  });

  test("rejects redacted public schemas", () => {
    const options = {
      client: { TOKEN: redacted(requiredString) },
      runtimeEnv: { TOKEN: "value" },
    };

    expect(() => Reflect.apply(createEnvSync, undefined, [options])).toThrow(EnvConfigurationError);
  });

  test("rejects duplicate resolver keys", async () => {
    const secret = Option.some(Redacted.make("value"));
    const definition = (adapterName: string) => ({
      adapterName,
      keys: ["TOKEN"],
      effect: Effect.succeed({ TOKEN: secret }),
    });
    const effect: unknown = Reflect.apply(createEnv, undefined, [
      {
        server: { TOKEN: requiredString },
        resolvers: () => [definition("one"), definition("two")],
      },
    ]);

    expect(Effect.isEffect(effect)).toBe(true);
    if (Effect.isEffect(effect)) {
      const exit = await Effect.runPromiseExit(effect);
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        const failure = Option.getOrUndefined(Cause.failureOption(exit.cause));
        expect(failure).toBeInstanceOf(EnvConfigurationError);
        expect(String(failure)).toContain("more than one resolver");
      }
    }
  });

  test("rejects incomplete resolver results instead of falling back", async () => {
    const effect: unknown = Reflect.apply(createEnv, undefined, [
      {
        server: { TOKEN: requiredString },
        runtimeEnv: { TOKEN: "must-not-be-used" },
        resolvers: () => [
          {
            adapterName: "broken",
            keys: ["TOKEN"],
            effect: Effect.succeed({}),
          },
        ],
      },
    ]);

    if (!Effect.isEffect(effect)) {
      throw new Error("Expected createEnv to return an Effect");
    }

    const exit = await Effect.runPromiseExit(effect);
    expect(exit._tag).toBe("Failure");
    expect(String(exit)).not.toContain("must-not-be-used");
  });
});
