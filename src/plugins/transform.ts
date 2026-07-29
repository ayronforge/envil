import { transformClientModule } from "./transform/client.ts";
import { transformServerModule } from "./transform/server.ts";

/** Runtime selected for an Envil build output. */
export type EnvilBuildTarget = "server" | "client";

/** Controls how Envil transforms environment definitions. */
export interface EnvilPluginOptions {
  /**
   * Explicit build target. Vite detects this per module graph when omitted.
   * Other bundlers default to client so an ambiguous build fails closed.
   */
  readonly target?: EnvilBuildTarget;
}

const runtimeTargetMarker = "__ENVIL_RUNTIME_TARGET__";
const runtimeTargetExpression =
  /Reflect\.get\(\s*globalThis\s*,\s*Symbol\.for\(\s*["']__ENVIL_RUNTIME_TARGET__["']\s*\)\s*,?\s*\)/g;

/**
 * Injects an exact runtime target and delegates source compilation to the
 * target-specific transformer.
 */
export function transformEnvilModule(
  code: string,
  id: string,
  target: EnvilBuildTarget,
): string | undefined {
  const withRuntimeProof = code.includes(runtimeTargetMarker)
    ? code.replace(runtimeTargetExpression, JSON.stringify(target))
    : code;
  const cleanId = id.split("?")[0] ?? id;
  const transformed =
    target === "client"
      ? transformClientModule(withRuntimeProof, cleanId)
      : transformServerModule(withRuntimeProof, cleanId);
  return transformed === code ? undefined : transformed;
}
