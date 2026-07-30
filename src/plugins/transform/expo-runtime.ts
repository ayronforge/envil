import ts from "typescript6";

import { isImportedMember, type Replacement, type TransformContext } from "./ast.ts";

const expoPrefix = "EXPO_PUBLIC_";

function isExpoExpression(expression: ts.Expression, context: TransformContext): boolean {
  return isImportedMember(expression, "expo", context);
}

function hasExpoOptions(expression: ts.Expression, context: TransformContext): boolean {
  return (
    isExpoExpression(expression, context) ||
    (ts.isObjectLiteralExpression(expression) &&
      expression.properties.some(
        (property) =>
          ts.isSpreadAssignment(property) && isExpoExpression(property.expression, context),
      ))
  );
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

function explicitRuntimeKey(
  expression: ts.Expression,
  context: TransformContext,
): string | undefined {
  let runtimeKey: string | undefined;

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isImportedMember(node.expression, "fromEnv", context)) {
      const name = node.arguments[0];
      if (name === undefined || !ts.isStringLiteralLike(name) || runtimeKey !== undefined) {
        throw new Error(
          "Envil's Expo compiler requires fromEnv() to contain one literal environment name.",
        );
      }
      runtimeKey = name.text;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(expression);
  return runtimeKey;
}

function expoRuntimeKeys(values: ts.Expression, context: TransformContext): ReadonlyArray<string> {
  if (!ts.isObjectLiteralExpression(values)) {
    throw new Error(
      "Envil's Expo compiler requires the client schema to be an inline object literal.",
    );
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const property of values.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(
        "Envil's Expo compiler requires explicit client schema properties without spreads or computed keys.",
      );
    }
    const logicalKey = propertyNameText(property.name);
    const explicitKey = explicitRuntimeKey(property.initializer, context);
    const runtimeKey =
      explicitKey ?? (logicalKey === undefined ? undefined : `${expoPrefix}${logicalKey}`);
    if (explicitKey !== undefined && !explicitKey.startsWith(expoPrefix)) {
      throw new Error(
        `Envil's Expo compiler requires fromEnv() names to start with "${expoPrefix}".`,
      );
    }
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

function expoRuntimeSource(runtimeKeys: ReadonlyArray<string>): string {
  return `{ ${runtimeKeys
    .map((runtimeKey) => `${JSON.stringify(runtimeKey)}: process.env.${runtimeKey}`)
    .join(", ")} }`;
}

function expoOptionsReplacements(
  context: TransformContext,
  options: ts.Expression,
  runtimeKeys: ReadonlyArray<string>,
): ReadonlyArray<Replacement> {
  const runtimeEnv = expoRuntimeSource(runtimeKeys);
  if (isExpoExpression(options, context)) {
    return [
      {
        start: options.getStart(context.sourceFile),
        end: options.end,
        text: `{ ...${context.code.slice(options.getStart(), options.end)}, runtimeEnv: ${runtimeEnv} }`,
      },
    ];
  }
  if (!ts.isObjectLiteralExpression(options)) {
    return [];
  }
  const replacements: Replacement[] = [];
  let hasExpoSpread = false;
  let prefixOverride: ts.Expression | "spread" | undefined;
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property) && isExpoExpression(property.expression, context)) {
      hasExpoSpread = true;
      prefixOverride = undefined;
      const expression = property.expression;
      replacements.push({
        start: expression.getStart(context.sourceFile),
        end: expression.end,
        text: `{ ...${context.code.slice(expression.getStart(), expression.end)}, runtimeEnv: ${runtimeEnv} }`,
      });
      continue;
    }

    if (!hasExpoSpread) {
      continue;
    }
    if (ts.isSpreadAssignment(property)) {
      prefixOverride = "spread";
      continue;
    }
    const initializer =
      ts.isPropertyAssignment(property) && propertyNameText(property.name) === "prefix"
        ? property.initializer
        : ts.isShorthandPropertyAssignment(property) && property.name.text === "prefix"
          ? property.name
          : undefined;
    if (initializer !== undefined) {
      prefixOverride = initializer;
    }
  }
  if (
    prefixOverride !== undefined &&
    (prefixOverride === "spread" ||
      !ts.isStringLiteralLike(prefixOverride) ||
      prefixOverride.text !== expoPrefix)
  ) {
    throw new Error(
      `Envil's Expo compiler does not support overriding the preset prefix "${expoPrefix}".`,
    );
  }
  return replacements;
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
    if (ts.isCallExpression(node) && isImportedMember(node.expression, "client", context)) {
      const values = node.arguments[0];
      const options = node.arguments[1];
      if (values !== undefined && options !== undefined && hasExpoOptions(options, context)) {
        const optionReplacements = expoOptionsReplacements(
          context,
          options,
          expoRuntimeKeys(values, context),
        );
        if (optionReplacements.length > 0) {
          replacements.push(...optionReplacements);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(context.sourceFile);
  return replacements;
}
