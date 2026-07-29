import { ServerEnvironmentAccessError } from "./errors.ts";

export type RuntimeTarget = "server" | "client";

type DetectedRuntimeTarget = RuntimeTarget | "unknown";

const injectedRuntimeTarget: unknown = Reflect.get(
  globalThis,
  Symbol.for("__ENVIL_RUNTIME_TARGET__"),
);

function detectRuntimeTarget(): DetectedRuntimeTarget {
  if (injectedRuntimeTarget === "server" || injectedRuntimeTarget === "client") {
    return injectedRuntimeTarget;
  }

  if (typeof window !== "undefined") {
    return "client";
  }

  if (
    typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    process.versions !== null &&
    (typeof process.versions.node === "string" ||
      typeof Reflect.get(process.versions, "bun") === "string")
  ) {
    return "server";
  }

  return "unknown";
}

/** Rejects server environment materialization unless the current runtime is proven server-side. */
export function assertServerRuntime(): void {
  const runtimeTarget = detectRuntimeTarget();
  if (runtimeTarget !== "server") {
    throw new ServerEnvironmentAccessError(runtimeTarget);
  }
}
