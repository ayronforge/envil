import { readFile } from "node:fs/promises";

import ts from "typescript6";

/** Envil exports with compiler behavior. */
export type IntrinsicName = "server" | "client" | "configureResolver" | "fromEnv" | "expo";

/** Resolves one module specifier with the active bundler. */
export type ModuleResolver = (specifier: string, importer: string) => Promise<string | undefined>;

/** Finds the Envil intrinsic behind one imported export name. */
export type ExportOriginResolver = (
  specifier: string,
  importer: string,
  exportName: string,
) => Promise<IntrinsicName | undefined>;

/** Returns the intrinsic exported directly by an Envil public entrypoint. */
export function terminalOrigin(moduleName: string, exportName: string): IntrinsicName | undefined {
  if (moduleName === "@ayronforge/envil/presets") {
    return exportName === "expo" ? "expo" : undefined;
  }
  if (moduleName !== "@ayronforge/envil") {
    return undefined;
  }
  if (
    exportName === "server" ||
    exportName === "client" ||
    exportName === "configureResolver" ||
    exportName === "fromEnv"
  ) {
    return exportName;
  }
  return undefined;
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

function exportsDeclaration(statement: ts.Statement, exportName: string): boolean {
  if (
    !ts.canHaveModifiers(statement) ||
    !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  ) {
    return false;
  }
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return statement.name?.text === exportName;
  }
  return (
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === exportName,
    )
  );
}

/** Creates a per-transform re-export tracer backed by the bundler resolver. */
export function createExportOriginResolver(resolveModule: ModuleResolver): ExportOriginResolver {
  const sourceFiles = new Map<string, ts.SourceFile>();
  const origins = new Map<string, IntrinsicName | null>();

  async function originOf(
    specifier: string,
    importer: string,
    exportName: string,
    visiting: ReadonlySet<string>,
  ): Promise<IntrinsicName | undefined> {
    const terminal = terminalOrigin(specifier, exportName);
    if (terminal !== undefined) {
      return terminal;
    }

    const resolved = await resolveModule(specifier, importer);
    if (resolved === undefined || resolved.startsWith("\0")) {
      return undefined;
    }
    const fileName = resolved.split(/[?#]/, 1)[0] ?? resolved;
    const key = `${fileName}\0${exportName}`;
    if (visiting.has(key)) {
      return undefined;
    }
    if (origins.has(key)) {
      return origins.get(key) ?? undefined;
    }

    let sourceFile = sourceFiles.get(fileName);
    if (sourceFile === undefined) {
      sourceFile = ts.createSourceFile(
        fileName,
        await readFile(fileName, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(fileName),
      );
      sourceFiles.set(fileName, sourceFile);
    }
    const nextVisiting = new Set(visiting).add(key);

    for (const statement of sourceFile.statements) {
      if (
        !ts.isExportDeclaration(statement) ||
        statement.isTypeOnly ||
        statement.exportClause === undefined ||
        !ts.isNamedExports(statement.exportClause)
      ) {
        continue;
      }
      const exported = statement.exportClause.elements.find(
        (element) => !element.isTypeOnly && element.name.text === exportName,
      );
      if (exported === undefined) {
        continue;
      }
      const localName = exported.propertyName?.text ?? exported.name.text;
      if (
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const origin = await originOf(
          statement.moduleSpecifier.text,
          fileName,
          localName,
          nextVisiting,
        );
        origins.set(key, origin ?? null);
        return origin;
      }
      for (const imported of sourceFile.statements) {
        if (
          !ts.isImportDeclaration(imported) ||
          imported.importClause?.isTypeOnly === true ||
          !ts.isStringLiteral(imported.moduleSpecifier) ||
          imported.importClause?.namedBindings === undefined ||
          !ts.isNamedImports(imported.importClause.namedBindings)
        ) {
          continue;
        }
        const element = imported.importClause.namedBindings.elements.find(
          (candidate) => !candidate.isTypeOnly && candidate.name.text === localName,
        );
        if (element !== undefined) {
          const origin = await originOf(
            imported.moduleSpecifier.text,
            fileName,
            element.propertyName?.text ?? element.name.text,
            nextVisiting,
          );
          origins.set(key, origin ?? null);
          return origin;
        }
      }
      origins.set(key, null);
      return undefined;
    }

    if (sourceFile.statements.some((statement) => exportsDeclaration(statement, exportName))) {
      origins.set(key, null);
      return undefined;
    }

    let origin: IntrinsicName | undefined;
    for (const statement of sourceFile.statements) {
      if (
        !ts.isExportDeclaration(statement) ||
        statement.isTypeOnly ||
        statement.exportClause !== undefined ||
        statement.moduleSpecifier === undefined ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }
      const candidate = await originOf(
        statement.moduleSpecifier.text,
        fileName,
        exportName,
        nextVisiting,
      );
      if (candidate !== undefined && origin !== undefined && candidate !== origin) {
        origins.set(key, null);
        return undefined;
      }
      origin = candidate ?? origin;
    }
    origins.set(key, origin ?? null);
    return origin;
  }

  return (specifier, importer, exportName) => originOf(specifier, importer, exportName, new Set());
}
