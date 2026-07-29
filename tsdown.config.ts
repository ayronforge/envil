import { defineConfig } from "tsdown";

export default defineConfig({
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
  },
  clean: true,
  deps: {
    neverBundle: true,
    dts: {
      neverBundle: true,
    },
  },
  dts: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
  target: "es2022",
  tsconfig: "tsconfig.build.json",
});
