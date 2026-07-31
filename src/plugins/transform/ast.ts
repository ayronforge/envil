import MagicString from "magic-string";
import ts from "typescript6";

import {
  createExportOriginResolver,
  terminalOrigin,
  type IntrinsicName,
  type ModuleResolver,
} from "./module-origin.ts";

export type { IntrinsicName, ModuleResolver } from "./module-origin.ts";

/** Envil import bindings proven within one source file. */
export interface ImportedBindings {
  readonly server: ReadonlySet<ts.Symbol>;
  readonly client: ReadonlySet<ts.Symbol>;
  readonly configureResolver: ReadonlySet<ts.Symbol>;
  readonly fromEnv: ReadonlySet<ts.Symbol>;
  readonly expo: ReadonlySet<ts.Symbol>;
  readonly namespaces: {
    readonly [Name in IntrinsicName]: ReadonlySet<ts.Symbol>;
  };
}

/** One source edit using offsets from the original source file. */
export interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Rewritten module source and its mapping back to the original module. */
export interface TransformResult {
  readonly code: string;
  readonly map: {
    readonly version: 3;
    readonly sources: string[];
    readonly sourcesContent: string[];
    readonly names: string[];
    readonly mappings: string;
  };
}

/** Parsed compiler state shared by target transforms. */
export interface TransformContext {
  readonly code: string;
  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker;
  readonly bindings: ImportedBindings;
}

interface MutableBindings {
  readonly server: Set<ts.Symbol>;
  readonly client: Set<ts.Symbol>;
  readonly configureResolver: Set<ts.Symbol>;
  readonly fromEnv: Set<ts.Symbol>;
  readonly expo: Set<ts.Symbol>;
  readonly namespaces: {
    readonly [Name in IntrinsicName]: Set<ts.Symbol>;
  };
}

function emptyBindings(): MutableBindings {
  return {
    server: new Set(),
    client: new Set(),
    configureResolver: new Set(),
    fromEnv: new Set(),
    expo: new Set(),
    namespaces: {
      server: new Set(),
      client: new Set(),
      configureResolver: new Set(),
      fromEnv: new Set(),
      expo: new Set(),
    },
  };
}

function addBinding(
  bindings: MutableBindings,
  intrinsic: IntrinsicName,
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): void {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol !== undefined) {
    bindings[intrinsic].add(symbol);
  }
}

function scriptKindFor(id: string): ts.ScriptKind {
  if (id.endsWith(".jsx") || id.endsWith(".mjsx")) {
    return ts.ScriptKind.JSX;
  }
  if (id.endsWith(".js") || id.endsWith(".mjs") || id.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  if (id.endsWith(".tsx") || id.endsWith(".mtsx")) {
    return ts.ScriptKind.TSX;
  }
  return ts.ScriptKind.TS;
}

function createSingleFileProgram(sourceFile: ts.SourceFile, id: string, code: string): ts.Program {
  const host: ts.CompilerHost = {
    fileExists: (fileName) => fileName === id,
    readFile: (fileName) => (fileName === id ? code : undefined),
    getSourceFile: (fileName) => (fileName === id ? sourceFile : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  return ts.createProgram(
    [id],
    {
      allowJs: true,
      checkJs: false,
      noLib: true,
      noResolve: true,
    },
    host,
  );
}

function unwrappedExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return unwrappedExpression(expression.expression);
  }
  return expression;
}

function rootIdentifier(expression: ts.Expression): ts.Identifier | undefined {
  const unwrapped = unwrappedExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return unwrapped;
  }
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return rootIdentifier(unwrapped.expression);
  }
  return undefined;
}

function immutableAliasDeclaration(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): ts.VariableDeclaration | ts.BindingElement | undefined {
  const symbol = checker.getSymbolAtLocation(identifier);
  const declaration = symbol?.declarations?.find(
    (candidate): candidate is ts.VariableDeclaration | ts.BindingElement =>
      ts.isVariableDeclaration(candidate) || ts.isBindingElement(candidate),
  );
  if (declaration === undefined) {
    return undefined;
  }
  const variableDeclaration = ts.isVariableDeclaration(declaration)
    ? declaration
    : ts.isVariableDeclaration(declaration.parent.parent)
      ? declaration.parent.parent
      : undefined;
  if (
    variableDeclaration === undefined ||
    !ts.isVariableDeclarationList(variableDeclaration.parent) ||
    (ts.getCombinedNodeFlags(variableDeclaration.parent) & ts.NodeFlags.Const) === 0
  ) {
    return undefined;
  }
  return declaration;
}

function aliasInitializer(
  declaration: ts.VariableDeclaration | ts.BindingElement,
): ts.Expression | undefined {
  if (ts.isVariableDeclaration(declaration)) {
    return declaration.initializer;
  }
  const variableDeclaration = declaration.parent.parent;
  return ts.isVariableDeclaration(variableDeclaration)
    ? variableDeclaration.initializer
    : undefined;
}

function transformCandidateBindings(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): ReadonlySet<string> {
  const importedNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    const importClause = statement.importClause;
    if (importClause?.name !== undefined) {
      importedNames.add(importClause.name.text);
    }
    const namedBindings = importClause?.namedBindings;
    if (namedBindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(namedBindings)) {
      importedNames.add(namedBindings.name.text);
      continue;
    }
    for (const element of namedBindings.elements) {
      importedNames.add(element.name.text);
    }
  }

  const candidateNames = new Set<string>();
  function importedRootName(
    expression: ts.Expression,
    visited: Set<ts.Symbol>,
  ): string | undefined {
    const root = rootIdentifier(expression);
    if (root === undefined) {
      return undefined;
    }
    const symbol = checker.getSymbolAtLocation(root);
    if (symbol === undefined || visited.has(symbol)) {
      return undefined;
    }
    visited.add(symbol);
    if (
      importedNames.has(root.text) &&
      symbol.declarations?.some(
        (declaration) =>
          ts.isImportSpecifier(declaration) ||
          ts.isNamespaceImport(declaration) ||
          ts.isImportClause(declaration),
      )
    ) {
      return root.text;
    }
    const declaration = immutableAliasDeclaration(root, checker);
    const initializer = declaration === undefined ? undefined : aliasInitializer(declaration);
    return initializer === undefined ? undefined : importedRootName(initializer, visited);
  }

  function addImportedRoot(expression: ts.Expression): boolean {
    const importedName = importedRootName(expression, new Set());
    if (importedName === undefined) {
      return false;
    }
    candidateNames.add(importedName);
    return true;
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && addImportedRoot(node.expression)) {
      const options = node.arguments[1];
      if (options !== undefined) {
        addImportedRoot(options);
        if (ts.isObjectLiteralExpression(options)) {
          for (const property of options.properties) {
            if (ts.isSpreadAssignment(property)) {
              addImportedRoot(property.expression);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return candidateNames;
}

function directBindings(sourceFile: ts.SourceFile, checker: ts.TypeChecker): ImportedBindings {
  const bindings = emptyBindings();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.isTypeOnly === true ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    const namedBindings = statement.importClause?.namedBindings;
    if (namedBindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(namedBindings)) {
      const symbol = checker.getSymbolAtLocation(namedBindings.name);
      if (symbol === undefined) {
        continue;
      }
      for (const intrinsic of [
        "server",
        "client",
        "configureResolver",
        "fromEnv",
        "expo",
      ] satisfies ReadonlyArray<IntrinsicName>) {
        if (terminalOrigin(moduleName, intrinsic) === intrinsic) {
          bindings.namespaces[intrinsic].add(symbol);
        }
      }
      continue;
    }
    for (const element of namedBindings.elements) {
      const origin = terminalOrigin(moduleName, element.propertyName?.text ?? element.name.text);
      if (!element.isTypeOnly && origin !== undefined) {
        addBinding(bindings, origin, element.name, checker);
      }
    }
  }
  return bindings;
}

async function resolvedBindings(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  resolveModule: ModuleResolver,
  candidateNames: ReadonlySet<string>,
): Promise<ImportedBindings> {
  const bindings = emptyBindings();
  const originOf = createExportOriginResolver(resolveModule);

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.isTypeOnly === true ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const importClause = statement.importClause;
    if (importClause?.name !== undefined && candidateNames.has(importClause.name.text)) {
      const origin = await originOf(specifier, sourceFile.fileName, "default");
      if (origin !== undefined) {
        addBinding(bindings, origin, importClause.name, checker);
      }
    }
    const namedBindings = importClause?.namedBindings;
    if (namedBindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(namedBindings)) {
      if (!candidateNames.has(namedBindings.name.text)) {
        continue;
      }
      const symbol = checker.getSymbolAtLocation(namedBindings.name);
      if (symbol === undefined) {
        continue;
      }
      for (const intrinsic of [
        "server",
        "client",
        "configureResolver",
        "fromEnv",
        "expo",
      ] satisfies ReadonlyArray<IntrinsicName>) {
        if ((await originOf(specifier, sourceFile.fileName, intrinsic)) === intrinsic) {
          bindings.namespaces[intrinsic].add(symbol);
        }
      }
      continue;
    }
    for (const element of namedBindings.elements) {
      if (!candidateNames.has(element.name.text)) {
        continue;
      }
      const exportedName = element.propertyName?.text ?? element.name.text;
      const origin = await originOf(specifier, sourceFile.fileName, exportedName);
      if (!element.isTypeOnly && origin !== undefined) {
        addBinding(bindings, origin, element.name, checker);
        continue;
      }
      if (element.isTypeOnly) {
        continue;
      }
      const symbol = checker.getSymbolAtLocation(element.name);
      if (symbol === undefined) {
        continue;
      }
      for (const intrinsic of [
        "server",
        "client",
        "configureResolver",
        "fromEnv",
        "expo",
      ] satisfies ReadonlyArray<IntrinsicName>) {
        if (
          (await originOf(specifier, sourceFile.fileName, `${exportedName}.${intrinsic}`)) ===
          intrinsic
        ) {
          bindings.namespaces[intrinsic].add(symbol);
        }
      }
    }
  }
  return bindings;
}

function parsedSource(code: string, id: string): ts.SourceFile {
  return ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, scriptKindFor(id));
}

/** Parses direct Envil imports for synchronous transforms such as Babel. */
export function createDirectTransformContext(
  code: string,
  id: string,
): TransformContext | undefined {
  const sourceFile = parsedSource(code, id);
  const checker = createSingleFileProgram(sourceFile, id, code).getTypeChecker();
  if (transformCandidateBindings(sourceFile, checker).size === 0) {
    return undefined;
  }
  return {
    code,
    sourceFile,
    checker,
    bindings: directBindings(sourceFile, checker),
  };
}

/** Parses Envil imports and follows re-exports through the active bundler resolver. */
export async function createResolvedTransformContext(
  code: string,
  id: string,
  resolveModule: ModuleResolver,
): Promise<TransformContext | undefined> {
  const sourceFile = parsedSource(code, id);
  const checker = createSingleFileProgram(sourceFile, id, code).getTypeChecker();
  const candidateNames = transformCandidateBindings(sourceFile, checker);
  if (candidateNames.size === 0) {
    return undefined;
  }
  return {
    code,
    sourceFile,
    checker,
    bindings: await resolvedBindings(sourceFile, checker, resolveModule, candidateNames),
  };
}

/** Checks whether an expression resolves to an exact Envil import binding. */
export function isImportedMember(
  expression: ts.Expression,
  memberName: IntrinsicName,
  context: TransformContext,
): boolean {
  const visited = new Set<ts.Symbol>();

  function bindingElementName(declaration: ts.BindingElement): string | undefined {
    const name = declaration.propertyName ?? declaration.name;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
      return name.text;
    }
    if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) {
      return name.expression.text;
    }
    return undefined;
  }

  function isImportedNamespace(candidate: ts.Expression): boolean {
    const unwrapped = unwrappedExpression(candidate);
    if (!ts.isIdentifier(unwrapped)) {
      return false;
    }
    const symbol = context.checker.getSymbolAtLocation(unwrapped);
    if (symbol === undefined) {
      return false;
    }
    if (context.bindings.namespaces[memberName].has(symbol)) {
      return true;
    }
    if (visited.has(symbol)) {
      return false;
    }
    visited.add(symbol);
    const declaration = immutableAliasDeclaration(unwrapped, context.checker);
    const initializer = declaration === undefined ? undefined : aliasInitializer(declaration);
    return (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      initializer !== undefined &&
      isImportedNamespace(initializer)
    );
  }

  function isMember(candidate: ts.Expression): boolean {
    const unwrapped = unwrappedExpression(candidate);
    if (ts.isIdentifier(unwrapped)) {
      const symbol = context.checker.getSymbolAtLocation(unwrapped);
      if (symbol === undefined) {
        return false;
      }
      if (context.bindings[memberName].has(symbol)) {
        return true;
      }
      if (visited.has(symbol)) {
        return false;
      }
      visited.add(symbol);
      const declaration = immutableAliasDeclaration(unwrapped, context.checker);
      const initializer = declaration === undefined ? undefined : aliasInitializer(declaration);
      if (declaration === undefined || initializer === undefined) {
        return false;
      }
      return ts.isBindingElement(declaration)
        ? bindingElementName(declaration) === memberName && isImportedNamespace(initializer)
        : isMember(initializer);
    }
    if (ts.isPropertyAccessExpression(unwrapped) && unwrapped.name.text === memberName) {
      return isImportedNamespace(unwrapped.expression);
    }
    if (
      ts.isElementAccessExpression(unwrapped) &&
      ts.isStringLiteralLike(unwrapped.argumentExpression) &&
      unwrapped.argumentExpression.text === memberName
    ) {
      return isImportedNamespace(unwrapped.expression);
    }
    return false;
  }

  return isMember(expression);
}

/** Applies non-overlapping source replacements and maps the result to the original module. */
export function applyReplacements(
  code: string,
  id: string,
  replacements: ReadonlyArray<Replacement>,
): TransformResult | undefined {
  if (replacements.length === 0) {
    return undefined;
  }

  const transformed = new MagicString(code);
  for (const replacement of replacements) {
    transformed.overwrite(replacement.start, replacement.end, replacement.text);
  }
  const map = transformed.generateMap({
    source: id,
    includeContent: true,
    hires: true,
  });
  return {
    code: transformed.toString(),
    map: {
      version: 3,
      sources: map.sources,
      sourcesContent: [code],
      names: map.names,
      mappings: map.mappings,
    },
  };
}
