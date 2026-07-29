import { describe, expect, test } from "bun:test";

import { transformSync } from "@babel/core";

import envilExpoPlugin from "./expo.ts";

describe("Envil Expo Babel plugin", () => {
  test("compiles and inlines Expo runtime references through Babel", () => {
    const source = `
import { client, requiredString } from "@ayronforge/envil";
import { expo } from "@ayronforge/envil/presets";
client({ APP_URL: requiredString }, expo);
`;
    const previousValue = process.env.EXPO_PUBLIC_APP_URL;
    process.env.EXPO_PUBLIC_APP_URL = "https://example.com";

    try {
      const result = transformSync(source, {
        caller: {
          name: "metro",
          bundler: "metro",
          platform: "ios",
          isDev: false,
          isServer: false,
        },
        filename: "src/env.ts",
        plugins: [envilExpoPlugin],
        presets: ["babel-preset-expo"],
      });

      expect(result?.code).toContain('"EXPO_PUBLIC_APP_URL":"https://example.com"');
      expect(result?.code).not.toContain("process.env.EXPO_PUBLIC_APP_URL");
    } finally {
      if (previousValue === undefined) {
        delete process.env.EXPO_PUBLIC_APP_URL;
      } else {
        process.env.EXPO_PUBLIC_APP_URL = previousValue;
      }
    }
  });
});
