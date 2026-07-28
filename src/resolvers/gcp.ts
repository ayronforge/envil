import { Effect } from "effect";

import {
  ResolverConfigurationError,
  type ResolverAdapter,
  type ResolverError,
  type ResolverResult,
} from "./types.ts";
import {
  hasFailureField,
  initializeAdapter,
  requestSecret,
  resolverEntries,
  resolverRecord,
} from "./utils.ts";

/** GCP Secret Manager adapter options. */
export interface GcpSecretsAdapterOptions {
  readonly projectId?: string;
  readonly version?: string;
}

function isGcpNotFound(failure: unknown): boolean {
  return hasFailureField(failure, "code", 5);
}

function resolveGcpSecrets<const Keys extends string>(
  options: GcpSecretsAdapterOptions & {
    readonly secrets: Readonly<Record<Keys, string>>;
  },
): Effect.Effect<ResolverResult<Keys>, ResolverError> {
  return Effect.gen(function* () {
    const requested = resolverEntries(options.secrets);
    const usesShortName = requested.some(([, secretName]) => !secretName.startsWith("projects/"));
    if (usesShortName && options.projectId === undefined) {
      return yield* new ResolverConfigurationError({
        adapter: "gcp",
        operation: "configure",
        message: "projectId is required when GCP secret names are not fully qualified",
      });
    }

    const client = yield* initializeAdapter("gcp", async () => {
      const sdk = await import("@google-cloud/secret-manager");
      return new sdk.SecretManagerServiceClient();
    });
    const version = options.version ?? "latest";
    const entries = yield* Effect.forEach(
      requested,
      ([key, secretName]) => {
        const name = secretName.startsWith("projects/")
          ? secretName
          : `projects/${options.projectId}/secrets/${secretName}/versions/${version}`;

        return requestSecret(
          "gcp",
          "read",
          async () => {
            const [response] = await client.accessSecretVersion({ name });
            const data = response.payload?.data;
            if (data === null || data === undefined) {
              return undefined;
            }
            return typeof data === "string" ? data : new TextDecoder().decode(data);
          },
          isGcpNotFound,
        ).pipe(Effect.map((value) => [key, value] as const));
      },
      { concurrency: "unbounded" },
    );

    return resolverRecord(entries);
  });
}

/** Resolver adapter for GCP Secret Manager. */
export const gcpSecretsAdapter: ResolverAdapter<
  "gcp",
  string,
  GcpSecretsAdapterOptions,
  ResolverError,
  never
> = {
  name: "gcp",
  resolve: resolveGcpSecrets,
};
