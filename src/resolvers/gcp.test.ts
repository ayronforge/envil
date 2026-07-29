import { describe, expect, mock, test } from "bun:test";

import type { protos } from "@google-cloud/secret-manager";
import { Effect, Option, Redacted } from "effect";

import { gcpSecretsAdapter } from "./gcp.ts";

let accessGcpSecret: (
  request: Readonly<{ name: string }>,
) => Promise<readonly [protos.google.cloud.secretmanager.v1.IAccessSecretVersionResponse]>;

mock.module("@google-cloud/secret-manager", () => ({
  SecretManagerServiceClient: class {
    accessSecretVersion(request: Readonly<{ name: string }>) {
      return accessGcpSecret(request);
    }
  },
}));

describe("gcpSecretsAdapter", () => {
  test("fails configuration before initializing the SDK", async () => {
    const exit = await Effect.runPromiseExit(
      gcpSecretsAdapter.resolve({
        referencesByKey: { TOKEN: "short-name" },
      }),
    );

    expect(exit._tag).toBe("Failure");
    expect(String(exit)).toContain("ResolverConfigurationError");
    expect(String(exit)).toContain('Set "projectId"');
    expect(String(exit)).not.toContain("short-name");
  });

  test("maps the SDK not-found code to Option.none", async () => {
    accessGcpSecret = () => Promise.reject({ code: 5 });

    const result = await Effect.runPromise(
      gcpSecretsAdapter.resolve({
        referencesByKey: { TOKEN: "projects/project/secrets/token/versions/latest" },
      }),
    );

    expect(Option.isNone(result.TOKEN)).toBe(true);
  });

  test("decodes the SDK payload bytes", async () => {
    accessGcpSecret = () =>
      Promise.resolve([
        {
          payload: { data: new TextEncoder().encode("resolved-value") },
        },
      ]);

    const result = await Effect.runPromise(
      gcpSecretsAdapter.resolve({
        referencesByKey: { TOKEN: "projects/project/secrets/token/versions/latest" },
      }),
    );

    expect(Option.isSome(result.TOKEN)).toBe(true);
    if (Option.isSome(result.TOKEN)) {
      expect(Redacted.value(result.TOKEN.value)).toBe("resolved-value");
    }
  });

  test("sanitizes operational SDK failures", async () => {
    accessGcpSecret = () => Promise.reject(new Error("private provider response"));

    const exit = await Effect.runPromiseExit(
      gcpSecretsAdapter.resolve({
        referencesByKey: { TOKEN: "projects/private/secrets/token/versions/latest" },
      }),
    );

    expect(String(exit)).toContain("ResolverRequestFailed");
    expect(String(exit)).not.toContain("private provider response");
    expect(String(exit)).not.toContain("projects/private");
  });
});
