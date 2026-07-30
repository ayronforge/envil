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

function callsImportedBinding(sourceFile: ts.SourceFile): boolean {
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

  let found = false;
  function visit(node: ts.Node): void {
    if (found) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const root = rootIdentifier(node.expression);
      if (root !== undefined && importedNames.has(root.text)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
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
    if (importClause?.name !== undefined) {
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
  if (!callsImportedBinding(sourceFile)) {
    return undefined;
  }
  const checker = createSingleFileProgram(sourceFile, id, code).getTypeChecker();
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
  if (!callsImportedBinding(sourceFile)) {
    return undefined;
  }
  const checker = createSingleFileProgram(sourceFile, id, code).getTypeChecker();
  return {
    code,
    sourceFile,
    checker,
    bindings: await resolvedBindings(sourceFile, checker, resolveModule),
  };
}

/** Checks whether an expression resolves to an exact Envil import binding. */
export function isImportedMember(
  expression: ts.Expression,
  memberName: IntrinsicName,
  context: TransformContext,
): boolean {
  const unwrapped = unwrappedExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    const symbol = context.checker.getSymbolAtLocation(unwrapped);
    return symbol !== undefined && context.bindings[memberName].has(symbol);
  }
  if (
    !ts.isPropertyAccessExpression(unwrapped) ||
    !ts.isIdentifier(unwrapped.expression) ||
    unwrapped.name.text !== memberName
  ) {
    return false;
  }
  const symbol = context.checker.getSymbolAtLocation(unwrapped.expression);
  return symbol !== undefined && context.bindings.namespaces[memberName].has(symbol);
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
