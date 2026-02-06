import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { fromGcpSecrets } from "./gcp.ts";

function mockClient(secrets: Record<string, string | undefined>) {
  return {
    accessSecretVersion: async (request: { name: string }) => {
      // Extract the secret name from the full path
      const parts = request.name.split("/");
      // Full path: projects/{project}/secrets/{name}/versions/{version}
      const secretName = parts.length >= 4 ? parts[3] : request.name;
      const value = secrets[secretName!];
      if (value === undefined) throw new Error(`Secret "${request.name}" not found`);
      return { payload: { data: new TextEncoder().encode(value) as Uint8Array | string } };
    },
  };
}

describe("fromGcpSecrets", () => {
  test("resolves secrets using short names", async () => {
    const client = mockClient({ "my-secret": "secret-value" });

    const result = await Effect.runPromise(
      fromGcpSecrets({ secrets: { DB_PASSWORD: "my-secret" }, client, projectId: "my-project" }),
    );

    expect(result.DB_PASSWORD).toBe("secret-value");
  });

  test("resolves secrets using full resource path", async () => {
    const client = {
      accessSecretVersion: async (request: { name: string }) => {
        if (request.name === "projects/my-project/secrets/my-secret/versions/latest") {
          return {
            payload: { data: new TextEncoder().encode("secret-value") as Uint8Array | string },
          };
        }
        throw new Error("Not found");
      },
    };

    const result = await Effect.runPromise(
      fromGcpSecrets({
        secrets: { DB_PASSWORD: "projects/my-project/secrets/my-secret/versions/latest" },
        client,
      }),
    );

    expect(result.DB_PASSWORD).toBe("secret-value");
  });

  test("resolves multiple secrets concurrently", async () => {
    const client = mockClient({
      "secret-a": "value-a",
      "secret-b": "value-b",
    });

    const result = await Effect.runPromise(
      fromGcpSecrets({
        secrets: { A: "secret-a", B: "secret-b" },
        client,
        projectId: "my-project",
      }),
    );

    expect(result.A).toBe("value-a");
    expect(result.B).toBe("value-b");
  });

  test("returns undefined for missing secrets", async () => {
    const client = mockClient({ existing: "value" });

    const result = await Effect.runPromise(
      fromGcpSecrets({
        secrets: { EXISTING: "existing", MISSING: "nonexistent" },
        client,
        projectId: "my-project",
      }),
    );

    expect(result.EXISTING).toBe("value");
    expect(result.MISSING).toBeUndefined();
  });

  test("handles string data (not Uint8Array)", async () => {
    const client = {
      accessSecretVersion: async (_request: { name: string }) => ({
        payload: { data: "plain-string-value" as Uint8Array | string },
      }),
    };

    const result = await Effect.runPromise(
      fromGcpSecrets({ secrets: { SECRET: "my-secret" }, client, projectId: "my-project" }),
    );

    expect(result.SECRET).toBe("plain-string-value");
  });
});
