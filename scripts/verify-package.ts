const packageEntry = await import("../dist/index.js");
if (typeof packageEntry.createEnv !== "function") {
  throw new Error("The built package entry does not export createEnv.");
}

const runtimeTargetSource = await Bun.file("dist/runtime-target.js").text();
if (!runtimeTargetSource.includes("__ENVIL_RUNTIME_TARGET__")) {
  throw new Error("The built package cannot receive Envil's runtime proof.");
}
