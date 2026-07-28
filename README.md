# Envil

Type-safe environment validation for TypeScript applications, built on Effect
Schema. Envil separates server, client, and shared variables, redacts secrets,
and can resolve server secrets without weakening the error channel.

```bash
bun add @ayronforge/envil effect
```

## Runtime environment

```ts
import {
  createEnvSync,
  redacted,
  requiredString,
  url,
} from "@ayronforge/envil";

export const env = createEnvSync({
  server: {
    DATABASE_URL: redacted(url),
  },
  client: {
    APP_URL: url,
  },
  prefix: {
    client: "VITE_",
  },
});
```

Use `createEnv` when you want an Effect, and `createEnvPromise` at a Promise
boundary.

## Resolver adapters

```ts
import { createEnv, requiredString } from "@ayronforge/envil";
import { awsSecretsAdapter } from "@ayronforge/envil/aws";

export const env = createEnv({
  server: {
    DATABASE_PASSWORD: requiredString,
  },
  resolvers: ({ resolve }) => [
    resolve(awsSecretsAdapter, {
      region: "us-east-1",
      secrets: {
        DATABASE_PASSWORD: "production/database#password",
      },
    }),
  ],
});
```

Resolver keys are schema-bound to `server`, automatically redacted, and
authoritative. Legitimate absence is modeled with `Option.none()`; provider
failures remain typed failures.

Built-in adapters are isolated by subpath:

- `@ayronforge/envil/aws`
- `@ayronforge/envil/gcp`
- `@ayronforge/envil/azure`
- `@ayronforge/envil/1password`

## Type inference

```ts
import type { InferEnv } from "@ayronforge/envil";

type Environment = InferEnv<typeof env>;
```

`InferEnv` works with an Effect, Promise, synchronous value, or awaited value.
It includes composed environments and preserves decoded and redacted value
types.

## CLI

```bash
envil init
envil init --from .env
envil init --from .env.example
envil example --input src/env.ts
```

`envil example` uses the TypeScript 6 Compiler API to read Envil's internal
type-only contract. It never imports the application module, runs `createEnv`,
reads the application's `process.env`, or calls a resolver.

Generated `.env.example` files contain empty physical keys only:

```env
DATABASE_URL=
VITE_APP_URL=
```

See the full documentation in [`docs/src/content/docs`](./docs/src/content/docs).

## Development

```bash
bun typecheck
bun test
bun run build
```

MIT
