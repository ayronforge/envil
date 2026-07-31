import { describe, expect, test } from "bun:test";

import { Context, Effect, Option, Redacted, Result, Schema, SchemaGetter } from "effect";

import {
  EnvironmentAccessError,
  EnvConfigurationError,
  EnvValidationError,
  ServerEnvironmentAccessError,
} from "./errors.ts";
import type { ResolverAdapter, ResolverResult, ResolvedSecret } from "./resolvers/types.ts";
import { asResult } from "./result.ts";

import {
  SecretSource,
  client,
  configureResolver,
  createEnv,
  customSecretsAdapter,
  extendEnv,
  fromEnv,
  fromResolver,
  json,
  optional,
  redacted,
  requiredString,
  server,
  shared,
} from "./index.ts";

interface RecordingResolverOptions {
  readonly calls: Array<Readonly<Record<string, string>>>;
}

function resolveRecordingSecrets<const Keys extends string>(
  options: RecordingResolverOptions & {
    readonly referencesByKey: Readonly<Record<Keys, string>>;
  },
): Effect.Effect<ResolverResult<Keys>> {
  return Effect.sync(() => {
    options.calls.push(options.referencesByKey);
    const result: Partial<Record<Keys, ResolvedSecret>> = {};

    // SAFETY: Object.keys returns exactly the own string keys from the typed
    // reference record; the standard library only widens their finite union.
    for (const key of Object.keys(options.referencesByKey) as Keys[]) {
      Object.defineProperty(result, key, {
        value: Option.some(Redacted.make(`resolved:${options.referencesByKey[key]}`)),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }

    // SAFETY: Every key from the input record is populated exactly once above.
    return Object.freeze(result) as ResolverResult<Keys>;
  });
}

const recordingResolverAdapter: ResolverAdapter<
  "recording",
  string,
  RecordingResolverOptions,
  never,
  never
> = {
  name: "recording",
  resolve: resolveRecordingSecrets,
};

function verifyStaticValueTypes(): void {
  const symbolKey = Symbol("fragment-key");
  server({ LABEL: "server" });
  client({ LABEL: "client" });
  shared({
    CONFIG: {
      enabled: true,
      paths: ["/", "/health"],
    },
  });

  // @ts-expect-error Raw structured server values require an Effect Schema.
  server({ CONFIG: { enabled: true } });
  // @ts-expect-error Raw structured client values require an Effect Schema.
  client({ CONFIG: ["public"] });
  // @ts-expect-error Client schemas cannot produce nested redacted values.
  client(
    { CONFIG: Schema.Struct({ token: redacted(requiredString) }) },
    { runtimeEnv: { CONFIG: { token: "secret" } } },
  );
  // @ts-expect-error Shared values cannot contain Effect values recursively.
  shared({ CONFIG: { token: Redacted.make("secret") } });
  // @ts-expect-error Shared values cannot contain Effect Schemas recursively.
  shared({ CONFIG: { parser: requiredString } });
  // @ts-expect-error Environment fragment keys must be strings.
  server({ [symbolKey]: requiredString });
  // @ts-expect-error Environment fragment keys must be strings.
  client({ [symbolKey]: "public" });
  // @ts-expect-error Environment fragment keys must be strings.
  shared({ [symbolKey]: "public" });

  const mutableConfig = { nested: { enabled: true } };
  const sharedEnvironment = createEnv(shared({ CONFIG: mutableConfig }));
  const materializedShared = Effect.runSync(sharedEnvironment.client);
  // @ts-expect-error Shared environment values are recursively readonly.
  materializedShared.CONFIG.nested.enabled = false;
}

void verifyStaticValueTypes;

describe("environment composition", () => {
  test("rejects legacy object definitions and forged fragment shapes", () => {
    const legacyDefinition: unknown = {
      server: {
        TOKEN: requiredString,
      },
    };
    const forgedFragment: unknown = {
      target: "server",
      values: {
        TOKEN: requiredString,
      },
    };

    expect(() => Reflect.apply(createEnv, undefined, [legacyDefinition])).toThrow(
      "createEnv accepts fragments created by server, client, and shared.",
    );
    expect(() => Reflect.apply(createEnv, undefined, [forgedFragment])).toThrow(
      "createEnv accepts fragments created by server, client, and shared.",
    );
  });

  test("exposes independent lazy Effect properties", async () => {
    const appEnv = createEnv(
      shared({ APP_NAME: "Envil" }),
      server({ URL: requiredString }, { runtimeEnv: { URL: "https://server.example.com" } }),
      client(
        { URL: requiredString },
        {
          runtimeEnv: { VITE_URL: "https://client.example.com" },
          prefix: "VITE_",
        },
      ),
    );

    expect(Effect.isEffect(appEnv.server)).toBe(true);
    expect(Effect.isEffect(appEnv.client)).toBe(true);
    expect(Effect.runSync(appEnv.server)).toEqual({
      APP_NAME: "Envil",
      URL: "https://client.example.com",
    });
    expect(await Effect.runPromise(appEnv.client)).toEqual({
      APP_NAME: "Envil",
      URL: "https://client.example.com",
    });
  });

  test("composes AppEnv values canonically through extendEnv", () => {
    const baseEnv = createEnv(
      shared({ APP_NAME: "Base" }),
      server({ BASE_URL: "https://base.example.com" }),
    );
    const authenticationEnv = createEnv(
      server({ AUTH_SECRET: "secret" }),
      client({ SIGN_IN_PATH: "/sign-in" }),
    );
    const appEnv = baseEnv.pipe(
      extendEnv(authenticationEnv),
      extendEnv(
        shared({ APP_NAME: "Application" }),
        server({ API_URL: "https://api.example.com" }),
      ),
    );

    expect(Effect.runSync(appEnv.server)).toEqual({
      APP_NAME: "Application",
      BASE_URL: "https://base.example.com",
      AUTH_SECRET: "secret",
      SIGN_IN_PATH: "/sign-in",
      API_URL: "https://api.example.com",
    });
    expect(Effect.runSync(appEnv.client)).toEqual({
      APP_NAME: "Application",
      SIGN_IN_PATH: "/sign-in",
    });
  });

  test("last definition replaces schema, source, runtime, and resolver requirements", () => {
    const calls: Array<Readonly<Record<string, string>>> = [];
    const resolver = configureResolver(recordingResolverAdapter, { calls });
    const baseEnv = createEnv(
      server({
        TOKEN: requiredString.pipe(fromResolver(resolver, "shadowed-reference")),
      }),
    );
    const appEnv = baseEnv.pipe(
      extendEnv(
        server(
          {
            TOKEN: Schema.NumberFromString,
          },
          {
            runtimeEnv: { APP_TOKEN: "42" },
            prefix: "APP_",
          },
        ),
      ),
    );

    expect(Effect.runSync(appEnv.server).TOKEN).toBe(42);
    expect(calls).toEqual([]);

    const crossTargetAppEnv = baseEnv.pipe(extendEnv(client({ TOKEN: "public-override" })));
    expect(Effect.runSync(crossTargetAppEnv.server).TOKEN).toBe("public-override");
    expect(calls).toEqual([]);
  });

  test("multiple fragments retain independent runtime sources and prefixes", () => {
    const appEnv = createEnv(
      server(
        { URL: requiredString },
        { runtimeEnv: { BASE_URL: "https://base.example.com" }, prefix: "BASE_" },
      ),
      server(
        { TOKEN: requiredString },
        { runtimeEnv: new Map([["AUTH_TOKEN", "token"]]), prefix: "AUTH_" },
      ),
    );

    expect(Effect.runSync(appEnv.server)).toEqual({
      URL: "https://base.example.com",
      TOKEN: "token",
    });
  });

  test("accepts arbitrary Effect Schemas and preserves their requirements", () => {
    class SchemaPolicy extends Context.Service<
      SchemaPolicy,
      { readonly accepts: (value: string) => boolean }
    >()("test/SchemaPolicy") {}
    const minimum = 3;
    const arbitrarySchema = Schema.String.check(Schema.isMinLength(minimum)).pipe(
      Schema.decode({
        decode: SchemaGetter.checkEffect((value) =>
          SchemaPolicy.useSync((policy) => policy.accepts(value)),
        ),
        encode: SchemaGetter.passthrough(),
      }),
      Schema.decodeTo(Schema.Number, {
        decode: SchemaGetter.transform((value: string) => Number(value)),
        encode: SchemaGetter.transform((value: number) => String(value)),
      }),
    );
    const appEnv = createEnv(server({ PORT: arbitrarySchema }, { runtimeEnv: { PORT: "3000" } }));

    expect(
      Effect.runSync(
        appEnv.server.pipe(
          Effect.provideService(SchemaPolicy, {
            accepts: (value) => value !== "forbidden",
          }),
        ),
      ).PORT,
    ).toBe(3000);
  });

  test("accepts recursively static shared data", () => {
    const config = {
      enabled: true,
      routes: ["/", "/health"],
      nested: { retries: 3 },
    } as const;
    const appEnv = createEnv(shared({ CONFIG: config }));

    expect(Effect.runSync(appEnv.client).CONFIG).toEqual(config);
    expect(Effect.runSync(appEnv.server).CONFIG).toEqual(config);
  });

  test("snapshots and recursively freezes shared data", () => {
    const config = {
      routes: ["/"],
      nested: { retries: 3 },
    };
    const appEnv = createEnv(shared({ CONFIG: config }));

    config.routes.push("/health");
    config.nested.retries = 4;

    const clientEnv = Effect.runSync(appEnv.client);
    expect(clientEnv.CONFIG).toEqual({
      routes: ["/"],
      nested: { retries: 3 },
    });
    expect(Object.isFrozen(clientEnv.CONFIG)).toBe(true);
    expect(Object.isFrozen(clientEnv.CONFIG.routes)).toBe(true);
    expect(Object.isFrozen(clientEnv.CONFIG.nested)).toBe(true);
    expect(Reflect.set(clientEnv.CONFIG.nested, "retries", 5)).toBe(false);
    expect(Effect.runSync(appEnv.client).CONFIG.nested.retries).toBe(3);
  });

  test("rejects symbol fragment keys when JavaScript bypasses the types", () => {
    const symbolKey = Symbol("fragment-key");

    expect(() => Reflect.apply(server, undefined, [{ [symbolKey]: "server" }])).toThrow(
      "Environment fragment keys must be strings",
    );
    expect(() => Reflect.apply(client, undefined, [{ [symbolKey]: "client" }])).toThrow(
      "Environment fragment keys must be strings",
    );
    expect(() => Reflect.apply(shared, undefined, [{ [symbolKey]: "shared" }])).toThrow(
      "Environment fragment keys must be strings",
    );
  });

  test("requires Effect Schemas for structured server and client values", () => {
    const structured = Schema.fromJsonString(
      Schema.Struct({
        enabled: Schema.Boolean,
      }),
    );
    const appEnv = createEnv(
      server({ SERVER_CONFIG: structured }, { runtimeEnv: { SERVER_CONFIG: '{"enabled":true}' } }),
      client({ CLIENT_CONFIG: structured }, { runtimeEnv: { CLIENT_CONFIG: '{"enabled":false}' } }),
    );

    expect(Effect.runSync(appEnv.server)).toMatchObject({
      SERVER_CONFIG: { enabled: true },
      CLIENT_CONFIG: { enabled: false },
    });
    expect(Effect.runSync(appEnv.client).CLIENT_CONFIG).toEqual({ enabled: false });
  });

  test("rejects client schemas that produce nested redacted values", () => {
    const nestedSecret = json(
      Schema.Struct({
        token: redacted(requiredString),
      }),
    );
    const fragment: unknown = Reflect.apply(client, undefined, [
      { CONFIG: nestedSecret },
      { runtimeEnv: { CONFIG: '{"token":"secret"}' } },
    ]);
    const appEnv: unknown = Reflect.apply(createEnv, undefined, [fragment]);
    if (typeof appEnv !== "object" || appEnv === null) {
      throw new Error("Expected an AppEnv");
    }
    const clientEffect = Reflect.get(appEnv, "client");
    if (!Effect.isEffect(clientEffect)) {
      throw new Error("Expected a client Effect");
    }

    const result = Effect.runSync(Effect.result(clientEffect));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(EnvConfigurationError);
      expect(String(result.failure)).toContain("redacted in a client fragment");
      expect(String(result.failure)).not.toContain("secret");
    }
  });

  test("rejects widened native redacted schemas in client fragments", () => {
    const nativeRedacted: Schema.Top = Schema.RedactedFromValue(Schema.String);
    const appEnv = createEnv(
      client({ TOKEN: nativeRedacted }, { runtimeEnv: { TOKEN: "secret" } }),
    );

    const result = Effect.runSync(Effect.result(appEnv.client));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(EnvConfigurationError);
      expect(String(result.failure)).toContain("redacted in a client fragment");
      expect(String(result.failure)).not.toContain("secret");
    }
  });

  test("rejects nested Effect values from shared when JavaScript bypasses the types", () => {
    let failure: unknown;
    try {
      Reflect.apply(shared, undefined, [
        {
          CONFIG: {
            token: Redacted.make("secret"),
          },
        },
      ]);
    } catch (cause: unknown) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(TypeError);
    expect(String(failure)).toContain(
      "shared() accepts only scalar, array, and plain-object values",
    );
    expect(String(failure)).not.toContain("secret");
  });

  test("rejects raw structured runtime values when JavaScript bypasses the types", () => {
    const fragment: unknown = Reflect.apply(server, undefined, [{ CONFIG: { enabled: true } }]);
    const appEnv: unknown = Reflect.apply(createEnv, undefined, [fragment]);
    if (typeof appEnv !== "object" || appEnv === null) {
      throw new Error("Expected an AppEnv");
    }
    const serverEffect = Reflect.get(appEnv, "server");
    if (!Effect.isEffect(serverEffect)) {
      throw new Error("Expected a server Effect");
    }

    const result = Effect.runSync(Effect.result(serverEffect));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(EnvConfigurationError);
      expect(String(result.failure)).toContain("Describe objects and arrays with an Effect Schema");
    }
  });
});

describe("lazy runtime boundaries", () => {
  test("does not read runtime values until the Effect runs", () => {
    let reads = 0;
    const runtimeEnv = Object.defineProperty({}, "TOKEN", {
      enumerable: true,
      get: () => {
        reads += 1;
        return "value";
      },
    });
    const appEnv = createEnv(server({ TOKEN: requiredString }, { runtimeEnv }));

    expect(reads).toBe(0);
    expect(Effect.runSync(appEnv.server).TOKEN).toBe("value");
    expect(reads).toBe(1);
  });

  test("treats object sources with get and has methods as records", () => {
    const appEnv = createEnv(
      server(
        { TOKEN: requiredString },
        {
          runtimeEnv: {
            TOKEN: "record-value",
            get: () => "map-value",
            has: () => true,
          },
        },
      ),
    );

    expect(Effect.runSync(appEnv.server).TOKEN).toBe("record-value");
  });

  test("reads structurally valid ReadonlyMap sources", () => {
    const values = new Map<string, unknown>([["TOKEN", "map-value"]]);
    const runtimeEnv = {
      get size() {
        return values.size;
      },
      get: values.get.bind(values),
      has: values.has.bind(values),
      entries: values.entries.bind(values),
      keys: values.keys.bind(values),
      values: values.values.bind(values),
      forEach: values.forEach.bind(values),
      [Symbol.iterator]: values[Symbol.iterator].bind(values),
    } satisfies ReadonlyMap<string, unknown>;
    const appEnv = createEnv(server({ TOKEN: requiredString }, { runtimeEnv }));

    expect(Effect.runSync(appEnv.server).TOKEN).toBe("map-value");
  });

  test("fromEnv overrides a fragment prefix", () => {
    const appEnv = createEnv(
      client(
        {
          URL: requiredString,
          ANALYTICS_KEY: requiredString.pipe(fromEnv("PUBLIC_ANALYTICS_KEY")),
        },
        {
          runtimeEnv: {
            VITE_URL: "https://default.example.com",
            PUBLIC_ANALYTICS_KEY: "analytics",
          },
          prefix: "VITE_",
        },
      ),
    );

    expect(Effect.runSync(appEnv.client)).toEqual({
      URL: "https://default.example.com",
      ANALYTICS_KEY: "analytics",
    });
  });

  test("reads dot paths but prefers an exact JSON key", () => {
    const nested = createEnv(
      server(
        { DATABASE_URL: requiredString.pipe(fromEnv("application.database.url")) },
        {
          runtimeEnv: {
            application: { database: { url: "postgres://nested.example.com" } },
          },
        },
      ),
    );
    const exact = createEnv(
      server(
        { URL: requiredString.pipe(fromEnv("application.url")) },
        {
          runtimeEnv: {
            "application.url": "https://exact.example.com",
            application: { url: "https://nested.example.com" },
          },
        },
      ),
    );

    expect(Effect.runSync(nested.server).DATABASE_URL).toBe("postgres://nested.example.com");
    expect(Effect.runSync(exact.server).URL).toBe("https://exact.example.com");
  });

  test("returns immutable values and rejects unknown reads", () => {
    const appEnv = createEnv(
      shared({ APP_NAME: "Envil" }),
      server({ DATABASE_URL: "postgres://localhost" }),
      client({ PUBLIC_URL: "https://example.com" }),
    );

    const clientEnv: Readonly<Record<string, unknown>> = Effect.runSync(appEnv.client);
    expect(() => Reflect.get(clientEnv, "DATABASE_URL")).toThrow(EnvironmentAccessError);
    expect(() => Reflect.get(clientEnv, "TYPO")).toThrow(
      '"TYPO" is not available in the client environment.',
    );
    expect(() => Reflect.set(clientEnv, "APP_NAME", "Changed")).toThrow(TypeError);
    expect({ ...clientEnv }).toEqual({
      APP_NAME: "Envil",
      PUBLIC_URL: "https://example.com",
    });
  });

  test("blocks server materialization in a browser runtime", () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });

    try {
      const appEnv = createEnv(server({ TOKEN: "secret" }));
      const result = Effect.runSync(Effect.result(appEnv.server));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(ServerEnvironmentAccessError);
      }
    } finally {
      if (previousWindow === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", previousWindow);
      }
    }
  });
});

describe("variable sources", () => {
  test("groups variables from the same configured resolver into one request", () => {
    const calls: Array<Readonly<Record<string, string>>> = [];
    const resolver = configureResolver(recordingResolverAdapter, { calls });
    const appEnv = createEnv(
      server({
        FIRST: requiredString.pipe(fromResolver(resolver, "first-reference")),
        SECOND: requiredString.pipe(fromResolver(resolver, "second-reference")),
      }),
    );

    expect(calls).toEqual([]);
    const env = Effect.runSync(appEnv.server);
    expect(calls).toEqual([
      {
        FIRST: "first-reference",
        SECOND: "second-reference",
      },
    ]);
    expect(Redacted.value(env.FIRST)).toBe("resolved:first-reference");
    expect(Redacted.value(env.SECOND)).toBe("resolved:second-reference");
  });

  test('preserves a resolver key named "__proto__"', () => {
    const calls: Array<Readonly<Record<string, string>>> = [];
    const resolver = configureResolver(recordingResolverAdapter, { calls });
    const appEnv = createEnv(
      server({
        FIRST: requiredString.pipe(fromResolver(resolver, "first-reference")),
        ["__proto__"]: requiredString.pipe(fromResolver(resolver, "proto-reference")),
      }),
    );

    const env = Effect.runSync(appEnv.server);

    expect(calls.map((call) => Object.entries(call))).toEqual([
      [
        ["FIRST", "first-reference"],
        ["__proto__", "proto-reference"],
      ],
    ]);
    expect(Redacted.value(env.__proto__)).toBe("resolved:proto-reference");
  });

  test("snapshots custom resolver options before runtime", () => {
    const calls: string[] = [];
    const adapter: ResolverAdapter<
      "custom-test",
      string,
      { readonly prefix: string },
      never,
      never
    > = {
      name: "custom-test",
      resolve: ({ prefix, referencesByKey }) =>
        Effect.sync(() => {
          const result: Record<string, ResolvedSecret> = {};
          for (const [key, reference] of Object.entries(referencesByKey)) {
            calls.push(reference);
            result[key] = Option.some(Redacted.make(`${prefix}:${reference}`));
          }
          return result;
        }),
    };
    const options = { prefix: "resolved" };
    const resolver = configureResolver(adapter, options);
    options.prefix = "mutated";
    const appEnv = createEnv(
      server({
        TOKEN: requiredString.pipe(fromResolver(resolver, "token-reference")),
      }),
    );

    const env = Effect.runSync(appEnv.server);
    expect(Redacted.value(env.TOKEN)).toBe("resolved:token-reference");
    expect(calls).toEqual(["token-reference"]);
  });

  test("resolver values are authoritative and automatically redacted", async () => {
    const source = configureResolver(customSecretsAdapter, {});
    const layer = SecretSource.fromPromise({
      get: async () => Option.some("resolved-value"),
    });
    const appEnv = createEnv(
      server(
        { TOKEN: requiredString.pipe(fromResolver(source, "remote-reference")) },
        { runtimeEnv: { TOKEN: "runtime-value" } },
      ),
    );

    const env = await Effect.runPromise(appEnv.server.pipe(Effect.provide(layer)));
    expect(Redacted.isRedacted(env.TOKEN)).toBe(true);
    expect(Redacted.value(env.TOKEN)).toBe("resolved-value");
  });

  test("optional resolver absence remains undefined", async () => {
    const source = configureResolver(customSecretsAdapter, {});
    const layer = SecretSource.fromPromise({
      get: async () => Option.none(),
    });
    const appEnv = createEnv(
      server({
        TOKEN: optional(requiredString).pipe(fromResolver(source, "remote-reference")),
      }),
    );

    const env = await Effect.runPromise(appEnv.server.pipe(Effect.provide(layer)));
    expect(env.TOKEN).toBeUndefined();
  });

  test("client materialization never executes server resolvers", async () => {
    let calls = 0;
    const source = configureResolver(customSecretsAdapter, {});
    const layer = SecretSource.fromPromise({
      get: async () => {
        calls += 1;
        return Option.some("secret");
      },
    });
    const appEnv = createEnv(
      server({
        SECRET: requiredString.pipe(fromResolver(source, "remote-reference")),
      }),
      client({ PUBLIC: "public" }),
    );

    expect(await Effect.runPromise(appEnv.client.pipe(Effect.provide(layer)))).toEqual({
      PUBLIC: "public",
    });
    expect(calls).toBe(0);
  });

  test("synchronous resolver construction failures stay typed and sanitized", async () => {
    const privateReference = "provider/private-reference";
    const throwingAdapter: ResolverAdapter<"throwing", string, {}, never, never> = {
      name: "throwing",
      resolve: () => {
        throw new Error(privateReference);
      },
    };
    const resolver = configureResolver(throwingAdapter, {});
    const appEnv = createEnv(
      server({
        TOKEN: requiredString.pipe(fromResolver(resolver, privateReference)),
      }),
    );

    const result = await Effect.runPromise(appEnv.server.pipe(asResult()));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(EnvConfigurationError);
      expect(String(result.error)).not.toContain(privateReference);
    }
  });
});

describe("validation and runtime backstops", () => {
  test("rejects functions produced by broad schemas", () => {
    const appEnv = createEnv(
      server({ CALLBACK: Schema.Any }, { runtimeEnv: { CALLBACK: () => "value" } }),
    );

    const result = Effect.runSync(Effect.result(appEnv.server));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(EnvValidationError);
      expect(result.failure.issues).toEqual([
        {
          _tag: "InvalidVariable",
          key: "CALLBACK",
          sensitive: false,
        },
      ]);
    }
  });

  test("redacted runtime schemas remain redacted", () => {
    const appEnv = createEnv(
      server({ TOKEN: redacted(requiredString) }, { runtimeEnv: { TOKEN: "secret-value" } }),
    );

    const env = Effect.runSync(appEnv.server);
    expect(Redacted.isRedacted(env.TOKEN)).toBe(true);
    expect(String(env.TOKEN)).not.toContain("secret-value");
  });

  test("validation issues never retain rejected values", () => {
    const secret = "invalid-secret-value";
    const appEnv = createEnv(
      server({ TOKEN: redacted(Schema.Literal("expected")) }, { runtimeEnv: { TOKEN: secret } }),
    );

    const result = Effect.runSync(Effect.result(appEnv.server));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(EnvValidationError);
      expect(String(result.failure)).not.toContain(secret);
      expect(JSON.stringify(result.failure)).not.toContain(secret);
    }
  });

  test("malformed resolver JSON exposes neither values nor references", async () => {
    const secret = "{not-json-secret";
    const reference = "tenant/private-json";
    const source = configureResolver(customSecretsAdapter, {});
    const layer = SecretSource.fromPromise({
      get: async () => Option.some(secret),
    });
    const appEnv = createEnv(
      server({
        JSON_SECRET: Schema.fromJsonString(Schema.Struct({ id: Schema.String })).pipe(
          fromResolver(source, reference),
        ),
      }),
    );

    const exit = await Effect.runPromiseExit(appEnv.server.pipe(Effect.provide(layer)));
    expect(String(exit)).not.toContain(secret);
    expect(String(exit)).not.toContain(reference);
  });

  test("asResult captures typed validation failures", () => {
    const appEnv = createEnv(server({ REQUIRED: requiredString }, { runtimeEnv: {} }));
    const result = Effect.runSync(appEnv.server.pipe(asResult()));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(EnvValidationError);
    }
  });

  test("reports a missing client runtime source when JavaScript bypasses the types", () => {
    const fragment: unknown = Reflect.apply(client, undefined, [{ PUBLIC: requiredString }]);
    const appEnv: unknown = Reflect.apply(createEnv, undefined, [fragment]);
    if (typeof appEnv !== "object" || appEnv === null) {
      throw new Error("Expected an AppEnv with a client Effect");
    }
    const clientEffect = Reflect.get(appEnv, "client");
    if (!Effect.isEffect(clientEffect)) {
      throw new Error("Expected an AppEnv with a client Effect");
    }

    const result = Effect.runSync(Effect.result(clientEffect));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(EnvConfigurationError);
      expect(String(result.failure)).toContain('client variable "PUBLIC" needs runtimeEnv');
    }
  });

  test("applies cross-target last-wins precedence to the complete server context", () => {
    const appEnv = createEnv(
      server({ URL: requiredString }, { runtimeEnv: { URL: "server" } }),
      client({ URL: requiredString }, { runtimeEnv: { URL: "client" } }),
    );

    expect(Effect.runSync(appEnv.server).URL).toBe("client");
    expect(Effect.runSync(appEnv.client).URL).toBe("client");
  });

  test("explains duplicate runtime mappings after last-wins resolution", () => {
    const appEnv = createEnv(
      server(
        {
          FIRST: requiredString.pipe(fromEnv("TOKEN")),
          SECOND: requiredString.pipe(fromEnv("TOKEN")),
        },
        { runtimeEnv: { TOKEN: "value" } },
      ),
    );

    const result = Effect.runSync(Effect.result(appEnv.server));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain(
        '"FIRST" and "SECOND" both read "TOKEN" in the server environment.',
      );
    }
  });

  test("detects inherited runtime mapping collisions after composition", () => {
    const baseEnv = createEnv(
      server(
        {
          PUBLIC_URL: requiredString,
        },
        { runtimeEnv: { PUBLIC_URL: "server" } },
      ),
    );
    const appEnv = baseEnv.pipe(
      extendEnv(
        client(
          {
            URL: requiredString,
          },
          { runtimeEnv: { PUBLIC_URL: "client" }, prefix: "PUBLIC_" },
        ),
      ),
    );

    const result = Effect.runSync(Effect.result(appEnv.server));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain(
        '"PUBLIC_URL" and "URL" both read "PUBLIC_URL" in the server environment.',
      );
    }
  });
});
