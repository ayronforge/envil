import {
  createDirectTransformContext,
  createResolvedTransformContext,
  type ModuleResolver,
  type TransformContext,
} from "./transform/ast.ts";
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

function transformContext(context: TransformContext, target: EnvilBuildTarget): string | undefined {
  const transformed =
    target === "client" ? transformClientModule(context) : transformServerModule(context);
  return transformed === context.code ? undefined : transformed;
}

function sourceForTarget(code: string, target: EnvilBuildTarget): string {
  return code.includes(runtimeTargetMarker)
    ? code.replace(runtimeTargetExpression, JSON.stringify(target))
    : code;
}

/**
 * Compiles direct Envil imports synchronously for Babel and focused source tests.
 */
export function transformEnvilModule(
  code: string,
  id: string,
  target: EnvilBuildTarget,
): string | undefined {
  const withRuntimeProof = sourceForTarget(code, target);
  const cleanId = id.split(/[?#]/, 1)[0] ?? id;
  const context = createDirectTransformContext(withRuntimeProof, cleanId);
  const transformed = context === undefined ? undefined : transformContext(context, target);
  return transformed === undefined && withRuntimeProof !== code ? withRuntimeProof : transformed;
}

/** Compiles Envil imports after resolving their re-export origin with the active bundler. */
export async function transformResolvedEnvilModule(
  code: string,
  id: string,
  target: EnvilBuildTarget,
  resolveModule: ModuleResolver,
): Promise<string | undefined> {
  const withRuntimeProof = sourceForTarget(code, target);
  const cleanId = id.split(/[?#]/, 1)[0] ?? id;
  if (/[/\\]node_modules[/\\]/.test(cleanId)) {
    return withRuntimeProof === code ? undefined : withRuntimeProof;
  }
  const context = await createResolvedTransformContext(withRuntimeProof, cleanId, resolveModule);
  const transformed = context === undefined ? undefined : transformContext(context, target);
  return transformed === undefined && withRuntimeProof !== code ? withRuntimeProof : transformed;
}
