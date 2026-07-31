import { createRequire } from "node:module";

const packageEntry = await import("../dist/index.js");
if (typeof packageEntry.createEnv !== "function") {
  throw new Error("The built package entry does not export createEnv.");
}

const packageEntrySource = await Bun.file("dist/index.js").text();
if (!packageEntrySource.includes("__ENVIL_RUNTIME_TARGET__")) {
  throw new Error("The built package cannot receive Envil's runtime proof.");
}

const require = createRequire(import.meta.url);
const expoPlugin: unknown = require("../dist-cjs/plugins/expo.cjs");
if (typeof expoPlugin !== "function") {
  throw new Error("The built Expo Babel plugin is not CommonJS-compatible.");
}
