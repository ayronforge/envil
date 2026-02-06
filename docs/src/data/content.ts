export const site = {
  name: "better-env",
  fullName: "@ayronforge/better-env",
  version: "0.3.1",
  tagline: "Environment variables you can trust at runtime",
  description:
    "Validate, secure, and manage your environment variables with full TypeScript inference. From web apps to autonomous AI agents — your config is always correct, your secrets always protected. Built on Effect Schema.",
  github: "https://github.com/ayronforge/better-env",
  npm: "https://www.npmjs.com/package/@ayronforge/better-env",
  install: "bun add @ayronforge/better-env effect",
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
    import: "@ayronforge/better-env/aws",
    description: "Resolve secrets from AWS Secrets Manager using the AWS SDK.",
    code: `import { fromAwsSecrets } from "@ayronforge/better-env/aws"

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
    import: "@ayronforge/better-env/azure",
    description: "Fetch secrets from Azure Key Vault with managed identity support.",
    code: `import { fromAzureKeyVault } from "@ayronforge/better-env/azure"

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
    import: "@ayronforge/better-env/gcp",
    description: "Access secrets stored in Google Cloud Secret Manager.",
    code: `import { fromGcpSecrets } from "@ayronforge/better-env/gcp"

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
    import: "@ayronforge/better-env/1password",
    description: "Retrieve secrets directly from 1Password vaults.",
    code: `import { fromOnePassword } from "@ayronforge/better-env/1password"

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
    code: `import { createEnv, postgresUrl, url } from "@ayronforge/better-env"
import { nextjs } from "@ayronforge/better-env/presets"

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
    code: `import { createEnv, requiredString, url } from "@ayronforge/better-env"
import { vite } from "@ayronforge/better-env/presets"

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
    code: `import { createEnv, url } from "@ayronforge/better-env"
import { expo } from "@ayronforge/better-env/presets"

const env = createEnv({
  ...expo,
  client: { API_URL: url },
})`,
  },
];

export const codeExample = `import { createEnv, redacted, url } from "@ayronforge/better-env"
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
