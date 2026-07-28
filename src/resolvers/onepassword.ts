import { Effect } from "effect";

import {
  ResolverConfigurationError,
  ResolverRequestFailed,
  type ResolverAdapter,
  type ResolverError,
  type ResolverResult,
} from "./types.ts";
import { initializeAdapter, resolverEntries, resolverRecord, toResolvedSecret } from "./utils.ts";

/** 1Password service-account adapter options. */
export interface OnePasswordSecretsAdapterOptions {
  readonly serviceAccountToken?: string;
}

function resolveOnePasswordSecrets<const Keys extends string>(
  options: OnePasswordSecretsAdapterOptions & {
    readonly secrets: Readonly<Record<Keys, string>>;
  },
): Effect.Effect<ResolverResult<Keys>, ResolverError> {
  return Effect.gen(function* () {
    const token = options.serviceAccountToken ?? process.env.OP_SERVICE_ACCOUNT_TOKEN;
    if (token === undefined || token.length === 0) {
      return yield* new ResolverConfigurationError({
        adapter: "1password",
        operation: "configure",
        message: "A 1Password service account token is required",
      });
    }

    const client = yield* initializeAdapter("1password", async () => {
      const sdk = await import("@1password/sdk");
      return sdk.createClient({
        auth: token,
        integrationName: "envil",
        integrationVersion: "1.0.0",
      });
    });
    const entries = resolverEntries(options.secrets);
    const references = entries.map(([, reference]) => reference);
    const response = yield* Effect.tryPromise({
      try: () => client.secrets.resolveAll(references),
      catch: () =>
        new ResolverRequestFailed({
          adapter: "1password",
          operation: "read-batch",
          message: "The 1Password secret request failed",
        }),
    });
    const values = [];

    for (const [key, reference] of entries) {
      const individual = response.individualResponses[reference];
      if (
        individual === undefined ||
        individual.error !== undefined ||
        individual.content?.secret === undefined
      ) {
        return yield* new ResolverRequestFailed({
          adapter: "1password",
          operation: "read-batch",
          message: "The 1Password secret batch was only partially resolved",
        });
      }
      values.push([key, toResolvedSecret(individual.content.secret)] as const);
    }

    return resolverRecord(values);
  });
}

/** Resolver adapter for 1Password Secrets Automation. */
export const onePasswordSecretsAdapter: ResolverAdapter<
  "1password",
  string,
  OnePasswordSecretsAdapterOptions,
  ResolverError,
  never
> = {
  name: "1password",
  resolve: resolveOnePasswordSecrets,
};
