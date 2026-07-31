import { Context, Effect, Option, Redacted, Schema, SchemaGetter } from "effect";

import {
  SecretSource,
  asResult,
  client,
  configureResolver,
  createEnv,
  customSecretsAdapter,
  extendEnv,
  fromEnv,
  fromResolver,
  optional,
  redacted,
  requiredString,
  server,
  shared,
  url,
  type InferClientEnv,
  type InferEnv,
  type InferServerEnv,
} from "../src/index.ts";
import * as Envil from "../src/index.ts";
import rollupPlugin from "../src/plugins/rollup.ts";
import vitePlugin from "../src/plugins/vite.ts";
import webpackPlugin from "../src/plugins/webpack.ts";
import * as presets from "../src/presets.ts";
import { awsSecretsAdapter } from "../src/resolvers/aws.ts";
import { azureKeyVaultAdapter } from "../src/resolvers/azure.ts";
import { gcpSecretsAdapter } from "../src/resolvers/gcp.ts";
import { onePasswordSecretsAdapter } from "../src/resolvers/onepassword.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;
type EffectRequirements<Value> =
  Value extends Effect.Effect<unknown, unknown, infer Requirements> ? Requirements : never;

const aws = configureResolver(awsSecretsAdapter, { region: "us-east-1" });
const arbitrarySchema = Schema.String.pipe(
  Schema.decodeTo(Schema.Number, {
    decode: SchemaGetter.transform((value: string) => Number(value)),
    encode: SchemaGetter.transform((value: number) => String(value)),
  }),
);
const functionSchema = Schema.declare<() => string>(
  (value): value is () => string => typeof value === "function",
);
// @ts-expect-error Environment schemas cannot produce functions.
server({ CALLBACK: functionSchema }, { runtimeEnv: { CALLBACK: () => "value" } });
class SchemaPolicy extends Context.Service<
  SchemaPolicy,
  { readonly accepts: (value: string) => boolean }
>()("type-test/SchemaPolicy") {}
const contextualSchema = Schema.String.pipe(
  Schema.decode({
    decode: SchemaGetter.checkEffect((value) =>
      SchemaPolicy.useSync((policy) => policy.accepts(value)),
    ),
    encode: SchemaGetter.passthrough(),
  }),
);

const baseEnv = createEnv(
  shared({
    APP_NAME: "envil",
  }),
  server(
    {
      DATABASE_URL: redacted(url),
      DATABASE_PASSWORD: requiredString.pipe(fromResolver(aws, "production/database#password")),
      ARBITRARY: arbitrarySchema,
    },
    {
      runtimeEnv: {
        DATABASE_URL: "postgres://localhost",
        ARBITRARY: "42",
      },
    },
  ),
  client(
    {
      APP_URL: url,
      ANALYTICS_KEY: optional(requiredString).pipe(fromEnv("PUBLIC_ANALYTICS_KEY")),
    },
    {
      runtimeEnv: {
        VITE_APP_URL: "https://example.com",
        PUBLIC_ANALYTICS_KEY: "public-key",
      },
      prefix: "VITE_",
    },
  ),
);

const appEnv = baseEnv.pipe(
  extendEnv(
    server({
      DATABASE_URL: "postgres://override.example.com",
    }),
    client({
      APP_URL: "https://override.example.com",
      POSTHOG_API_KEY: "phc_public",
    }),
  ),
);

type ServerEnvironment = InferEnv<typeof appEnv.server>;
type ClientEnvironment = InferEnv<typeof appEnv.client>;

export type ServerInferenceContract = Expect<
  Equal<
    ServerEnvironment,
    Readonly<{
      APP_NAME: "envil";
      DATABASE_URL: "postgres://override.example.com";
      DATABASE_PASSWORD: Redacted.Redacted<string>;
      ARBITRARY: number;
      ANALYTICS_KEY: string | undefined;
      APP_URL: "https://override.example.com";
      POSTHOG_API_KEY: "phc_public";
    }>
  >
>;

export type ClientInferenceContract = Expect<
  Equal<
    ClientEnvironment,
    Readonly<{
      APP_NAME: "envil";
      ANALYTICS_KEY: string | undefined;
      APP_URL: "https://override.example.com";
      POSTHOG_API_KEY: "phc_public";
    }>
  >
>;

export type DirectServerInferenceContract = Expect<
  Equal<InferServerEnv<typeof appEnv>, ServerEnvironment>
>;
export type DirectClientInferenceContract = Expect<
  Equal<InferClientEnv<typeof appEnv>, ClientEnvironment>
>;

Effect.map(appEnv.client, (env) => {
  // @ts-expect-error Server values do not exist in a client environment.
  env.DATABASE_PASSWORD;
  return env.APP_URL;
});

const custom = configureResolver(customSecretsAdapter, {});
const customAppEnv = createEnv(
  server({
    INTERNAL_TOKEN: requiredString.pipe(fromResolver(custom, "tenant/internal-token")),
  }),
);
export type CustomRequirementContract = Expect<
  Equal<EffectRequirements<typeof customAppEnv.server>, SecretSource>
>;

const customLayer = SecretSource.fromPromise({
  get: async () => Option.some("secret"),
});
Effect.runPromise(customAppEnv.server.pipe(Effect.provide(customLayer)));

const contextualAppEnv = createEnv(
  server({ CONTEXTUAL: contextualSchema }, { runtimeEnv: { CONTEXTUAL: "value" } }),
);
export type SchemaRequirementContract = Expect<
  Equal<EffectRequirements<typeof contextualAppEnv.server>, SchemaPolicy>
>;

const contextualClientEnv = createEnv(
  client({ CONTEXTUAL: contextualSchema }, { runtimeEnv: { CONTEXTUAL: "value" } }),
);
export type ClientSchemaRequirementContract = Expect<
  Equal<EffectRequirements<typeof contextualClientEnv.client>, SchemaPolicy>
>;
export type ServerIncludesClientRequirementContract = Expect<
  Equal<EffectRequirements<typeof contextualClientEnv.server>, SchemaPolicy>
>;

const shadowedCustomEnv = customAppEnv.pipe(extendEnv(server({ INTERNAL_TOKEN: "local" })));
export type ShadowedRequirementContract = Expect<
  Equal<EffectRequirements<typeof shadowedCustomEnv.server>, never>
>;

const crossTargetShadowedCustomEnv = customAppEnv.pipe(
  extendEnv(client({ INTERNAL_TOKEN: "public" })),
);
export type CrossTargetShadowedRequirementContract = Expect<
  Equal<EffectRequirements<typeof crossTargetShadowedCustomEnv.server>, never>
>;

configureResolver(gcpSecretsAdapter, { projectId: "project" });
configureResolver(azureKeyVaultAdapter, { vaultUrl: "https://vault.example.com" });
configureResolver(onePasswordSecretsAdapter, { serviceAccountToken: "token" });

const resultEffect = appEnv.server.pipe(asResult());
export type ResultRequirementsContract = Expect<
  Equal<EffectRequirements<typeof resultEffect>, never>
>;

requiredString.pipe(
  fromEnv("FIRST"),
  // @ts-expect-error Source definitions are terminal.
  fromEnv("SECOND"),
);

// @ts-expect-error Source definitions are terminal and cannot enter later schema combinators.
optional(requiredString.pipe(fromResolver(custom, "terminal-reference")));

vitePlugin();
// @ts-expect-error Vite detects client and SSR targets automatically.
vitePlugin({ target: "server" });
rollupPlugin({ target: "client" });
webpackPlugin({ target: "server" });

// @ts-expect-error Existing environments compose only through extendEnv.
createEnv(baseEnv);

createEnv({
  // @ts-expect-error Legacy object definitions are not accepted.
  server: {
    TOKEN: requiredString,
  },
});

// @ts-expect-error defineBucket was removed from the public API.
Envil.defineBucket;

// @ts-expect-error The Next.js preset was removed.
presets.nextjs;

// @ts-expect-error Plugin strict mode was removed with static object-shape analysis.
rollupPlugin({ target: "client", strict: false });

// @ts-expect-error Schema-backed client fragments require runtimeEnv.
client({ PUBLIC: requiredString });

client({
  PUBLIC: "constant",
});

client(
  // @ts-expect-error Resolver-backed variables are server-only.
  {
    TOKEN: requiredString.pipe(fromResolver(aws, "reference")),
  },
  { runtimeEnv: {} },
);

client(
  // @ts-expect-error Redacted variables are server-only.
  {
    TOKEN: redacted(requiredString),
  },
  { runtimeEnv: {} },
);

// @ts-expect-error Shared values are static and cannot contain schemas.
shared({
  TOKEN: requiredString,
});

// @ts-expect-error Shared values are public and cannot be redacted.
shared({
  TOKEN: Redacted.make("secret"),
});

// @ts-expect-error AppEnv exposes Effect properties rather than methods.
appEnv.server();
