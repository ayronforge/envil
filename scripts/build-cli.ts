import { build } from "esbuild";

await build({
  entryPoints: [
    "src/index.ts",
    "src/cli.ts",
    "src/presets.ts",
    "src/resolvers/aws.ts",
    "src/resolvers/azure.ts",
    "src/resolvers/gcp.ts",
    "src/resolvers/onepassword.ts",
    "src/plugins/vite.ts",
    "src/plugins/rollup.ts",
    "src/plugins/rolldown.ts",
    "src/plugins/webpack.ts",
    "src/plugins/rspack.ts",
    "src/plugins/esbuild.ts",
  ],
  outdir: "dist",
  outbase: "src",
  bundle: true,
  format: "esm",
  packages: "external",
  platform: "neutral",
  sourcemap: true,
});

const packageEntry = await import("../dist/index.js");
if (typeof packageEntry.createEnv !== "function") {
  throw new Error("The built package entry does not export createEnv.");
}

const packageEntrySource = await Bun.file("dist/index.js").text();
if (!packageEntrySource.includes("__ENVIL_RUNTIME_TARGET__")) {
  throw new Error("The built package entry cannot receive Envil's runtime proof.");
}
