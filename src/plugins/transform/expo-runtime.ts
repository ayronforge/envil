import ts from "typescript6";

import { isImportedMember, type Replacement, type TransformContext } from "./ast.ts";

const expoPrefix = "EXPO_PUBLIC_";

function isExpoExpression(expression: ts.Expression, context: TransformContext): boolean {
  return isImportedMember(
    expression,
    "expo",
    context.bindings.expo,
    context.bindings.presetNamespaces,
    context.checker,
  );
}

function expoOptionsKind(
  expression: ts.Expression,
  context: TransformContext,
): "direct" | "spread" | undefined {
  if (isExpoExpression(expression, context)) {
    return "direct";
  }
  if (
    ts.isObjectLiteralExpression(expression) &&
    expression.properties.some(
      (property) =>
        ts.isSpreadAssignment(property) && isExpoExpression(property.expression, context),
    )
  ) {
    return "spread";
  }
  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  return undefined;
}

function expoRuntimeKeys(values: ts.Expression): ReadonlyArray<string> {
  if (!ts.isObjectLiteralExpression(values)) {
    throw new Error(
      "Envil's Expo compiler requires the client schema to be an inline object literal.",
    );
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const property of values.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      throw new Error(
        "Envil's Expo compiler requires explicit client schema properties without spreads or computed keys.",
      );
    }
    const logicalKey = propertyNameText(property.name);
    const runtimeKey = logicalKey === undefined ? undefined : `${expoPrefix}${logicalKey}`;
    if (
      runtimeKey === undefined ||
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(runtimeKey) ||
      seen.has(runtimeKey)
    ) {
      throw new Error(
        "Envil's Expo compiler requires unique client keys that can be emitted with process.env dot notation.",
      );
    }
    seen.add(runtimeKey);
    keys.push(runtimeKey);
  }
  return keys;
}

function hasRuntimeEnvProperty(options: ts.ObjectLiteralExpression): boolean {
  return options.properties.some(
    (property) =>
      (ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property) ||
        ts.isMethodDeclaration(property) ||
        ts.isGetAccessorDeclaration(property) ||
        ts.isSetAccessorDeclaration(property)) &&
      propertyNameText(property.name) === "runtimeEnv",
  );
}

function expoOptionsReplacement(
  context: TransformContext,
  options: ts.Expression,
  kind: "direct" | "spread",
  runtimeKeys: ReadonlyArray<string>,
): string | undefined {
  if (
    kind === "spread" &&
    ts.isObjectLiteralExpression(options) &&
    hasRuntimeEnvProperty(options)
  ) {
    return undefined;
  }

  const runtimeEnv = `{ ${runtimeKeys
    .map((runtimeKey) => `${JSON.stringify(runtimeKey)}: process.env.${runtimeKey}`)
    .join(", ")} }`;
  if (kind === "direct") {
    return `{ ...${context.code.slice(options.getStart(), options.end)}, runtimeEnv: ${runtimeEnv} }`;
  }
  if (!ts.isObjectLiteralExpression(options)) {
    return undefined;
  }

  const interior = context.code.slice(options.getStart() + 1, options.end - 1);
  const separator =
    interior.trim().length === 0 ? "" : interior.trimEnd().endsWith(",") ? " " : ", ";
  return `{${interior}${separator}runtimeEnv: ${runtimeEnv} }`;
}

function isInsideExcludedRange(
  node: ts.Node,
  excludedRanges: ReadonlyArray<readonly [number, number]>,
): boolean {
  return excludedRanges.some(([start, end]) => node.getStart() >= start && node.end <= end);
}

/** Builds Expo runtime replacements outside target-specific excluded ranges. */
export function collectExpoRuntimeReplacements(
  context: TransformContext,
  excludedRanges: ReadonlyArray<readonly [number, number]> = [],
): ReadonlyArray<Replacement> {
  const replacements: Replacement[] = [];

  function visit(node: ts.Node): void {
    if (isInsideExcludedRange(node, excludedRanges)) {
      return;
    }
    if (
      ts.isCallExpression(node) &&
      isImportedMember(
        node.expression,
        "client",
        context.bindings.client,
        context.bindings.envilNamespaces,
        context.checker,
      )
    ) {
      const values = node.arguments[0];
      const options = node.arguments[1];
      if (values !== undefined && options !== undefined) {
        const kind = expoOptionsKind(options, context);
        if (kind !== undefined) {
          const replacement = expoOptionsReplacement(
            context,
            options,
            kind,
            expoRuntimeKeys(values),
          );
          if (replacement !== undefined) {
            replacements.push({
              start: options.getStart(context.sourceFile),
              end: options.end,
              text: replacement,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(context.sourceFile);
  return replacements;
}
