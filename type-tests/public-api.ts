import { Effect, Layer, Option, Redacted } from "effect";

import {
  SecretSource,
  asResult,
  createEnv,
  createEnvPromise,
  createEnvSync,
  customSecretsAdapter,
  optional,
  redacted,
  requiredString,
  url,
  type InferEnv,
} from "../src/index.ts";
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

const env = createEnv({
  server: {
    DATABASE_URL: redacted(url),
    DATABASE_PASSWORD: requiredString,
    OPTIONAL_TOKEN: optional(requiredString),
    WRAPPED_OPTIONAL_TOKEN: redacted(optional(requiredString)),
  },
  client: {
    APP_URL: url,
  },
  prefix: {
    client: "VITE_",
  },
  resolvers: ({ resolve }) => [
    resolve(awsSecretsAdapter, {
      region: "us-east-1",
      secrets: {
        DATABASE_PASSWORD: "production/database#password",
        OPTIONAL_TOKEN: "production/optional",
      },
    }),
  ],
});

type Environment = InferEnv<typeof env>;

export type EnvironmentContract = Expect<
  Equal<
    Environment,
    Readonly<{
      DATABASE_URL: Redacted.Redacted<string>;
      DATABASE_PASSWORD: Redacted.Redacted<string>;
      OPTIONAL_TOKEN: Redacted.Redacted<string> | undefined;
      WRAPPED_OPTIONAL_TOKEN: Redacted.Redacted<string> | undefined;
      APP_URL: string;
    }>
  >
>;

const syncEnv = createEnvSync({
  server: { DATABASE_URL: requiredString },
  runtimeEnv: { DATABASE_URL: "postgres://localhost" },
});
export type SyncInferenceContract = Expect<Equal<InferEnv<typeof syncEnv>["DATABASE_URL"], string>>;

const promiseEnv = createEnvPromise({
  server: { DATABASE_URL: requiredString },
  runtimeEnv: { DATABASE_URL: "postgres://localhost" },
});
export type PromiseInferenceContract = Expect<
  Equal<InferEnv<typeof promiseEnv>["DATABASE_URL"], string>
>;
export type AwaitedInferenceContract = Expect<
  Equal<InferEnv<Awaited<typeof promiseEnv>>["DATABASE_URL"], string>
>;

const baseEnv = createEnvSync({
  server: {
    BASE_TOKEN: redacted(requiredString),
  },
  client: {
    BASE_URL: url,
  },
  prefix: {
    client: "BASE_",
  },
  runtimeEnv: {
    BASE_TOKEN: "secret",
    BASE_BASE_URL: "https://example.com",
  },
});

const composedEnv = createEnvSync({
  extends: [baseEnv],
  server: {
    APP_NAME: requiredString,
  },
  runtimeEnv: {
    APP_NAME: "envil",
  },
});

export type ComposedInferenceContract = Expect<
  Equal<
    InferEnv<typeof composedEnv>,
    Readonly<{
      BASE_TOKEN: Redacted.Redacted<string>;
      BASE_URL: string;
      APP_NAME: string;
    }>
  >
>;

const overriddenEnv = createEnvSync({
  extends: [baseEnv],
  server: {
    BASE_TOKEN: requiredString,
  },
  runtimeEnv: {
    BASE_TOKEN: "plain",
  },
});

export type LocalOverrideInferenceContract = Expect<
  Equal<InferEnv<typeof overriddenEnv>["BASE_TOKEN"], string>
>;

const effectBaseEnv = createEnv({
  server: { EFFECT_VALUE: requiredString },
});
const promiseBaseEnv = createEnvPromise({
  server: { PROMISE_VALUE: requiredString },
});

createEnv({ extends: [effectBaseEnv] });
createEnvPromise({ extends: [promiseBaseEnv] });
createEnv({ extends: [baseEnv] });
createEnvPromise({ extends: [baseEnv] });

createEnvSync({
  // @ts-expect-error Only environments created by Envil can be composed.
  extends: [new Date()],
});

createEnvSync({
  // @ts-expect-error The private Envil brand cannot be forged structurally.
  extends: [{ __envilContract: { server: {}, client: {}, shared: {} } }],
});

createEnv({
  // @ts-expect-error Effects can only be unresolved by createEnv.
  extends: [promiseBaseEnv],
});
createEnvPromise({
  // @ts-expect-error Promises can only be unresolved by createEnvPromise.
  extends: [effectBaseEnv],
});
createEnvSync({
  // @ts-expect-error createEnvSync only composes resolved environment values.
  extends: [effectBaseEnv],
});
createEnvSync({
  // @ts-expect-error createEnvSync only composes resolved environment values.
  extends: [promiseBaseEnv],
});

const customEnv = createEnv({
  server: { INTERNAL_TOKEN: requiredString },
  resolvers: ({ resolve }) => [
    resolve(customSecretsAdapter, {
      secrets: { INTERNAL_TOKEN: "tenant/internal-token" },
    }),
  ],
});
export type CustomRequirementContract = Expect<
  Equal<EffectRequirements<typeof customEnv>, SecretSource>
>;

const composedCustomEnv = createEnv({ extends: [customEnv] });
export type ComposedRequirementContract = Expect<
  Equal<EffectRequirements<typeof composedCustomEnv>, SecretSource>
>;

const customLayer = SecretSource.fromPromise({
  get: async () => Option.some("secret"),
});

createEnvPromise(
  {
    server: { INTERNAL_TOKEN: requiredString },
    resolvers: ({ resolve }) => [
      resolve(customSecretsAdapter, {
        secrets: { INTERNAL_TOKEN: "tenant/internal-token" },
      }),
    ],
  },
  { layer: customLayer },
);

createEnvPromise(
  {
    server: { INTERNAL_TOKEN: requiredString },
    resolvers: ({ resolve }) => [
      // @ts-expect-error The provided Layer must satisfy SecretSource.
      resolve(customSecretsAdapter, {
        secrets: { INTERNAL_TOKEN: "tenant/internal-token" },
      }),
    ],
  },
  {
    layer: Layer.empty,
  },
);

createEnvPromise({
  server: { INTERNAL_TOKEN: requiredString },
  resolvers: ({ resolve }) => [
    // @ts-expect-error Custom adapter requirements need an explicit Layer.
    resolve(customSecretsAdapter, {
      secrets: { INTERNAL_TOKEN: "tenant/internal-token" },
    }),
  ],
});

createEnv({
  server: {
    AWS: requiredString,
    GCP: requiredString,
    AZURE: requiredString,
    OP: requiredString,
  },
  resolvers: ({ resolve }) => [
    resolve(awsSecretsAdapter, { secrets: { AWS: "aws-ref" } }),
    resolve(gcpSecretsAdapter, {
      projectId: "project",
      secrets: { GCP: "gcp-ref" },
    }),
    resolve(azureKeyVaultAdapter, {
      vaultUrl: "https://vault.example.com",
      secrets: { AZURE: "azure-ref" },
    }),
    resolve(onePasswordSecretsAdapter, {
      serviceAccountToken: "token",
      secrets: { OP: "op://vault/item/field" },
    }),
  ],
});

createEnvPromise({
  server: { TOKEN: requiredString },
  resolvers: ({ resolve }) => [
    resolve(awsSecretsAdapter, {
      secrets: { TOKEN: "aws-reference" },
    }),
  ],
});

createEnv({
  server: { KNOWN: requiredString },
  resolvers: ({ resolve }) => [
    resolve(awsSecretsAdapter, {
      secrets: {
        // @ts-expect-error Resolver keys are bound to the server schema.
        UNKNOWN: "secret-reference",
      },
    }),
  ],
});

createEnv({
  server: { DUPLICATE: requiredString },
  // @ts-expect-error A logical key cannot be handled by two resolvers.
  resolvers: ({ resolve }) => [
    resolve(awsSecretsAdapter, { secrets: { DUPLICATE: "one" } }),
    resolve(gcpSecretsAdapter, {
      projectId: "project",
      secrets: { DUPLICATE: "two" },
    }),
  ],
});

// @ts-expect-error A logical key cannot exist in multiple buckets.
createEnv({
  server: { DUPLICATE: requiredString },
  client: { DUPLICATE: requiredString },
});

// @ts-expect-error Prefix application cannot produce duplicate physical keys.
createEnv({
  server: { PUBLIC_URL: requiredString },
  client: { URL: requiredString },
  prefix: { client: "PUBLIC_" },
});

// @ts-expect-error Redacted schemas are server-only.
createEnv({
  client: { PUBLIC_SECRET: redacted(requiredString) },
});

// @ts-expect-error Redacted schemas are server-only.
createEnv({
  shared: { SHARED_SECRET: redacted(requiredString) },
});

createEnvSync({
  server: { TOKEN: requiredString },
  // @ts-expect-error createEnvSync cannot execute resolvers.
  resolvers: ({ resolve }) => [resolve(awsSecretsAdapter, { secrets: { TOKEN: "reference" } })],
});

const resultEffect = createEnv({
  server: { TOKEN: requiredString },
  runtimeEnv: { TOKEN: "value" },
}).pipe(asResult());
export type ResultRequirementsContract = Expect<
  Equal<EffectRequirements<typeof resultEffect>, never>
>;
