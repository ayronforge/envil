const packageEntry = await import("../dist/index.js");
if (typeof packageEntry.createEnv !== "function") {
  throw new Error("The built package entry does not export createEnv.");
}

const packageEntrySource = await Bun.file("dist/index.js").text();
if (!packageEntrySource.includes("__ENVIL_RUNTIME_TARGET__")) {
  throw new Error("The built package cannot receive Envil's runtime proof.");
}
