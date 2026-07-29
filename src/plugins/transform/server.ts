import { applyReplacements, createTransformContext } from "./ast.ts";
import { collectExpoRuntimeReplacements } from "./expo-runtime.ts";

/** Compiles one module for a server target without pruning any fragments. */
export function transformServerModule(code: string, id: string): string {
  const context = createTransformContext(code, id);
  return context === undefined
    ? code
    : applyReplacements(code, collectExpoRuntimeReplacements(context));
}
