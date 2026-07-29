import ts from "typescript6";

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
const envilModuleName = "@ayronforge/envil";
const runtimeTargetExpression =
  /Reflect\.get\(\s*globalThis\s*,\s*Symbol\.for\(\s*["']__ENVIL_RUNTIME_TARGET__["']\s*\)\s*,?\s*\)/g;

interface ImportedServerBindings {
  readonly direct: ReadonlySet<ts.Symbol>;
  readonly namespaces: ReadonlySet<ts.Symbol>;
}

function importedServerBindings(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): ImportedServerBindings {
  const direct = new Set<ts.Symbol>();
  const namespaces = new Set<ts.Symbol>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== envilModuleName
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(bindings)) {
      const symbol = checker.getSymbolAtLocation(bindings.name);
      if (symbol !== undefined) {
        namespaces.add(symbol);
      }
      continue;
    }
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "server") {
        const symbol = checker.getSymbolAtLocation(element.name);
        if (symbol !== undefined) {
          direct.add(symbol);
        }
      }
    }
  }

  return { direct, namespaces };
}

function isServerCall(
  expression: ts.Expression,
  bindings: ImportedServerBindings,
  checker: ts.TypeChecker,
): boolean {
  if (ts.isIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression);
    return symbol !== undefined && bindings.direct.has(symbol);
  }
  if (
    !ts.isPropertyAccessExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.name.text !== "server"
  ) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(expression.expression);
  return symbol !== undefined && bindings.namespaces.has(symbol);
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

function pruneServerFragments(code: string, id: string): string {
  if (!code.includes(envilModuleName) || !code.includes("server")) {
    return code;
  }

  const scriptKind =
    id.endsWith(".jsx") || id.endsWith(".mjsx")
      ? ts.ScriptKind.JSX
      : id.endsWith(".js") || id.endsWith(".mjs") || id.endsWith(".cjs")
        ? ts.ScriptKind.JS
        : id.endsWith(".tsx") || id.endsWith(".mtsx")
          ? ts.ScriptKind.TSX
          : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, scriptKind);
  const checker = createSingleFileProgram(sourceFile, id, code).getTypeChecker();
  const bindings = importedServerBindings(sourceFile, checker);
  if (bindings.direct.size === 0 && bindings.namespaces.size === 0) {
    return code;
  }

  const ranges: Array<readonly [number, number]> = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isServerCall(node.expression, bindings, checker)) {
      ranges.push([node.getStart(sourceFile), node.end]);
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  let transformed = code;
  for (const [start, end] of ranges.sort((left, right) => right[0] - left[0])) {
    transformed = `${transformed.slice(0, start)}undefined${transformed.slice(end)}`;
  }
  return transformed;
}

/**
 * Injects an exact runtime target and removes server fragment expressions from
 * public client builds. Schema and resolver expressions remain opaque runtime
 * code in every target where their fragment survives.
 */
export function transformEnvilModule(
  code: string,
  id: string,
  target: EnvilBuildTarget,
): string | undefined {
  const withRuntimeProof = code.includes(runtimeTargetMarker)
    ? code.replace(runtimeTargetExpression, JSON.stringify(target))
    : code;
  const transformed =
    target === "client"
      ? pruneServerFragments(withRuntimeProof, id.split("?")[0] ?? id)
      : withRuntimeProof;
  return transformed === code ? undefined : transformed;
}
