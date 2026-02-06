import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { fromAwsSecrets } from "./aws.ts";

function mockClient(secrets: Record<string, string | undefined>) {
  return {
    getSecret: async (secretId: string) => {
      const value = secrets[secretId];
      if (value === undefined) throw new Error("Secret not found");
      return value;
    },
    batchGetSecrets: async (secretIds: string[]) => {
      const result = new Map<string, string | undefined>();
      for (const id of secretIds) {
        result.set(id, secrets[id]);
      }
      return result;
    },
  };
}

describe("fromAwsSecrets", () => {
  test("resolves a single secret", async () => {
    const client = mockClient({ "my-secret": "secret-value" });

    const result = await Effect.runPromise(
      fromAwsSecrets({ secrets: { DB_PASSWORD: "my-secret" }, client }),
    );

    expect(result.DB_PASSWORD).toBe("secret-value");
  });

  test("resolves multiple secrets via batch", async () => {
    const client = mockClient({
      "secret-a": "value-a",
      "secret-b": "value-b",
    });

    const result = await Effect.runPromise(
      fromAwsSecrets({ secrets: { A: "secret-a", B: "secret-b" }, client }),
    );

    expect(result.A).toBe("value-a");
    expect(result.B).toBe("value-b");
  });

  test("extracts JSON key with # syntax", async () => {
    const client = mockClient({
      "my-json-secret": JSON.stringify({ username: "admin", password: "s3cret" }),
    });

    const result = await Effect.runPromise(
      fromAwsSecrets({
        secrets: { DB_USER: "my-json-secret#username", DB_PASS: "my-json-secret#password" },
        client,
      }),
    );

    expect(result.DB_USER).toBe("admin");
    expect(result.DB_PASS).toBe("s3cret");
  });

  test("returns undefined for missing secrets (single)", async () => {
    const client = mockClient({});

    const result = await Effect.runPromise(
      fromAwsSecrets({ secrets: { MISSING: "nonexistent" }, client }),
    );

    expect(result.MISSING).toBeUndefined();
  });

  test("returns undefined for missing secrets (batch)", async () => {
    const client = mockClient({ "secret-a": "value-a" });

    const result = await Effect.runPromise(
      fromAwsSecrets({ secrets: { A: "secret-a", B: "secret-b" }, client }),
    );

    expect(result.A).toBe("value-a");
    expect(result.B).toBeUndefined();
  });

  test("returns undefined for missing JSON key", async () => {
    const client = mockClient({
      "my-secret": JSON.stringify({ username: "admin" }),
    });

    const result = await Effect.runPromise(
      fromAwsSecrets({ secrets: { MISSING_KEY: "my-secret#nonexistent" }, client }),
    );

    expect(result.MISSING_KEY).toBeUndefined();
  });

  test("returns undefined for invalid JSON when using # syntax", async () => {
    const client = mockClient({ "my-secret": "not-json" });

    const result = await Effect.runPromise(
      fromAwsSecrets({ secrets: { BAD_JSON: "my-secret#key" }, client }),
    );

    expect(result.BAD_JSON).toBeUndefined();
  });
});
