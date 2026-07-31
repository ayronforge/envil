import type { Replacement, TransformContext } from "./ast.ts";
import { collectExpoRuntimeReplacements } from "./expo-runtime.ts";

/** Collects the source edits required for a server target without pruning fragments. */
export function collectServerReplacements(context: TransformContext): ReadonlyArray<Replacement> {
  return collectExpoRuntimeReplacements(context);
}
