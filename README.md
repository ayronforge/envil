# @ayronforge/better-env

Typesafe environment variables using [Effect Schema](https://effect.website/docs/schema/introduction).

![NPM Version](https://img.shields.io/npm/v/@ayronforge/better-env)
![License](https://img.shields.io/npm/l/@ayronforge/better-env)

Never deploy with invalid environment variables again. **better-env** validates all your env vars at startup, gives you full TypeScript autocompletion, and keeps server secrets out of client bundles — powered by the [Effect](https://effect.website) ecosystem.

## Documentation

For schemas, helpers, prefix support, framework presets, composable envs, resolvers, and more — visit the **[documentation](https://ayronforge.com/better-env)**.

## Highlights

- **Full type inference** — env vars are fully typed from your schemas, no manual annotations needed
- **Client / server separation** — server-only vars throw at runtime if accessed on the client
- **Eager validation** — all errors collected and reported at once on startup
- **Built-in schemas** — booleans, ports, URLs, database URLs, JSON, enums, and more
- **Secret manager resolvers** — fetch secrets from AWS, GCP, Azure Key Vault, and 1Password

## Requirements

- **Node.js** 18+
- **ESM only**
- [**effect**](https://effect.website) ^3.19.11

## Installation

```bash
# npm
npm install @ayronforge/better-env effect

# pnpm
pnpm add @ayronforge/better-env effect

# bun
bun add @ayronforge/better-env effect
```

## Quick start

```ts
import {
  createEnv,
  requiredString,
  port,
  withDefault,
  boolean,
  postgresUrl,
  redacted,
} from "@ayronforge/better-env";

export const env = createEnv({
  server: {
    DATABASE_URL: postgresUrl,
    API_SECRET: redacted(requiredString),
    PORT: withDefault(port, 3000),
    DEBUG: withDefault(boolean, false),
  },
  client: {
    PUBLIC_API_URL: requiredString,
  },
});

env.DATABASE_URL; // string — fully typed
env.API_SECRET;   // Redacted<string> — unwrap with Redacted.value(env.API_SECRET)
env.PORT;         // number — transformed from string
```

If any variable is missing or invalid, `createEnv()` throws immediately with detailed errors:

```
EnvValidationError: Invalid environment variables:
DATABASE_URL: Expected a valid PostgreSQL connection URL
API_SECRET: Expected a string with at least 1 character(s), actual ""
```

## Acknowledgements

This project is heavily inspired by [T3 Env](https://env.t3.gg) by [T3 OSS](https://github.com/t3-oss/t3-env). Thanks to the T3 team for their work and contributions to open source.

## License

[MIT](./LICENSE)
