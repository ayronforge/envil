import { describe, expect, test } from "bun:test";

import { createEnv } from "./env.ts";
import { astro, expo, nextjs, nuxt, sveltekit, vite } from "./presets.ts";
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

  test("nuxt preset has correct client prefix", () => {
    expect(nuxt.prefix).toEqual({ client: "NUXT_PUBLIC_" });
  });

  test("sveltekit preset has correct client prefix", () => {
    expect(sveltekit.prefix).toEqual({ client: "PUBLIC_" });
  });

  test("astro preset has correct client prefix", () => {
    expect(astro.prefix).toEqual({ client: "PUBLIC_" });
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

  test("nuxt preset works with createEnv", () => {
    const env = createEnv({
      ...nuxt,
      client: { API_URL: requiredString },
      runtimeEnv: { NUXT_PUBLIC_API_URL: "http://api" },
      isServer: true,
    });
    expect(env.API_URL).toBe("http://api");
  });

  test("sveltekit preset works with createEnv", () => {
    const env = createEnv({
      ...sveltekit,
      client: { API_URL: requiredString },
      runtimeEnv: { PUBLIC_API_URL: "http://api" },
      isServer: true,
    });
    expect(env.API_URL).toBe("http://api");
  });

  test("astro preset works with createEnv", () => {
    const env = createEnv({
      ...astro,
      client: { API_URL: requiredString },
      runtimeEnv: { PUBLIC_API_URL: "http://api" },
      isServer: true,
    });
    expect(env.API_URL).toBe("http://api");
  });
});
