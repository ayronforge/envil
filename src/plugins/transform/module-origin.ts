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

/** Module resolution and source analysis reused for one build. */
export interface ExportOriginCache {
  readonly resolvedModules: Map<string, string | null>;
  readonly sourceFiles: Map<string, ts.SourceFile>;
  readonly origins: Map<string, IntrinsicName | null>;
}

/** Creates an empty module-origin cache for one build. */
export function createExportOriginCache(): ExportOriginCache {
  return {
    resolvedModules: new Map(),
    sourceFiles: new Map(),
    origins: new Map(),
  };
}

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

function constInitializer(sourceFile: ts.SourceFile, name: string): ts.Expression | undefined {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (ts.getCombinedNodeFlags(statement.declarationList) & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }
    const declaration = statement.declarationList.declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
    );
    if (declaration?.initializer !== undefined) {
      return declaration.initializer;
    }
  }
  return undefined;
}

/** Creates a re-export tracer backed by the bundler resolver. */
export function createExportOriginResolver(
  resolveModule: ModuleResolver,
  cache: ExportOriginCache = createExportOriginCache(),
): ExportOriginResolver {
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

    const resolutionKey = `${importer}\0${specifier}`;
    let resolved = cache.resolvedModules.get(resolutionKey);
    if (resolved === undefined) {
      resolved = (await resolveModule(specifier, importer)) ?? null;
      cache.resolvedModules.set(resolutionKey, resolved);
    }
    if (resolved === null) {
      return undefined;
    }
    if (resolved.startsWith("\0")) {
      return undefined;
    }
    const fileName = resolved.split(/[?#]/, 1)[0] ?? resolved;
    const key = `${fileName}\0${exportName}`;
    if (visiting.has(key)) {
      return undefined;
    }
    if (cache.origins.has(key)) {
      return cache.origins.get(key) ?? undefined;
    }

    let sourceFile = cache.sourceFiles.get(fileName);
    if (sourceFile === undefined) {
      sourceFile = ts.createSourceFile(
        fileName,
        await readFile(fileName, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(fileName),
      );
      cache.sourceFiles.set(fileName, sourceFile);
    }
    const currentSourceFile = sourceFile;
    const nextVisiting = new Set(visiting).add(key);

    async function importedOrigin(localName: string): Promise<IntrinsicName | undefined> {
      for (const imported of currentSourceFile.statements) {
        if (
          !ts.isImportDeclaration(imported) ||
          imported.importClause?.isTypeOnly === true ||
          !ts.isStringLiteral(imported.moduleSpecifier)
        ) {
          continue;
        }
        if (imported.importClause?.name?.text === localName) {
          return originOf(imported.moduleSpecifier.text, fileName, "default", nextVisiting);
        }
        if (
          imported.importClause?.namedBindings === undefined ||
          !ts.isNamedImports(imported.importClause.namedBindings)
        ) {
          continue;
        }
        const element = imported.importClause.namedBindings.elements.find(
          (candidate) => !candidate.isTypeOnly && candidate.name.text === localName,
        );
        if (element !== undefined) {
          return originOf(
            imported.moduleSpecifier.text,
            fileName,
            element.propertyName?.text ?? element.name.text,
            nextVisiting,
          );
        }
      }
      return undefined;
    }

    async function localOrigin(
      localName: string,
      visited: ReadonlySet<string>,
    ): Promise<IntrinsicName | undefined> {
      if (visited.has(localName)) {
        return undefined;
      }
      const imported = await importedOrigin(localName);
      if (imported !== undefined) {
        return imported;
      }
      const initializer = constInitializer(currentSourceFile, localName);
      return initializer !== undefined && ts.isIdentifier(initializer)
        ? localOrigin(initializer.text, new Set(visited).add(localName))
        : undefined;
    }

    const namespaceSeparator = exportName.indexOf(".");
    if (namespaceSeparator > 0) {
      const namespaceName = exportName.slice(0, namespaceSeparator);
      const memberName = exportName.slice(namespaceSeparator + 1);
      for (const statement of sourceFile.statements) {
        if (
          !ts.isExportDeclaration(statement) ||
          statement.isTypeOnly ||
          statement.exportClause === undefined ||
          !ts.isNamespaceExport(statement.exportClause) ||
          statement.exportClause.name.text !== namespaceName ||
          statement.moduleSpecifier === undefined ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          continue;
        }
        const origin = await originOf(
          statement.moduleSpecifier.text,
          fileName,
          memberName,
          nextVisiting,
        );
        cache.origins.set(key, origin ?? null);
        return origin;
      }
    }

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
        cache.origins.set(key, origin ?? null);
        return origin;
      }
      const origin = await localOrigin(localName, new Set());
      cache.origins.set(key, origin ?? null);
      return origin;
    }

    const initializer = constInitializer(sourceFile, exportName);
    if (
      initializer !== undefined &&
      ts.isIdentifier(initializer) &&
      sourceFile.statements.some((statement) => exportsDeclaration(statement, exportName))
    ) {
      const origin = await localOrigin(initializer.text, new Set([exportName]));
      cache.origins.set(key, origin ?? null);
      return origin;
    }

    if (sourceFile.statements.some((statement) => exportsDeclaration(statement, exportName))) {
      cache.origins.set(key, null);
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
        cache.origins.set(key, null);
        return undefined;
      }
      origin = candidate ?? origin;
    }
    cache.origins.set(key, origin ?? null);
    return origin;
  }

  return (specifier, importer, exportName) => originOf(specifier, importer, exportName, new Set());
}
