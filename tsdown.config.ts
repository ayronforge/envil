import { defineConfig } from "tsdown";

const shared = {
  deps: {
    neverBundle: true,
    dts: {
      neverBundle: true,
    },
  },
  platform: "neutral" as const,
  sourcemap: true,
  target: "es2022",
  tsconfig: "tsconfig.build.json",
};

export default defineConfig([
  {
    ...shared,
    name: "envil-esm",
    entry: {
      index: "src/index.ts",
      cli: "src/cli.ts",
      presets: "src/presets.ts",
      "resolvers/aws": "src/resolvers/aws.ts",
      "resolvers/azure": "src/resolvers/azure.ts",
      "resolvers/gcp": "src/resolvers/gcp.ts",
      "resolvers/onepassword": "src/resolvers/onepassword.ts",
      "plugins/vite": "src/plugins/vite.ts",
      "plugins/rollup": "src/plugins/rollup.ts",
      "plugins/rolldown": "src/plugins/rolldown.ts",
      "plugins/webpack": "src/plugins/webpack.ts",
      "plugins/rspack": "src/plugins/rspack.ts",
      "plugins/esbuild": "src/plugins/esbuild.ts",
      "plugins/expo": "src/plugins/expo.ts",
    },
    clean: true,
    dts: true,
    format: "esm",
  },
  {
    ...shared,
    name: "envil-expo-cjs",
    entry: {
      "plugins/expo": "src/plugins/expo.ts",
    },
    clean: true,
    dts: false,
    format: "cjs",
    outDir: "dist-cjs",
  },
]);
