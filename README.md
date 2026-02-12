# @ayronforge/envil

Typesafe environment variables using [Effect Schema](https://effect.website/docs/schema/introduction).

![NPM Version](https://img.shields.io/npm/v/@ayronforge/envil)
![License](https://img.shields.io/npm/l/@ayronforge/envil)

Never deploy with invalid environment variables again. **envil** validates all your env vars at startup, gives you full TypeScript autocompletion, and keeps server secrets out of client bundles — powered by the [Effect](https://effect.website) ecosystem.

## Documentation

For schemas, helpers, prefix support, framework presets, composable envs, resolvers, and more — visit the **[documentation](https://ayronforge.com/envil)**.

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
npm install @ayronforge/envil effect

# pnpm
pnpm add @ayronforge/envil effect

# bun
bun add @ayronforge/envil effect
```

## CLI (`envil`)

This package ships a CLI named `envil` with deterministic schema/example round-tripping:

```bash
# infer env.ts from .env.example
envil add env --input .env.example --output src/env.ts --force

# regenerate .env.example from env.ts manifest
envil add example --input src/env.ts --output .env.example --force
```

`envil add env` supports:

- `--framework <nextjs|vite|expo|nuxt|sveltekit|astro>`
- `--client-prefix <prefix>`
- `--server-prefix <prefix>`
- `--shared-prefix <prefix>`
- `--force`

`envil add example` supports:

- `--input <path>`
- `--output <path>`
- `--force`

Both commands support `--help` for full usage output.

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
} from "@ayronforge/envil";

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
