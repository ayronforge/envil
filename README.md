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
- **Detailed error messages** — validation errors include specific details about what went wrong, not just "invalid or missing"
- **Built-in schemas** — common patterns out of the box: booleans, integers, ports, URLs, database connection strings, comma-separated lists, JSON, enums, and more
- **Default values** — provide fallbacks for optional vars with `withDefault()`
- **Redacted secrets** — wrap sensitive values with `redacted()` to prevent accidental logging. Values are auto-unwrapped on access
- **Prefix support** — namespace your env vars with a uniform string (e.g. `APP_`) or per-category object (e.g. `{ client: "NEXT_PUBLIC_" }`), with built-in framework presets
- **Validation callbacks** — hook into validation errors with `onValidationError` for custom logging or monitoring
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
  url,
  postgresUrl,
  port,
  boolean,
  stringEnum,
} from "@ayronforge/better-env";

export const env = createEnv({
  /* Server-only variables — accessing these on the client will throw */
  server: {
    DATABASE_URL: postgresUrl,
    API_SECRET: redacted(requiredString),
    PORT: withDefault(port, 3000),
    DEBUG: withDefault(boolean, false),
    NODE_ENV: stringEnum(["development", "staging", "production"]),
  },

  /* Client-safe variables */
  client: {
    PUBLIC_API_URL: url,
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

console.log(env.DATABASE_URL); // string (postgresUrl) — fully typed
console.log(env.API_SECRET);   // string — redacted value auto-unwrapped
console.log(env.PORT);         // number — transformed from string
console.log(env.DEBUG);        // boolean — parsed from "true"/"false"/"1"/"0"
console.log(env.NODE_ENV);     // "development" | "staging" | "production"
console.log(env.APP_NAME);     // string — falls back to "my-app"
```

If any variable is missing or invalid, `createEnv()` throws an `EnvValidationError` immediately with detailed errors:

```
EnvValidationError: Invalid environment variables:
DATABASE_URL: Expected a valid PostgreSQL connection URL
API_SECRET: Expected a string with at least 1 character(s), actual ""
```

The error exposes a structured `.errors` array for programmatic access:

```ts
import { createEnv, EnvValidationError } from "@ayronforge/better-env";

try {
  createEnv({ /* ... */ });
} catch (e) {
  if (e instanceof EnvValidationError) {
    console.log(e._tag);   // "EnvValidationError"
    console.log(e.errors);  // ["DATABASE_URL: ...", "API_SECRET: ..."]
  }
}
```

### Client-side protection

When running on the client (`typeof window !== "undefined"`), server-only variables are **not validated** and any attempt to access them throws a `ClientAccessError`:

```ts
// In a browser context
import { env } from "./env";

env.PUBLIC_API_URL; // "https://api.example.com" — works fine
env.APP_NAME;       // "my-app" — shared vars are accessible
env.DATABASE_URL;   // throws: Attempted to access server-side env var "DATABASE_URL" on client
```

You can catch and inspect the error programmatically:

```ts
import { ClientAccessError } from "@ayronforge/better-env";

try {
  env.DATABASE_URL;
} catch (e) {
  if (e instanceof ClientAccessError) {
    console.log(e._tag);          // "ClientAccessError"
    console.log(e.variableName);  // "DATABASE_URL"
  }
}
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

### Per-category prefixes & framework presets

Pass an object to `prefix` to apply different prefixes per category:

```ts
const env = createEnv({
  server: { DB: requiredString },
  client: { API_URL: url },
  prefix: { server: "SRV_", client: "NEXT_PUBLIC_" },
  // server: reads SRV_DB, client: reads NEXT_PUBLIC_API_URL
  // omitted categories default to no prefix
});
```

Built-in presets are available for popular frameworks:

```ts
import { createEnv, postgresUrl, url } from "@ayronforge/better-env";
import { nextjs } from "@ayronforge/better-env/presets";

const env = createEnv({
  ...nextjs, // { prefix: { client: "NEXT_PUBLIC_" } }
  server: {
    DATABASE_URL: postgresUrl,
  },
  client: {
    API_URL: url,
  },
});
// server: reads DATABASE_URL (no prefix)
// client: reads NEXT_PUBLIC_API_URL
// accessed as: env.DATABASE_URL, env.API_URL
```

Available presets:

| Preset | Prefix |
|---|---|
| `nextjs` | `{ client: "NEXT_PUBLIC_" }` |
| `vite` | `{ client: "VITE_" }` |
| `expo` | `{ client: "EXPO_PUBLIC_" }` |

Since presets spread into `prefix`, you can combine them with your own prefixes by spreading the preset first and merging the `prefix` object:

```ts
import { createEnv, postgresUrl, requiredString, url } from "@ayronforge/better-env";
import { nextjs } from "@ayronforge/better-env/presets";

const env = createEnv({
  server: { DATABASE_URL: postgresUrl },
  client: { API_URL: url },
  shared: { APP_NAME: requiredString },
  prefix: { ...nextjs.prefix, server: "MY_", shared: "MY_" },
  // server: reads MY_DATABASE_URL
  // client: reads NEXT_PUBLIC_API_URL (from preset)
  // shared: reads MY_APP_NAME
});
```

### Validation error callback

Hook into validation errors for custom logging or monitoring:

```ts
const env = createEnv({
  server: { DB: requiredString },
  onValidationError: (errors) => {
    // Send to monitoring, log to file, etc.
    console.error("Env validation failed:", errors);
  },
});
```

The callback is invoked before the error is thrown. If you want to throw a custom error, throw from the callback.

### Testing

Inject a custom env source to make your tests deterministic:

```ts
const env = createEnv({
  server: { DATABASE_URL: postgresUrl },
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
| `boolean` | `string` | `boolean` | Case-insensitive `"true"`/`"false"`/`"1"`/`"0"` |
| `integer` | `string` | `number` | Integer only (no decimals) |
| `positiveNumber` | `string` | `number` | Parses string to a positive number (> 0) |
| `nonNegativeNumber` | `string` | `number` | Parses string to a non-negative number (>= 0) |
| `port` | `string` | `number` | Integer between 1 and 65535 |
| `url` | `string` | `string` | Validates HTTP/HTTPS URLs |
| `postgresUrl` | `string` | `string` | Validates `postgres://` / `postgresql://` connection strings |
| `redisUrl` | `string` | `string` | Validates `redis://` / `rediss://` connection strings |
| `mongoUrl` | `string` | `string` | Validates `mongodb://` / `mongodb+srv://` connection strings |
| `mysqlUrl` | `string` | `string` | Validates `mysql://` / `mysqls://` connection strings |
| `commaSeparated` | `string` | `string[]` | Splits and trims a comma-separated string |
| `commaSeparatedNumbers` | `string` | `number[]` | Splits into a number array (rejects non-numeric entries) |
| `commaSeparatedUrls` | `string` | `string[]` | Splits into validated URLs |

### Parameterized Schemas

| Schema | Description |
|---|---|
| `stringEnum(["a", "b", "c"])` | Validates against a list of allowed string values |
| `json(schema)` | Parses a JSON string and validates against an Effect Schema |

```ts
import { createEnv, stringEnum, json } from "@ayronforge/better-env";
import { Schema } from "effect";

const env = createEnv({
  server: {
    NODE_ENV: stringEnum(["development", "staging", "production"]),
    FEATURE_FLAGS: json(Schema.Struct({ darkMode: Schema.Boolean })),
  },
});

env.NODE_ENV;      // "development" | "staging" | "production"
env.FEATURE_FLAGS; // { darkMode: boolean }
```

### Helpers

| Helper | Pipe-style | Description |
|---|---|---|
| `withDefault(schema, value)` | `schema.pipe(withDefault(value))` | Falls back to `value` when the env var is undefined |
| `redacted(schema)` | `schema.pipe(redacted)` | Wraps the value in Effect's `Redacted` type to prevent accidental exposure |
| `json(schema)` | `schema.pipe(json)` | Parses a JSON string and validates against an Effect Schema |

All helpers support pipe-style composition:

```ts
import { port, requiredString, withDefault, redacted } from "@ayronforge/better-env";

// Data-first (nested)
withDefault(port, 3000);

// Data-last (piped)
port.pipe(withDefault(3000));

// Composition — chain multiple helpers
requiredString.pipe(withDefault("x"), redacted);
```

You can also use **any Effect Schema** directly — `better-env` accepts any `Schema<A, string, never>`.

## Acknowledgements

This project is heavily inspired by [T3 Env](https://env.t3.gg) by [T3 OSS](https://github.com/t3-oss/t3-env). Thanks to the T3 team for their work and contributions to open source.

## License

[MIT](./LICENSE)
