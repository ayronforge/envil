import ts from "typescript6";

const envilModuleName = "@ayronforge/envil";
const presetsModuleName = "@ayronforge/envil/presets";

/** Envil imports proven by symbols in one source file. */
export interface ImportedBindings {
  readonly server: ReadonlySet<ts.Symbol>;
  readonly client: ReadonlySet<ts.Symbol>;
  readonly configureResolver: ReadonlySet<ts.Symbol>;
  readonly envilNamespaces: ReadonlySet<ts.Symbol>;
  readonly expo: ReadonlySet<ts.Symbol>;
  readonly presetNamespaces: ReadonlySet<ts.Symbol>;
}

/** One source edit using offsets from the original source file. */
export interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Parsed single-file compiler state shared by target transforms. */
export interface TransformContext {
  readonly code: string;
  readonly sourceFile: ts.SourceFile;
  readonly checker: ts.TypeChecker;
  readonly bindings: ImportedBindings;
}

function addImportedSymbol(
  bindings: Set<ts.Symbol>,
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): void {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol !== undefined) {
    bindings.add(symbol);
  }
}

function importedBindings(sourceFile: ts.SourceFile, checker: ts.TypeChecker): ImportedBindings {
  const server = new Set<ts.Symbol>();
  const client = new Set<ts.Symbol>();
  const configureResolver = new Set<ts.Symbol>();
  const envilNamespaces = new Set<ts.Symbol>();
  const expo = new Set<ts.Symbol>();
  const presetNamespaces = new Set<ts.Symbol>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    const namedBindings = statement.importClause?.namedBindings;
    if (namedBindings === undefined) {
      continue;
    }

    if (ts.isNamespaceImport(namedBindings)) {
      if (moduleName === envilModuleName) {
        addImportedSymbol(envilNamespaces, namedBindings.name, checker);
      } else if (moduleName === presetsModuleName) {
        addImportedSymbol(presetNamespaces, namedBindings.name, checker);
      }
      continue;
    }

    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (moduleName === envilModuleName && importedName === "server") {
        addImportedSymbol(server, element.name, checker);
      } else if (moduleName === envilModuleName && importedName === "client") {
        addImportedSymbol(client, element.name, checker);
      } else if (moduleName === envilModuleName && importedName === "configureResolver") {
        addImportedSymbol(configureResolver, element.name, checker);
      } else if (moduleName === presetsModuleName && importedName === "expo") {
        addImportedSymbol(expo, element.name, checker);
      }
    }
  }

  return {
    server,
    client,
    configureResolver,
    envilNamespaces,
    expo,
    presetNamespaces,
  };
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

/** Parses a source file only when it imports an Envil public module. */
export function createTransformContext(code: string, id: string): TransformContext | undefined {
  if (!code.includes(envilModuleName)) {
    return undefined;
  }

  const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, scriptKindFor(id));
  const checker = createSingleFileProgram(sourceFile, id, code).getTypeChecker();
  return {
    code,
    sourceFile,
    checker,
    bindings: importedBindings(sourceFile, checker),
  };
}

/** Checks whether an expression resolves to an exact Envil import. */
export function isImportedMember(
  expression: ts.Expression,
  memberName: string,
  directBindings: ReadonlySet<ts.Symbol>,
  namespaceBindings: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker,
): boolean {
  if (ts.isIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression);
    return symbol !== undefined && directBindings.has(symbol);
  }
  if (
    !ts.isPropertyAccessExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.name.text !== memberName
  ) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(expression.expression);
  return symbol !== undefined && namespaceBindings.has(symbol);
}

/** Applies non-overlapping source replacements from right to left. */
export function applyReplacements(code: string, replacements: ReadonlyArray<Replacement>): string {
  let transformed = code;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.text}${transformed.slice(replacement.end)}`;
  }
  return transformed;
}
