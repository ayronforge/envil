import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { client, createEnv } from "./env.ts";
import { astro, expo, sveltekit, vite } from "./presets.ts";
import { requiredString } from "./schemas.ts";

const presetCases = [
  ["vite", vite, "VITE_"],
  ["expo", expo, "EXPO_PUBLIC_"],
  ["sveltekit", sveltekit, "PUBLIC_"],
  ["astro", astro, "PUBLIC_"],
] as const;

describe("framework presets", () => {
  for (const [name, preset, prefix] of presetCases) {
    test(`${name} provides its client fragment prefix`, () => {
      expect(preset.prefix).toBe(prefix);
    });

    test(`${name} works as client options`, () => {
      const appEnv = createEnv(
        client(
          { API_URL: requiredString },
          {
            ...preset,
            runtimeEnv: { [`${prefix}API_URL`]: "https://api.example.com" },
          },
        ),
      );

      expect(Effect.runSync(appEnv.client).API_URL).toBe("https://api.example.com");
    });
  }

  test("fails clearly when the Expo preset was not compiled", () => {
    const appEnv = createEnv(client({ API_URL: requiredString }, expo));

    expect(() => Effect.runSync(appEnv.client)).toThrow(
      'The Expo client variable "API_URL" was not compiled.',
    );
  });
});
