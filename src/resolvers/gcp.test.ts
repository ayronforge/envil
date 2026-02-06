import { beforeEach, describe, expect, mock, test } from "bun:test";

import { Effect } from "effect";

const secretStore = new Map<string, string>();

mock.module("@google-cloud/secret-manager", () => ({
  SecretManagerServiceClient: class {
    accessSecretVersion({ name }: { name: string }) {
      // Extract secret name from the full resource path
      const parts = name.split("/");
      const secretName = parts.length >= 4 ? parts[3] : name;
      const value = secretStore.get(secretName!);
      if (value === undefined) return Promise.reject(new Error(`Secret "${name}" not found`));
      return Promise.resolve([
        { payload: { data: new TextEncoder().encode(value) } },
      ]);
    }
  },
}));

const { fromGcpSecrets } = await import("./gcp.ts");

describe("fromGcpSecrets", () => {
  beforeEach(() => {
    secretStore.clear();
  });

  test("resolves secrets using short names", async () => {
    secretStore.set("my-secret", "secret-value");

    const result = await Effect.runPromise(
      fromGcpSecrets({ secrets: { DB_PASSWORD: "my-secret" }, projectId: "my-project" }),
    );

    expect(result.DB_PASSWORD).toBe("secret-value");
  });

  test("resolves secrets using full resource path", async () => {
    secretStore.set("my-secret", "secret-value");

    const result = await Effect.runPromise(
      fromGcpSecrets({
        secrets: { DB_PASSWORD: "projects/my-project/secrets/my-secret/versions/latest" },
      }),
    );

    expect(result.DB_PASSWORD).toBe("secret-value");
  });

  test("resolves multiple secrets concurrently", async () => {
    secretStore.set("secret-a", "value-a");
    secretStore.set("secret-b", "value-b");

    const result = await Effect.runPromise(
      fromGcpSecrets({
        secrets: { A: "secret-a", B: "secret-b" },
        projectId: "my-project",
      }),
    );

    expect(result.A).toBe("value-a");
    expect(result.B).toBe("value-b");
  });

  test("returns undefined for missing secrets", async () => {
    secretStore.set("existing", "value");

    const result = await Effect.runPromise(
      fromGcpSecrets({
        secrets: { EXISTING: "existing", MISSING: "nonexistent" },
        projectId: "my-project",
      }),
    );

    expect(result.EXISTING).toBe("value");
    expect(result.MISSING).toBeUndefined();
  });

  test("handles string data directly", async () => {
    secretStore.set("my-secret", "plain-string-value");

    const result = await Effect.runPromise(
      fromGcpSecrets({ secrets: { SECRET: "my-secret" }, projectId: "my-project" }),
    );

    expect(result.SECRET).toBe("plain-string-value");
  });
});
