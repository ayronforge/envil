import { beforeEach, describe, expect, mock, test } from "bun:test";

import { Effect } from "effect";

const secretStore = new Map<string, string>();

mock.module("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send(command: any) {
      if (command._isBatch) {
        const ids: string[] = command.input.SecretIdList;
        const values = ids
          .filter((id) => secretStore.has(id))
          .map((id) => ({ Name: id, SecretString: secretStore.get(id) }));
        return Promise.resolve({ SecretValues: values });
      }
      const id: string = command.input.SecretId;
      if (!secretStore.has(id)) {
        return Promise.reject(new Error("Secret not found"));
      }
      return Promise.resolve({ SecretString: secretStore.get(id) });
    }
  },
  GetSecretValueCommand: class {
    _isBatch = false;
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
  BatchGetSecretValueCommand: class {
    _isBatch = true;
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
}));

const { fromAwsSecrets } = await import("./aws.ts");

describe("fromAwsSecrets", () => {
  beforeEach(() => {
    secretStore.clear();
  });

  test("resolves a single secret", async () => {
    secretStore.set("my-secret", "secret-value");

    const result = await Effect.runPromise(
      fromAwsSecrets({ secrets: { DB_PASSWORD: "my-secret" } }),
    );

    expect(result.DB_PASSWORD).toBe("secret-value");
  });

  test("resolves multiple secrets via batch", async () => {
    secretStore.set("secret-a", "value-a");
    secretStore.set("secret-b", "value-b");

    const result = await Effect.runPromise(
      fromAwsSecrets({ secrets: { A: "secret-a", B: "secret-b" } }),
    );

    expect(result.A).toBe("value-a");
    expect(result.B).toBe("value-b");
  });

  test("extracts JSON key with # syntax", async () => {
    secretStore.set("my-json-secret", JSON.stringify({ username: "admin", password: "s3cret" }));

    const result = await Effect.runPromise(
      fromAwsSecrets({
        secrets: { DB_USER: "my-json-secret#username", DB_PASS: "my-json-secret#password" },
      }),
    );

    expect(result.DB_USER).toBe("admin");
    expect(result.DB_PASS).toBe("s3cret");
  });

  test("returns undefined for missing secrets (single)", async () => {
    const result = await Effect.runPromise(
      fromAwsSecrets({ secrets: { MISSING: "nonexistent" } }),
    );

    expect(result.MISSING).toBeUndefined();
  });

  test("returns undefined for missing secrets (batch)", async () => {
    secretStore.set("secret-a", "value-a");

    const result = await Effect.runPromise(
      fromAwsSecrets({ secrets: { A: "secret-a", B: "secret-b" } }),
    );

    expect(result.A).toBe("value-a");
    expect(result.B).toBeUndefined();
  });

  test("returns undefined for missing JSON key", async () => {
    secretStore.set("my-secret", JSON.stringify({ username: "admin" }));

    const result = await Effect.runPromise(
      fromAwsSecrets({ secrets: { MISSING_KEY: "my-secret#nonexistent" } }),
    );

    expect(result.MISSING_KEY).toBeUndefined();
  });

  test("returns undefined for invalid JSON when using # syntax", async () => {
    secretStore.set("my-secret", "not-json");

    const result = await Effect.runPromise(
      fromAwsSecrets({ secrets: { BAD_JSON: "my-secret#key" } }),
    );

    expect(result.BAD_JSON).toBeUndefined();
  });
});
