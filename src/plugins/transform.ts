import ts from "typescript6";

import {
  applyReplacements,
  createDirectTransformContext,
  createResolvedTransformContext,
  type ExportOriginCache,
  type ModuleResolver,
  type Replacement,
  type TransformContext,
  type TransformResult,
} from "./transform/ast.ts";
export { createExportOriginCache } from "./transform/module-origin.ts";
import { collectClientReplacements } from "./transform/client.ts";
import { collectServerReplacements } from "./transform/server.ts";

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

function targetReplacements(
  context: TransformContext,
  target: EnvilBuildTarget,
): ReadonlyArray<Replacement> {
  return target === "client"
    ? collectClientReplacements(context)
    : collectServerReplacements(context);
}

function runtimeTargetReplacements(
  code: string,
  id: string,
  target: EnvilBuildTarget,
): ReadonlyArray<Replacement> {
  if (!code.includes(runtimeTargetMarker)) {
    return [];
  }

  const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
  const replacements: Replacement[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.arguments.length === 2) {
      const reflectGet = node.expression;
      const receiver = node.arguments[0];
      const symbolCall = node.arguments[1];
      if (
        ts.isPropertyAccessExpression(reflectGet) &&
        ts.isIdentifier(reflectGet.expression) &&
        reflectGet.expression.text === "Reflect" &&
        reflectGet.name.text === "get" &&
        receiver !== undefined &&
        ts.isIdentifier(receiver) &&
        receiver.text === "globalThis" &&
        symbolCall !== undefined &&
        ts.isCallExpression(symbolCall) &&
        symbolCall.arguments.length === 1 &&
        ts.isPropertyAccessExpression(symbolCall.expression) &&
        ts.isIdentifier(symbolCall.expression.expression) &&
        symbolCall.expression.expression.text === "Symbol" &&
        symbolCall.expression.name.text === "for"
      ) {
        const marker = symbolCall.arguments[0];
        if (
          marker !== undefined &&
          ts.isStringLiteral(marker) &&
          marker.text === runtimeTargetMarker
        ) {
          replacements.push({
            start: node.getStart(sourceFile),
            end: node.end,
            text: JSON.stringify(target),
          });
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return replacements;
}

function transformModule(
  code: string,
  id: string,
  target: EnvilBuildTarget,
  context: TransformContext | undefined,
): TransformResult | undefined {
  return applyReplacements(code, id, [
    ...runtimeTargetReplacements(code, id, target),
    ...(context === undefined ? [] : targetReplacements(context, target)),
  ]);
}

/**
 * Compiles direct Envil imports synchronously for Babel and focused source tests.
 */
export function transformEnvilModule(
  code: string,
  id: string,
  target: EnvilBuildTarget,
): TransformResult | undefined {
  const cleanId = id.split(/[?#]/, 1)[0] ?? id;
  return transformModule(code, cleanId, target, createDirectTransformContext(code, cleanId));
}

/** Compiles Envil imports after resolving their re-export origin with the active bundler. */
export async function transformResolvedEnvilModule(
  code: string,
  id: string,
  target: EnvilBuildTarget,
  resolveModule: ModuleResolver,
  originCache?: ExportOriginCache,
): Promise<TransformResult | undefined> {
  const cleanId = id.split(/[?#]/, 1)[0] ?? id;
  const context = await createResolvedTransformContext(code, cleanId, resolveModule, originCache);
  return transformModule(code, cleanId, target, context);
}
