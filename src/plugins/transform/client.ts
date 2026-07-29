import ts from "typescript6";

import {
  applyReplacements,
  createTransformContext,
  isImportedMember,
  type Replacement,
  type TransformContext,
} from "./ast.ts";
import { collectExpoRuntimeReplacements } from "./expo-runtime.ts";

function collectSymbolReferences(
  node: ts.Node,
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  references: ts.Identifier[],
): void {
  if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === symbol) {
    references.push(node);
  }
  ts.forEachChild(node, (child) => collectSymbolReferences(child, symbol, checker, references));
}

function isInsideRange(node: ts.Node, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([start, end]) => node.getStart() >= start && node.end <= end);
}

function configuredResolverReplacements(
  context: TransformContext,
  serverRanges: ReadonlyArray<readonly [number, number]>,
): ReadonlyArray<Replacement> {
  const replacements: Replacement[] = [];

  for (const statement of context.sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
      continue;
    }
    const declaration = statement.declarationList.declarations[0];
    if (
      declaration === undefined ||
      !ts.isIdentifier(declaration.name) ||
      declaration.initializer === undefined ||
      !ts.isCallExpression(declaration.initializer) ||
      !isImportedMember(
        declaration.initializer.expression,
        "configureResolver",
        context.bindings.configureResolver,
        context.bindings.envilNamespaces,
        context.checker,
      )
    ) {
      continue;
    }

    const symbol = context.checker.getSymbolAtLocation(declaration.name);
    if (symbol === undefined) {
      continue;
    }
    const references: ts.Identifier[] = [];
    collectSymbolReferences(context.sourceFile, symbol, context.checker, references);
    const externalReferences = references.filter(
      (reference) =>
        reference.getStart(context.sourceFile) !== declaration.name.getStart(context.sourceFile) ||
        reference.end !== declaration.name.end,
    );
    if (
      externalReferences.length > 0 &&
      externalReferences.every((reference) => isInsideRange(reference, serverRanges))
    ) {
      replacements.push({
        start: statement.getStart(context.sourceFile),
        end: statement.end,
        text: "",
      });
    }
  }

  return replacements;
}

function serverFragmentReplacements(context: TransformContext): {
  readonly ranges: ReadonlyArray<readonly [number, number]>;
  readonly replacements: ReadonlyArray<Replacement>;
} {
  const ranges: Array<readonly [number, number]> = [];
  const replacements: Replacement[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      isImportedMember(
        node.expression,
        "server",
        context.bindings.server,
        context.bindings.envilNamespaces,
        context.checker,
      )
    ) {
      const start = node.getStart(context.sourceFile);
      ranges.push([start, node.end]);
      replacements.push({ start, end: node.end, text: "undefined" });
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(context.sourceFile);
  return { ranges, replacements };
}

/** Compiles one module for a public client target. */
export function transformClientModule(code: string, id: string): string {
  const context = createTransformContext(code, id);
  if (context === undefined) {
    return code;
  }

  const serverFragments = serverFragmentReplacements(context);
  return applyReplacements(code, [
    ...serverFragments.replacements,
    ...configuredResolverReplacements(context, serverFragments.ranges),
    ...collectExpoRuntimeReplacements(context, serverFragments.ranges),
  ]);
}
