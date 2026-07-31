import { siAstro, siExpo, siSvelte, siVite, type SimpleIcon } from "simple-icons";

import pkg from "../../../package.json";

function brandIcon(icon: SimpleIcon, color = icon.hex): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#${color}"><path d="${icon.path}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const site = {
  name: "envil",
  fullName: "@ayronforge/envil",
  version: pkg.version,
  tagline: "Environment variables you can trust at runtime",
  description:
    "Validate, secure, and manage your environment variables with full TypeScript inference. From web apps to autonomous AI agents — your config is always correct, your secrets always protected. Built on Effect Schema.",
  github: "https://github.com/ayronforge/envil",
  npm: "https://www.npmjs.com/package/@ayronforge/envil",
  install: "bun add @ayronforge/envil effect",
};

export const features = [
  {
    name: "Effect Schema",
    headline: "Powered by Effect Schema",
    description:
      "Use the full power of Effect Schema for validation, transformation, and branding. Every env var gets runtime type checking with structured, parseable error messages.",
  },
  {
    name: "Type Inference",
    headline: "Full Type Inference",
    description:
      "Automatic TypeScript inference from your schema definitions. No manual type annotations needed — your env object is fully typed.",
  },
  {
    name: "Client Safety",
    headline: "Guarded Runtime Boundaries",
    description:
      "Independent Effects, typed outputs, and a defensive Proxy prevent client code from reading or materializing server values.",
  },
  {
    name: "Presets",
    headline: "Framework Presets",
    description:
      "Prefix presets for Vite, Expo, SvelteKit, and Astro compose directly with client fragment options.",
  },
  {
    name: "Secret Managers",
    headline: "Secret Manager Integrations",
    description:
      "Resolve env vars from AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, or 1Password. Pull secrets from wherever your agents are deployed.",
  },
  {
    name: "Composable",
    headline: "Composable & Extensible",
    description:
      "Compose target-aware fragments with extendEnv, map individual variables with fromEnv or fromResolver, and keep public shared values explicit.",
  },
];

export const secretManagers = [
  {
    name: "AWS Secrets Manager",
    icon: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/amazonwebservices/amazonwebservices-original-wordmark.svg",
    import: "@ayronforge/envil/aws",
    description: "Resolve secrets from AWS Secrets Manager using the AWS SDK.",
    code: `import { configureResolver, createEnv, fromResolver, requiredString, server } from "@ayronforge/envil"
import { awsSecretsAdapter } from "@ayronforge/envil/aws"

const aws = configureResolver(awsSecretsAdapter, { region: "us-east-1" })

const appEnv = createEnv(
  server({
    DB_PASS: requiredString.pipe(fromResolver(aws, "prod/db-password")),
  }),
)`,
  },
  {
    name: "Azure Key Vault",
    icon: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/azure/azure-original.svg",
    import: "@ayronforge/envil/azure",
    description: "Fetch secrets from Azure Key Vault with managed identity support.",
    code: `import { configureResolver, createEnv, fromResolver, requiredString, server } from "@ayronforge/envil"
import { azureKeyVaultAdapter } from "@ayronforge/envil/azure"

const azure = configureResolver(azureKeyVaultAdapter, {
  vaultUrl: "https://my-vault.vault.azure.net",
})

const appEnv = createEnv(
  server({
    DB_PASS: requiredString.pipe(fromResolver(azure, "db-password")),
  }),
)`,
  },
  {
    name: "GCP Secret Manager",
    icon: "https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/googlecloud/googlecloud-original.svg",
    import: "@ayronforge/envil/gcp",
    description: "Access secrets stored in Google Cloud Secret Manager.",
    code: `import { configureResolver, createEnv, fromResolver, requiredString, server } from "@ayronforge/envil"
import { gcpSecretsAdapter } from "@ayronforge/envil/gcp"

const gcp = configureResolver(gcpSecretsAdapter, { projectId: "my-project" })

const appEnv = createEnv(
  server({
    DB_PASS: requiredString.pipe(fromResolver(gcp, "db-password")),
  }),
)`,
  },
  {
    name: "1Password",
    icon: "https://cdn.simpleicons.org/1password/3B66BC",
    import: "@ayronforge/envil/1password",
    description: "Retrieve secrets directly from 1Password vaults.",
    code: `import { configureResolver, createEnv, fromResolver, requiredString, server } from "@ayronforge/envil"
import { onePasswordSecretsAdapter } from "@ayronforge/envil/1password"

const onePassword = configureResolver(onePasswordSecretsAdapter, {})

const appEnv = createEnv(
  server({
    DB_PASS: requiredString.pipe(
      fromResolver(onePassword, "op://vault/item/field"),
    ),
  }),
)`,
  },
];

export const presets = [
  {
    name: "Vite",
    iconLight: brandIcon(siVite),
    iconDark: brandIcon(siVite),
    prefix: "VITE_",
    code: `import { client, createEnv, requiredString, server, url } from "@ayronforge/envil"
import { vite } from "@ayronforge/envil/presets"

const appEnv = createEnv(
  server({ SECRET_KEY: requiredString }),
  client(
    { API_URL: url },
    { ...vite, runtimeEnv: import.meta.env },
  ),
)`,
  },
  {
    name: "Expo",
    iconLight: brandIcon(siExpo),
    iconDark: brandIcon(siExpo, "FFFFFF"),
    icon: "expo",
    prefix: "EXPO_PUBLIC_",
    code: `import { client, createEnv, url } from "@ayronforge/envil"
import { expo } from "@ayronforge/envil/presets"

const appEnv = createEnv(
  client(
    { API_URL: url },
    expo,
  ),
)`,
  },
  {
    name: "SvelteKit",
    iconLight: brandIcon(siSvelte),
    iconDark: brandIcon(siSvelte),
    prefix: "PUBLIC_",
    code: `import { env } from "$env/dynamic/public"
import { client, createEnv, url } from "@ayronforge/envil"
import { sveltekit } from "@ayronforge/envil/presets"

const appEnv = createEnv(
  client(
    { API_URL: url },
    { ...sveltekit, runtimeEnv: env },
  ),
)`,
  },
  {
    name: "Astro",
    iconLight: brandIcon(siAstro),
    iconDark: brandIcon(siAstro),
    prefix: "PUBLIC_",
    code: `import { client, createEnv, url } from "@ayronforge/envil"
import { astro } from "@ayronforge/envil/presets"

const appEnv = createEnv(
  client(
    { API_URL: url },
    { ...astro, runtimeEnv: import.meta.env },
  ),
)`,
  },
];

export const codeExample = `import { client, createEnv, postgresUrl, redacted, requiredString, server, shared, url } from "@ayronforge/envil"

export const appEnv = createEnv(
  shared({
    APP_NAME: "My App",
  }),
  server({
    OPENAI_API_KEY: redacted(requiredString),
    DATABASE_URL: redacted(postgresUrl),
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
)`;

export const agentFeatures = [
  {
    headline: "Fail Before You Run",
    description:
      "Validation runs at startup, not at first use. Missing or malformed secrets crash immediately with a structured error — not halfway through a task.",
  },
  {
    headline: "Secrets That Stay Secret",
    description:
      "{{redacted}} wraps sensitive values so they never appear in logs, traces, or agent output. Your API keys stay invisible even when agents serialize their state.",
  },
  {
    headline: "Errors Agents Can Act On",
    description:
      "Every validation failure returns a typed, structured error with the exact variable name and reason. Agents can read what went wrong and correct course — no log parsing required.",
  },
  {
    headline: "Modular Design",
    description:
      "Compose target-aware fragments and attach each runtime or resolver source directly to the definition that owns it.",
  },
];
