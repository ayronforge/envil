# Envil

Type-safe environment validation for TypeScript applications, built on Effect
Schema. Envil composes independent server, client, and shared contexts while
preserving Effect errors, requirements, and arbitrary schemas.

```bash
bun add @ayronforge/envil effect
```

## Define an app environment

```ts
import {
  client,
  createEnv,
  redacted,
  requiredString,
  server,
  shared,
  url,
} from "@ayronforge/envil";

export const appEnv = createEnv(
  shared({
    APP_NAME: "My App",
  }),
  server({
    // process.env is the server default
    DATABASE_URL: redacted(requiredString),
  }),
  client(
    {
      APP_URL: url,
    },
    {
      runtimeEnv: import.meta.env,
      prefix: "VITE_",
    },
  ),
);
```

`appEnv.server` and `appEnv.client` are independent lazy Effects:

```ts
import { Effect } from "effect";

const serverEnv = Effect.runSync(appEnv.server);
const clientEnv = await Effect.runPromise(appEnv.client);
```

Server materialization reads `server + client + shared`. Client materialization
reads `client + shared`. Static values may also live directly in a target
fragment.

## Composition

`extendEnv` is the canonical composition path for existing environments:

```ts
const authenticationEnv = createEnv(
  server({
    AUTH_SECRET: requiredString,
  }),
  client({
    SIGN_IN_PATH: "/sign-in",
  }),
);

export const appEnv = baseEnv.pipe(
  extendEnv(authenticationEnv),
  extendEnv(
    server({
      LOG_LEVEL: requiredString,
    }),
    client({
      APP_URL: "https://app.example.com",
    }),
  ),
);
```

Composition runs left to right. When a key is repeated in the same runtime
context, the last complete definition wins, including its schema, source,
runtime configuration, redaction, errors, and Effect requirements.

Each fragment owns its `runtimeEnv`, prefix, and empty-string policy, so packages
and application modules can contribute contexts independently.

## Build-time separation

Use the Vite plugin to remove every `server(...)` expression from client builds
before its schema, resolver, or adapter code enters the public bundle:

```ts
import { defineConfig } from "vite";
import envil from "@ayronforge/envil/plugins/vite";

export default defineConfig({
  plugins: [envil()],
});
```

Envil also publishes plugins for Rollup, Rolldown, Webpack, Rspack, and esbuild.
Generic plugins accept `{ target: "client" | "server" }`. Server builds retain
both client and server contexts.

`server` is a compiler boundary. The transform does not inspect schemas,
spreads, factory functions, or resolver implementations, so every Effect Schema
and ordinary custom resolver remains runtime code.

## Runtime sources

`runtimeEnv` accepts ordinary environment objects, parsed JSON objects, and
Maps. Use `fromEnv` for an exact external name or a dot-separated JSON path:

```ts
const appEnv = createEnv(
  server(
    {
      API_URL: url.pipe(fromEnv("application.apiUrl")),
    },
    {
      runtimeEnv: {
        application: {
          apiUrl: "https://api.example.com",
        },
      },
    },
  ),
);
```

Map keys are always exact. JSON objects try an exact key first, then a nested
path.

## Resolvers

Configure adapter-wide options once and attach references directly to variables:

```ts
import {
  configureResolver,
  createEnv,
  fromResolver,
  requiredString,
  server,
} from "@ayronforge/envil";
import { awsSecretsAdapter } from "@ayronforge/envil/aws";

const aws = configureResolver(awsSecretsAdapter, {
  region: "us-east-1",
});

export const appEnv = createEnv(
  server({
    DATABASE_PASSWORD: requiredString.pipe(
      fromResolver(aws, "production/database#password"),
    ),
  }),
);
```

Resolver-backed values are server-only, authoritative, automatically redacted,
and batched with other variables using the same configured resolver. Custom
adapters use the same ordinary Effect-based `ResolverAdapter` contract and need
no compiler-specific metadata.

## Type inference

```ts
import type {
  InferClientEnv,
  InferServerEnv,
} from "@ayronforge/envil";

type ServerEnvironment = InferServerEnv<typeof appEnv>;
type ClientEnvironment = InferClientEnv<typeof appEnv>;
```

`InferEnv<typeof appEnv.server>` is also supported.

## CLI

```bash
envil init
envil init --from .env
envil example --input src/env.ts
```

`envil example` uses the TypeScript Compiler API. It does not import the
application module, read runtime environments, or execute resolvers.

See the full documentation in [`docs/src/content/docs`](./docs/src/content/docs).

## Development

```bash
bun typecheck
bun test
```

MIT
