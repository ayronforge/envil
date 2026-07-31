import { Effect, Option, Redacted } from "effect";

import {
  ResolverRequestFailed,
  ResolverResponseDecodeFailed,
  type ResolverAdapter,
  type ResolverError,
  type ResolverResult,
  type ResolvedSecret,
} from "./types.ts";
import {
  hasFailureField,
  initializeAdapter,
  resolverEntries,
  resolverRecord,
  toResolvedSecret,
} from "./utils.ts";

/** AWS Secrets Manager adapter options. */
export interface AwsSecretsAdapterOptions {
  readonly region?: string;
}

interface ParsedAwsReference {
  readonly secretId: string;
  readonly jsonKey?: string;
}

function parseReference(reference: string): ParsedAwsReference {
  const hashIndex = reference.indexOf("#");
  if (hashIndex < 0) {
    return { secretId: reference };
  }

  return {
    secretId: reference.slice(0, hashIndex),
    jsonKey: reference.slice(hashIndex + 1),
  };
}

function isAwsNotFound(failure: unknown): boolean {
  return hasFailureField(failure, "name", "ResourceNotFoundException");
}

function decodeAwsSecretValue(
  secretString: string | undefined,
  secretBinary: Uint8Array | undefined,
  operation: string,
): Effect.Effect<ResolvedSecret, ResolverResponseDecodeFailed> {
  if (secretString !== undefined) {
    return Effect.succeed(toResolvedSecret(secretString));
  }

  return Effect.fail(
    new ResolverResponseDecodeFailed({
      adapter: "aws",
      operation,
      message:
        secretBinary === undefined
          ? "AWS returned a secret without a string value. Store the secret as SecretString and try again."
          : "AWS binary secrets are not supported. Store the secret as SecretString and try again.",
    }),
  );
}

function decodeAwsValue(
  value: ResolvedSecret,
  jsonKey: string | undefined,
): Effect.Effect<ResolvedSecret, ResolverResponseDecodeFailed> {
  if (jsonKey === undefined || Option.isNone(value)) {
    return Effect.succeed(value);
  }

  return Effect.try({
    try: () => {
      const decoded: unknown = JSON.parse(Redacted.value(value.value));
      if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
        return Option.none();
      }
      if (!Object.hasOwn(decoded, jsonKey)) {
        return Option.none();
      }
      const fragment: unknown = Reflect.get(decoded, jsonKey);
      return fragment === undefined ? Option.none() : toResolvedSecret(String(fragment));
    },
    catch: () =>
      new ResolverResponseDecodeFailed({
        adapter: "aws",
        operation: "decode-json",
        message:
          "AWS returned a secret that could not be read as JSON. Check the secret contents and configured JSON field.",
      }),
  });
}

async function createAwsClient(region: string | undefined) {
  const sdk = await import("@aws-sdk/client-secrets-manager");
  return {
    sdk,
    client: new sdk.SecretsManagerClient(region === undefined ? {} : { region }),
  };
}

function resolveAwsSecrets<const Keys extends string>(
  options: AwsSecretsAdapterOptions & {
    readonly referencesByKey: Readonly<Record<Keys, string>>;
  },
): Effect.Effect<ResolverResult<Keys>, ResolverError> {
  return Effect.gen(function* () {
    const { sdk, client } = yield* initializeAdapter("aws", () => createAwsClient(options.region));
    const requested = resolverEntries(options.referencesByKey);
    const parsed = requested.map(([key, reference]) => [key, parseReference(reference)] as const);
    const uniqueSecretIds = [...new Set(parsed.map(([, reference]) => reference.secretId))];
    const values = new Map<string, ResolvedSecret>();

    if (uniqueSecretIds.length === 1) {
      const secretId = uniqueSecretIds[0];
      if (secretId !== undefined) {
        const value = yield* Effect.tryPromise({
          try: () => client.send(new sdk.GetSecretValueCommand({ SecretId: secretId })),
          catch: (failure: unknown) => failure,
        }).pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              isAwsNotFound(failure)
                ? Effect.succeed(Option.none())
                : Effect.fail(
                    new ResolverRequestFailed({
                      adapter: "aws",
                      operation: "read",
                      message:
                        "The aws resolver could not read a secret. Check provider access and try again.",
                    }),
                  ),
            onSuccess: (response) =>
              decodeAwsSecretValue(response.SecretString, response.SecretBinary, "decode-value"),
          }),
        );
        values.set(secretId, value);
      }
    } else {
      for (let offset = 0; offset < uniqueSecretIds.length; offset += 20) {
        const batch = uniqueSecretIds.slice(offset, offset + 20);
        const response = yield* Effect.tryPromise({
          try: () => client.send(new sdk.BatchGetSecretValueCommand({ SecretIdList: batch })),
          catch: () =>
            new ResolverRequestFailed({
              adapter: "aws",
              operation: "read-batch",
              message:
                "AWS could not read the requested secrets. Check Secrets Manager permissions and try again.",
            }),
        });

        const batchFailures = response.Errors ?? [];
        const unknownFailure = batchFailures.some(
          (failure) => failure.ErrorCode !== "ResourceNotFoundException",
        );
        if (unknownFailure) {
          return yield* new ResolverRequestFailed({
            adapter: "aws",
            operation: "read-batch",
            message:
              "AWS could not read every requested secret. Check that each secret exists and the current credentials can access it.",
          });
        }

        for (const failure of batchFailures) {
          if (failure.SecretId !== undefined) {
            values.set(failure.SecretId, Option.none());
          }
        }
        for (const secret of response.SecretValues ?? []) {
          const value = yield* decodeAwsSecretValue(
            secret.SecretString,
            secret.SecretBinary,
            "decode-batch-value",
          );
          if (secret.Name !== undefined) {
            values.set(secret.Name, value);
          }
          if (secret.ARN !== undefined) {
            values.set(secret.ARN, value);
          }
        }
        for (const secretId of batch) {
          if (!values.has(secretId)) {
            return yield* new ResolverRequestFailed({
              adapter: "aws",
              operation: "read-batch",
              message:
                "AWS did not return every requested secret. Check that each secret exists and try again.",
            });
          }
        }
      }
    }

    const entries: Array<readonly [Keys, ResolvedSecret]> = [];
    for (const [key, reference] of parsed) {
      const value = values.get(reference.secretId) ?? Option.none();
      entries.push([key, yield* decodeAwsValue(value, reference.jsonKey)]);
    }

    return resolverRecord(entries);
  });
}

/** Resolver adapter for AWS Secrets Manager. */
export const awsSecretsAdapter: ResolverAdapter<
  "aws",
  string,
  AwsSecretsAdapterOptions,
  ResolverError,
  never
> = {
  name: "aws",
  resolve: resolveAwsSecrets,
};
