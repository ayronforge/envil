import { describe, expect, test } from "bun:test";

import { createEnv } from "./env.ts";
import { expo, nextjs, vite } from "./presets.ts";
import { requiredString } from "./schemas.ts";

describe("presets", () => {
  test("nextjs preset has correct client prefix", () => {
    expect(nextjs.prefix).toEqual({ client: "NEXT_PUBLIC_" });
  });

  test("vite preset has correct client prefix", () => {
    expect(vite.prefix).toEqual({ client: "VITE_" });
  });

  test("expo preset has correct client prefix", () => {
    expect(expo.prefix).toEqual({ client: "EXPO_PUBLIC_" });
  });

  test("nextjs preset works with createEnv", () => {
    const env = createEnv({
      ...nextjs,
      server: { DATABASE_URL: requiredString },
      client: { API_URL: requiredString },
      runtimeEnv: { DATABASE_URL: "postgres://localhost", NEXT_PUBLIC_API_URL: "http://api" },
      isServer: true,
    });
    expect(env.DATABASE_URL).toBe("postgres://localhost");
    expect(env.API_URL).toBe("http://api");
  });

  test("vite preset works with createEnv", () => {
    const env = createEnv({
      ...vite,
      client: { API_URL: requiredString },
      runtimeEnv: { VITE_API_URL: "http://api" },
      isServer: true,
    });
    expect(env.API_URL).toBe("http://api");
  });

  test("expo preset works with createEnv", () => {
    const env = createEnv({
      ...expo,
      client: { API_URL: requiredString },
      runtimeEnv: { EXPO_PUBLIC_API_URL: "http://api" },
      isServer: true,
    });
    expect(env.API_URL).toBe("http://api");
  });
});
