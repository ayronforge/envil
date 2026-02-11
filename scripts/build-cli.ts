const buildConfig: Bun.BuildConfig = {
  entrypoints: [
    "src/index.ts",
    //"src/cli.ts",
    "src/presets.ts",
    "src/resolvers/aws.ts",
    "src/resolvers/azure.ts",
    "src/resolvers/gcp.ts",
    "src/resolvers/onepassword.ts",
  ],
  outdir: "dist",
  format: "esm",
  packages: "external",
  sourcemap: "linked",
};

const result = await Bun.build(buildConfig);

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

export {};
