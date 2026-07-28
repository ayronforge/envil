import { describe, expect, mock, test } from "bun:test";

import type {
  BatchGetSecretValueResponse,
  GetSecretValueResponse,
} from "@aws-sdk/client-secrets-manager";
import { Effect, Option, Redacted } from "effect";

import { awsSecretsAdapter } from "./aws.ts";

let sendAwsCommand: (command: unknown) => Promise<unknown>;

mock.module("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send(command: unknown) {
      return sendAwsCommand(command);
    }
  },
  GetSecretValueCommand: class {
    constructor(readonly input: { readonly SecretId: string }) {}
  },
  BatchGetSecretValueCommand: class {
    constructor(readonly input: { readonly SecretIdList: readonly string[] }) {}
  },
}));

describe("awsSecretsAdapter", () => {
  test("maps the SDK not-found signal to Option.none", async () => {
    sendAwsCommand = () => Promise.reject({ name: "ResourceNotFoundException" });

    const result = await Effect.runPromise(
      awsSecretsAdapter.resolve({ secrets: { TOKEN: "missing-secret" } }),
    );

    expect(Option.isNone(result.TOKEN)).toBe(true);
  });

  test("keeps operational failures in the typed error channel", async () => {
    sendAwsCommand = () => Promise.reject(new Error("private provider response"));

    const exit = await Effect.runPromiseExit(
      awsSecretsAdapter.resolve({ secrets: { TOKEN: "private-reference" } }),
    );

    expect(String(exit)).toContain("ResolverRequestFailed");
    expect(String(exit)).not.toContain("private provider response");
    expect(String(exit)).not.toContain("private-reference");
  });

  test("decodes a JSON fragment without retaining the provider response", async () => {
    sendAwsCommand = () =>
      Promise.resolve({
        SecretString: JSON.stringify({ password: "resolved-value" }),
      } satisfies GetSecretValueResponse);

    const result = await Effect.runPromise(
      awsSecretsAdapter.resolve({
        secrets: { TOKEN: "database#password" },
      }),
    );

    expect(Option.isSome(result.TOKEN)).toBe(true);
    if (Option.isSome(result.TOKEN)) {
      expect(Redacted.value(result.TOKEN.value)).toBe("resolved-value");
    }
  });

  test("sanitizes malformed JSON fragments", async () => {
    sendAwsCommand = () =>
      Promise.resolve({
        SecretString: "{private-invalid-json",
      } satisfies GetSecretValueResponse);

    const exit = await Effect.runPromiseExit(
      awsSecretsAdapter.resolve({
        secrets: { TOKEN: "private-reference#password" },
      }),
    );

    expect(String(exit)).toContain("ResolverResponseDecodeFailed");
    expect(String(exit)).not.toContain("{private-invalid-json");
    expect(String(exit)).not.toContain("private-reference");
  });

  test("fails closed when a batch response is incomplete", async () => {
    sendAwsCommand = () =>
      Promise.resolve({
        SecretValues: [{ Name: "first", SecretString: "resolved" }],
      } satisfies BatchGetSecretValueResponse);

    const exit = await Effect.runPromiseExit(
      awsSecretsAdapter.resolve({
        secrets: {
          FIRST: "first",
          SECOND: "second",
        },
      }),
    );

    expect(String(exit)).toContain("ResolverRequestFailed");
    expect(String(exit)).not.toContain("first");
    expect(String(exit)).not.toContain("second");
  });

  test("correlates batch responses requested with complete ARNs", async () => {
    const firstArn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:first-abc";
    const secondArn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:second-def";
    sendAwsCommand = () =>
      Promise.resolve({
        SecretValues: [
          { ARN: firstArn, Name: "first", SecretString: "first-value" },
          { ARN: secondArn, Name: "second", SecretString: "second-value" },
        ],
      } satisfies BatchGetSecretValueResponse);

    const result = await Effect.runPromise(
      awsSecretsAdapter.resolve({
        secrets: {
          FIRST: firstArn,
          SECOND: secondArn,
        },
      }),
    );

    expect(Option.isSome(result.FIRST)).toBe(true);
    expect(Option.isSome(result.SECOND)).toBe(true);
    if (Option.isSome(result.FIRST) && Option.isSome(result.SECOND)) {
      expect(Redacted.value(result.FIRST.value)).toBe("first-value");
      expect(Redacted.value(result.SECOND.value)).toBe("second-value");
    }
  });
});
