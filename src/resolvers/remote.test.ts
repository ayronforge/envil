import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { fromRemoteSecrets } from "./remote.ts";

describe("fromRemoteSecrets", () => {
  test("resolves a single secret (non-batch client)", async () => {
    const client = {
      getSecret: async (id: string) => {
        if (id === "my-secret") return "secret-value";
        return undefined;
      },
    };

    const result = await Effect.runPromise(
      fromRemoteSecrets({ secrets: { DB_PASSWORD: "my-secret" }, client }),
    );

    expect(result.DB_PASSWORD).toBe("secret-value");
  });

  test("resolves multiple secrets via batch (getSecrets present)", async () => {
    const client = {
      getSecret: async (_id: string) => {
        throw new Error("should not be called");
      },
      getSecrets: async (ids: string[]) => {
        const map = new Map<string, string | undefined>();
        const store: Record<string, string> = {
          "secret-a": "value-a",
          "secret-b": "value-b",
        };
        for (const id of ids) {
          map.set(id, store[id]);
        }
        return map;
      },
    };

    const result = await Effect.runPromise(
      fromRemoteSecrets({ secrets: { A: "secret-a", B: "secret-b" }, client }),
    );

    expect(result.A).toBe("value-a");
    expect(result.B).toBe("value-b");
  });

  test("falls back to concurrent getSecret when getSecrets absent", async () => {
    const calls: string[] = [];
    const client = {
      getSecret: async (id: string) => {
        calls.push(id);
        const store: Record<string, string> = {
          "secret-a": "value-a",
          "secret-b": "value-b",
        };
        return store[id];
      },
    };

    const result = await Effect.runPromise(
      fromRemoteSecrets({ secrets: { A: "secret-a", B: "secret-b" }, client }),
    );

    expect(result.A).toBe("value-a");
    expect(result.B).toBe("value-b");
    expect(calls).toContain("secret-a");
    expect(calls).toContain("secret-b");
  });

  test("returns undefined for missing secrets", async () => {
    const client = {
      getSecret: async (id: string) => {
        if (id === "exists") return "value";
        return undefined;
      },
    };

    const result = await Effect.runPromise(
      fromRemoteSecrets({
        secrets: { EXISTING: "exists", MISSING: "nonexistent" },
        client,
      }),
    );

    expect(result.EXISTING).toBe("value");
    expect(result.MISSING).toBeUndefined();
  });

  test("handles fetch errors gracefully (returns undefined)", async () => {
    const client = {
      getSecret: async (_id: string): Promise<string | undefined> => {
        throw new Error("Network error");
      },
    };

    const result = await Effect.runPromise(
      fromRemoteSecrets({ secrets: { A: "secret-a" }, client }),
    );

    expect(result.A).toBeUndefined();
  });
});
