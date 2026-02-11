import pkg from "../../../package.json";

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
    headline: "Client/Server Separation",
    description:
      "Define server-only and client-safe variables separately. Accessing server vars on the client throws at runtime — no secrets leaked, even in agent-generated output.",
  },
  {
    name: "Presets",
    headline: "Framework Presets",
    description:
      "Pre-configured setups for Next.js, Vite, Expo, and more. Get the right prefix rules and runtime env settings out of the box.",
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
      "Compose multiple env configs with `extends`. Build shared base configs and layer service-specific vars on top — ideal for multi-agent architectures.",
  },
];

export const secretManagers = [
  {
    name: "AWS Secrets Manager",
    icon: "amazonwebservices",
    import: "@ayronforge/envil/aws",
    description: "Resolve secrets from AWS Secrets Manager using the AWS SDK.",
    code: `import { fromAwsSecrets } from "@ayronforge/envil/aws"

fromAwsSecrets({
  secrets: {
    DB_PASS: "prod/db-password",
    DB_USER: "prod/db-credentials#username",
  },
  region: "us-east-1",
})`,
  },
  {
    name: "Azure Key Vault",
    icon: "azure",
    import: "@ayronforge/envil/azure",
    description: "Fetch secrets from Azure Key Vault with managed identity support.",
    code: `import { fromAzureKeyVault } from "@ayronforge/envil/azure"

fromAzureKeyVault({
  secrets: {
    DB_PASS: "db-password",
    API_KEY: "my-api-key",
  },
  vaultUrl: "https://my-vault.vault.azure.net",
})`,
  },
  {
    name: "GCP Secret Manager",
    icon: "googlecloud",
    import: "@ayronforge/envil/gcp",
    description: "Access secrets stored in Google Cloud Secret Manager.",
    code: `import { fromGcpSecrets } from "@ayronforge/envil/gcp"

fromGcpSecrets({
  secrets: {
    DB_PASS: "db-password",
    API_KEY: "projects/my-project/secrets/api-key/versions/2",
  },
  projectId: "my-project",
})`,
  },
  {
    name: "1Password",
    icon: "1password",
    import: "@ayronforge/envil/1password",
    description: "Retrieve secrets directly from 1Password vaults.",
    code: `import { fromOnePassword } from "@ayronforge/envil/1password"

fromOnePassword({
  secrets: {
    DB_PASS: "op://vault/item/field",
    API_KEY: "op://vault/another-item/credential",
  },
})`,
  },
];

export const presets = [
  {
    name: "Next.js",
    icon: "nextdotjs",
    prefix: "NEXT_PUBLIC_",
    code: `import { createEnv, postgresUrl, url } from "@ayronforge/envil"
import { nextjs } from "@ayronforge/envil/presets"

const env = createEnv({
  ...nextjs,
  server: { DATABASE_URL: postgresUrl },
  client: { API_URL: url },
})`,
  },
  {
    name: "Vite",
    icon: "vite",
    prefix: "VITE_",
    code: `import { createEnv, requiredString, url } from "@ayronforge/envil"
import { vite } from "@ayronforge/envil/presets"

const env = createEnv({
  ...vite,
  server: { SECRET_KEY: requiredString },
  client: { API_URL: url },
})`,
  },
  {
    name: "Expo",
    icon: "expo",
    prefix: "EXPO_PUBLIC_",
    code: `import { createEnv, url } from "@ayronforge/envil"
import { expo } from "@ayronforge/envil/presets"

const env = createEnv({
  ...expo,
  client: { API_URL: url },
})`,
  },
  {
    name: "Nuxt",
    icon: "nuxtjs",
    deviconVariant: "plain",
    invertIcon: true,
    prefix: "NUXT_PUBLIC_",
    code: `import { createEnv, url } from "@ayronforge/envil"
import { nuxt } from "@ayronforge/envil/presets"

const env = createEnv({
  ...nuxt,
  client: { API_URL: url },
})`,
  },
  {
    name: "SvelteKit",
    icon: "svelte",
    prefix: "PUBLIC_",
    code: `import { createEnv, url } from "@ayronforge/envil"
import { sveltekit } from "@ayronforge/envil/presets"

const env = createEnv({
  ...sveltekit,
  client: { API_URL: url },
})`,
  },
  {
    name: "Astro",
    icon: "astro",
    prefix: "PUBLIC_",
    code: `import { createEnv, url } from "@ayronforge/envil"
import { astro } from "@ayronforge/envil/presets"

const env = createEnv({
  ...astro,
  client: { API_URL: url },
})`,
  },
];

export const codeExample = `import { createEnv, redacted, url } from "@ayronforge/envil"
import { Schema } from "effect"

export const env = createEnv({
  server: {
    OPENAI_API_KEY: redacted(Schema.String),
    DATABASE_URL: Schema.String,
    VECTOR_STORE_URL: url,
  },
  client: {
    NEXT_PUBLIC_APP_URL: url,
  },
  shared: {
    NODE_ENV: Schema.Literal("development", "production", "test"),
  },
})`;

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
      "Compose, layer, and override configs across services and environments. Base credentials, tool-specific keys, and deployment overrides — all validated, all typed, all composable.",
  },
];
