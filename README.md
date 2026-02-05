# @ayronforge/better-env

Typesafe environment variables using [Effect Schema](https://effect.website/docs/schema/introduction).

![NPM Version](https://img.shields.io/npm/v/@ayronforge/better-env)
![License](https://img.shields.io/npm/l/@ayronforge/better-env)

Never deploy with invalid environment variables again. **better-env** validates all your env vars at startup, gives you full TypeScript autocompletion, and keeps server secrets out of client bundles — powered by the [Effect](https://effect.website) ecosystem.

## Requirements

- **Node.js** 18+
- **ESM only**
- [**effect**](https://effect.website) ^3.19.11

## Features

- **Full type inference** — env vars are fully typed from your schemas, no manual type annotations needed
- **Client / server separation** — declare which vars belong to the server, client, or both. Accessing a server-only var on the client throws at runtime
- **Eager validation** — all variables are validated the moment `createEnv()` is called, with every error collected and reported at once
- **Built-in schemas** — common patterns out of the box: required strings, positive numbers, URLs, Postgres/Redis connection strings, comma-separated lists, and more
- **Default values** — provide fallbacks for optional vars with `withDefault()`
- **Redacted secrets** — wrap sensitive values with `redacted()` to prevent accidental logging. Values are auto-unwrapped on access
- **Prefix support** — namespace your env vars (e.g. `APP_`) without cluttering your schema keys
- **Custom runtime env** — inject a custom env source for testing or non-Node runtimes via `runtimeEnv`
- **Effect Schema** — leverage the full power of Effect's schema system for transforms, filters, and composition

## Installation

```bash
# npm
npm install @ayronforge/better-env

# pnpm
pnpm add @ayronforge/better-env

# bun
bun add @ayronforge/better-env
```

## Usage

### Define your env schema

```ts
// src/env.ts
import {
  createEnv,
  requiredString,
  positiveNumber,
  redacted,
  withDefault,
  Url,
  PostgresUrl,
} from "@ayronforge/better-env";

export const env = createEnv({
  /* Server-only variables — accessing these on the client will throw */
  server: {
    DATABASE_URL: PostgresUrl,
    API_SECRET: redacted(requiredString),
    PORT: withDefault(positiveNumber, 3000),
  },

  /* Client-safe variables */
  client: {
    PUBLIC_API_URL: Url,
  },

  /* Shared between server and client */
  shared: {
    APP_NAME: withDefault(requiredString, "my-app"),
  },
});
```

### Use it in your app with autocompletion and type safety

```ts
// src/server.ts
import { env } from "./env";

console.log(env.DATABASE_URL); // string (PostgresUrl) — fully typed
console.log(env.API_SECRET);   // string — redacted value auto-unwrapped
console.log(env.PORT);         // number — transformed from string
console.log(env.APP_NAME);     // string — falls back to "my-app"
```

If any variable is missing or invalid, `createEnv()` throws immediately with all errors:

```
Error: Invalid environment variables:
DATABASE_URL: invalid or missing
API_SECRET: invalid or missing
```

### Client-side protection

When running on the client (`typeof window !== "undefined"`), server-only variables are **not validated** and any attempt to access them throws:

```ts
// In a browser context
import { env } from "./env";

env.PUBLIC_API_URL; // "https://api.example.com" — works fine
env.APP_NAME;       // "my-app" — shared vars are accessible
env.DATABASE_URL;   // throws: Attempted to access server-side env var "DATABASE_URL" on client
```

### Prefix support

Namespace your env vars without changing your schema keys:

```ts
const env = createEnv({
  server: { DB_HOST: requiredString },
  prefix: "APP_",
  // Reads from APP_DB_HOST in process.env, but accessed as env.DB_HOST
});
```

### Testing

Inject a custom env source to make your tests deterministic:

```ts
const env = createEnv({
  server: { DATABASE_URL: PostgresUrl },
  runtimeEnv: {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
  },
  isServer: true,
});
```

## Built-in Schemas

| Schema | Input | Output | Description |
|---|---|---|---|
| `requiredString` | `string` | `string` | Non-empty string |
| `optionalString` | `string \| undefined` | `string \| undefined` | String or undefined |
| `positiveNumber` | `string` | `number` | Parses string to a positive number |
| `Url` | `string` | `string` | Validates HTTP/HTTPS URLs |
| `PostgresUrl` | `string` | `string` | Validates `postgresql://` connection strings |
| `RedisUrl` | `string` | `string` | Validates `redis://` / `rediss://` connection strings |
| `commaSeparated` | `string` | `string[]` | Splits and trims a comma-separated string |
| `commaSeparatedNumbers` | `string` | `number[]` | Splits into a number array |
| `commaSeparatedUrls` | `string` | `string[]` | Splits into validated URLs |

### Helpers

| Helper | Description |
|---|---|
| `withDefault(schema, value)` | Falls back to `value` when the env var is undefined |
| `redacted(schema)` | Wraps the value in Effect's `Redacted` type to prevent accidental exposure |

You can also use **any Effect Schema** directly — `better-env` accepts any `Schema<A, string, never>`.

## Acknowledgements

This project is heavily inspired by [T3 Env](https://env.t3.gg) by [T3 OSS](https://github.com/t3-oss/t3-env). Thanks to the T3 team for their work and contributions to open source.

## License

[MIT](./LICENSE)
