import ts from "typescript6";

import { isImportedMember, type Replacement, type TransformContext } from "./ast.ts";
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

function isTypeOnlyReference(node: ts.Identifier): boolean {
  if (ts.isPartOfTypeNode(node)) {
    return true;
  }
  let parent = node.parent;
  while (ts.isQualifiedName(parent)) {
    parent = parent.parent;
  }
  return ts.isTypeQueryNode(parent);
}

function isUnusedConfiguredResolver(
  declaration: ts.VariableDeclaration,
  context: TransformContext,
  serverRanges: ReadonlyArray<readonly [number, number]>,
): boolean {
  if (
    !ts.isIdentifier(declaration.name) ||
    declaration.initializer === undefined ||
    !ts.isCallExpression(declaration.initializer) ||
    !isImportedMember(declaration.initializer.expression, "configureResolver", context)
  ) {
    return false;
  }

  const symbol = context.checker.getSymbolAtLocation(declaration.name);
  if (symbol === undefined) {
    return false;
  }
  const references: ts.Identifier[] = [];
  collectSymbolReferences(context.sourceFile, symbol, context.checker, references);
  const externalReferences = references.filter(
    (reference) =>
      !isTypeOnlyReference(reference) &&
      (reference.getStart(context.sourceFile) !== declaration.name.getStart(context.sourceFile) ||
        reference.end !== declaration.name.end),
  );
  return (
    externalReferences.length > 0 &&
    externalReferences.every((reference) => isInsideRange(reference, serverRanges))
  );
}

function declarationReplacements(
  statement: ts.VariableStatement,
  removable: ReadonlySet<ts.VariableDeclaration>,
  context: TransformContext,
): ReadonlyArray<Replacement> {
  const declarations = statement.declarationList.declarations;
  if (removable.size === 0) {
    return [];
  }
  if (removable.size === declarations.length) {
    return [
      {
        start: statement.getStart(context.sourceFile),
        end: statement.end,
        text: "",
      },
    ];
  }

  const replacements: Replacement[] = [];
  let index = 0;
  while (index < declarations.length) {
    const first = declarations[index];
    if (first === undefined || !removable.has(first)) {
      index += 1;
      continue;
    }

    const runStart = index;
    while (index < declarations.length) {
      const declaration = declarations[index];
      if (declaration === undefined || !removable.has(declaration)) {
        break;
      }
      index += 1;
    }
    const last = declarations[index - 1];
    if (last === undefined) {
      continue;
    }
    const previous = declarations[runStart - 1];
    const next = declarations[index];
    replacements.push({
      start: previous === undefined ? first.pos : previous.end,
      end: previous === undefined && next !== undefined ? next.pos : last.end,
      text: "",
    });
  }
  return replacements;
}

function configuredResolverReplacements(
  context: TransformContext,
  serverRanges: ReadonlyArray<readonly [number, number]>,
): ReadonlyArray<Replacement> {
  const replacements: Replacement[] = [];

  for (const statement of context.sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }
    const removable = new Set(
      statement.declarationList.declarations.filter((declaration) =>
        isUnusedConfiguredResolver(declaration, context, serverRanges),
      ),
    );
    replacements.push(...declarationReplacements(statement, removable, context));
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
    if (ts.isCallExpression(node) && isImportedMember(node.expression, "server", context)) {
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

/** Collects the source edits required for a public client target. */
export function collectClientReplacements(context: TransformContext): ReadonlyArray<Replacement> {
  const serverFragments = serverFragmentReplacements(context);
  return [
    ...serverFragments.replacements,
    ...configuredResolverReplacements(context, serverFragments.ranges),
    ...collectExpoRuntimeReplacements(context, serverFragments.ranges),
  ];
}
