import ts from "typescript6";

import { isImportedMember, type Replacement, type TransformContext } from "./ast.ts";

const expoPrefix = "EXPO_PUBLIC_";

function isExpoExpression(expression: ts.Expression, context: TransformContext): boolean {
  return isImportedMember(expression, "expo", context);
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return undefined;
}

function localConstInitializer(
  identifier: ts.Identifier,
  context: TransformContext,
): ts.Expression | undefined {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
  if (
    declaration?.initializer === undefined ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    (ts.getCombinedNodeFlags(declaration.parent) & ts.NodeFlags.Const) === 0
  ) {
    return undefined;
  }
  return declaration.initializer;
}

function importedModuleName(
  identifier: ts.Identifier,
  context: TransformContext,
): string | undefined {
  const symbol = context.checker.getSymbolAtLocation(identifier);
  for (const declaration of symbol?.declarations ?? []) {
    let current: ts.Node | undefined = declaration;
    while (current !== undefined && !ts.isImportDeclaration(current)) {
      current = current.parent;
    }
    if (current !== undefined && ts.isStringLiteral(current.moduleSpecifier)) {
      return current.moduleSpecifier.text;
    }
  }
  return undefined;
}

function explicitRuntimeKey(
  expression: ts.Expression,
  context: TransformContext,
): string | undefined {
  let runtimeKey: string | undefined;
  let hasUnresolvedImportedSchema = false;
  const visitedInitializers = new Set<ts.Expression>();

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
    if (ts.isIdentifier(node)) {
      const initializer = localConstInitializer(node, context);
      if (initializer !== undefined && !visitedInitializers.has(initializer)) {
        visitedInitializers.add(initializer);
        visit(initializer);
        return;
      }
      const moduleName = importedModuleName(node, context);
      if (
        moduleName !== undefined &&
        moduleName !== "@ayronforge/envil" &&
        moduleName !== "effect" &&
        !moduleName.startsWith("effect/")
      ) {
        hasUnresolvedImportedSchema = true;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(expression);
  if (runtimeKey === undefined && hasUnresolvedImportedSchema) {
    throw new Error(
      "Envil's Expo compiler cannot prove the runtime source of imported client schemas. Define the sourced schema in the same module.",
    );
  }
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

interface ExpoOptionsTarget {
  readonly start: number;
  readonly end: number;
  readonly expression: string;
}

function expoOptionsTargets(
  context: TransformContext,
  options: ts.Expression,
): ReadonlyArray<ExpoOptionsTarget> {
  if (isExpoExpression(options, context)) {
    return [
      {
        start: options.getStart(context.sourceFile),
        end: options.end,
        expression: context.code.slice(options.getStart(), options.end),
      },
    ];
  }
  if (ts.isIdentifier(options)) {
    const initializer = localConstInitializer(options, context);
    return initializer === undefined ? [] : expoOptionsTargets(context, initializer);
  }
  if (!ts.isObjectLiteralExpression(options)) {
    return [];
  }
  const targets: ExpoOptionsTarget[] = [];
  let hasExpoSpread = false;
  let prefixOverride: ts.Expression | "spread" | undefined;
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property) && isExpoExpression(property.expression, context)) {
      hasExpoSpread = true;
      prefixOverride = undefined;
      const expression = property.expression;
      targets.push({
        start: expression.getStart(context.sourceFile),
        end: expression.end,
        expression: context.code.slice(expression.getStart(), expression.end),
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
  return targets;
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
  const targets = new Map<
    string,
    {
      readonly target: ExpoOptionsTarget;
      readonly runtimeKeys: Set<string>;
    }
  >();

  function visit(node: ts.Node): void {
    if (isInsideExcludedRange(node, excludedRanges)) {
      return;
    }
    if (ts.isCallExpression(node) && isImportedMember(node.expression, "client", context)) {
      const values = node.arguments[0];
      const options = node.arguments[1];
      if (values !== undefined && options !== undefined) {
        const optionTargets = expoOptionsTargets(context, options);
        if (optionTargets.length > 0) {
          const runtimeKeys = expoRuntimeKeys(values, context);
          for (const target of optionTargets) {
            const key = `${target.start}:${target.end}`;
            const entry = targets.get(key) ?? {
              target,
              runtimeKeys: new Set<string>(),
            };
            for (const runtimeKey of runtimeKeys) {
              entry.runtimeKeys.add(runtimeKey);
            }
            targets.set(key, entry);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(context.sourceFile);
  return [...targets.values()].map(({ target, runtimeKeys }) => ({
    start: target.start,
    end: target.end,
    text: `{ ...${target.expression}, runtimeEnv: ${expoRuntimeSource([...runtimeKeys])} }`,
  }));
}
