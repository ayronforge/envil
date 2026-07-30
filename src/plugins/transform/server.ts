import { applyReplacements, type TransformContext } from "./ast.ts";
import { collectExpoRuntimeReplacements } from "./expo-runtime.ts";

/** Compiles one module for a server target without pruning any fragments. */
export function transformServerModule(context: TransformContext): string {
  return applyReplacements(context.code, collectExpoRuntimeReplacements(context));
}
