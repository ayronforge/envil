import path from "node:path";

import ts from "typescript6";

import type { EnvironmentTarget } from "./types.ts";

/** One environment variable recovered from type-only contract metadata. */
export interface InspectedContractVariable {
  readonly target: EnvironmentTarget;
  readonly logicalKey: string;
  readonly runtimeKey: string;
  readonly secret: boolean;
  readonly source: "env" | "resolver";
  readonly optional: boolean;
}

/** An exported environment and its safe structural metadata. */
export interface InspectedEnvContract {
  readonly exportName: string;
  readonly variables: ReadonlyArray<InspectedContractVariable>;
}

function literalString(
  checker: ts.TypeChecker,
  metadataType: ts.Type,
  propertyName: string,
  fallbackLocation: ts.Node,
): string {
  const property = metadataType.getProperty(propertyName);
  if (property === undefined) {
    throw new Error(
      "Envil could not read this environment definition. Export the value returned by createEnv.",
    );
  }
  const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? fallbackLocation;

  const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
  if (!propertyType.isStringLiteral()) {
    throw new Error(
      "Envil could not determine the generated variable names. Keep prefixes and environment names as string literals instead of typing them as string.",
    );
  }
  return propertyType.value;
}

function literalBoolean(
  checker: ts.TypeChecker,
  metadataType: ts.Type,
  propertyName: string,
  fallbackLocation: ts.Node,
): boolean {
  const property = metadataType.getProperty(propertyName);
  if (property === undefined) {
    throw new Error(
      "Envil could not read this environment definition. Export the value returned by createEnv.",
    );
  }
  const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? fallbackLocation;

  const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
  if ((propertyType.flags & ts.TypeFlags.BooleanLiteral) === 0) {
    throw new Error(
      "Envil could not determine how this variable should be generated. Keep the environment definition fully inferred instead of widening its types.",
    );
  }
  return checker.typeToString(propertyType) === "true";
}

function literalSourceKind(
  checker: ts.TypeChecker,
  metadataType: ts.Type,
  fallbackLocation: ts.Node,
): "env" | "resolver" {
  const source = literalString(checker, metadataType, "source", fallbackLocation);
  if (source === "env" || source === "resolver") {
    return source;
  }
  throw new Error(
    "Envil could not determine how this variable is sourced. Keep the environment definition fully inferred.",
  );
}

function inspectTarget(
  checker: ts.TypeChecker,
  contractType: ts.Type,
  target: EnvironmentTarget,
): ReadonlyArray<InspectedContractVariable> {
  const targetProperty = contractType.getProperty(target);
  const targetDeclaration = targetProperty?.valueDeclaration ?? targetProperty?.declarations?.[0];
  if (targetProperty === undefined || targetDeclaration === undefined) {
    throw new Error(
      `Envil could not read the "${target}" target. Export the value returned by createEnv.`,
    );
  }

  const targetType = checker.getTypeOfSymbolAtLocation(targetProperty, targetDeclaration);
  if (checker.getIndexInfosOfType(targetType).length > 0) {
    throw new Error(
      "Envil cannot inspect an environment contract with an index signature. Keep fragment values as inferred object literals instead of widening them to Record<...>.",
    );
  }
  return checker.getPropertiesOfType(targetType).map((variable) => {
    const declaration =
      variable.valueDeclaration ?? variable.declarations?.[0] ?? targetDeclaration;
    const metadataType = checker.getTypeOfSymbolAtLocation(variable, declaration);
    const runtimeKey = literalString(checker, metadataType, "runtimeKey", declaration);
    const source = literalSourceKind(checker, metadataType, declaration);
    if (source === "env" && runtimeKey.length === 0) {
      throw new Error(
        "Envil cannot render an empty environment variable name. Pass a non-empty name to fromEnv() and avoid empty fragment keys.",
      );
    }
    if (source === "env" && !/^[\w.-]+$/.test(runtimeKey)) {
      throw new Error(
        "Envil cannot render this environment variable name in dotenv format. Use only letters, digits, underscores, periods, and hyphens.",
      );
    }
    return {
      target,
      logicalKey: variable.getName(),
      runtimeKey,
      secret: literalBoolean(checker, metadataType, "secret", declaration),
      source,
      optional: literalBoolean(checker, metadataType, "optional", declaration),
    };
  });
}

function inspectExport(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  sourceFile: ts.SourceFile,
): InspectedEnvContract | undefined {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? sourceFile;
  const exportType = checker.getTypeOfSymbolAtLocation(symbol, declaration);
  const contractProperty = exportType.getProperty("__envilContract");
  const contractDeclaration =
    contractProperty?.valueDeclaration ?? contractProperty?.declarations?.[0];
  if (contractProperty === undefined || contractDeclaration === undefined) {
    return undefined;
  }

  const contractType = checker.getTypeOfSymbolAtLocation(contractProperty, contractDeclaration);
  return {
    exportName: symbol.getName(),
    variables: (["server", "client"] as const).flatMap((target) =>
      inspectTarget(checker, contractType, target),
    ),
  };
}

/**
 * Inspects an exported Envil contract with the TypeScript Compiler API without
 * importing or executing the input module.
 */
export function inspectEnvContract(
  inputPath: string,
  requestedExport?: string,
): InspectedEnvContract {
  const absoluteInput = path.resolve(inputPath);
  const configPath = ts.findConfigFile(path.dirname(absoluteInput), ts.sys.fileExists);
  if (configPath === undefined) {
    throw new Error(
      `No tsconfig.json was found for "${absoluteInput}". Add one to the project and try again.`,
    );
  }

  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined) {
    throw new Error(`Could not read "${configPath}". Fix the tsconfig.json file and try again.`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );
  const rootNames = parsed.fileNames.includes(absoluteInput)
    ? parsed.fileNames
    : [...parsed.fileNames, absoluteInput];
  const program = ts.createProgram({
    rootNames,
    options: {
      ...parsed.options,
      noEmit: true,
    },
  });
  const sourceFile = program.getSourceFile(absoluteInput);
  if (sourceFile === undefined) {
    throw new Error(
      `Could not load "${absoluteInput}". Check --input and make sure the file is included by tsconfig.json.`,
    );
  }
  if (
    program.getSyntacticDiagnostics(sourceFile).length > 0 ||
    program.getSemanticDiagnostics(sourceFile).length > 0
  ) {
    throw new Error(
      `"${absoluteInput}" has TypeScript errors. Run your typecheck command, fix them, and try again. Error details were hidden to protect environment data.`,
    );
  }

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    throw new Error(
      `"${absoluteInput}" has no exports. Export the app environment returned by createEnv.`,
    );
  }
  const contracts = checker.getExportsOfModule(moduleSymbol).flatMap((symbol) => {
    const contract = inspectExport(checker, symbol, sourceFile);
    return contract === undefined ? [] : [contract];
  });

  if (requestedExport !== undefined) {
    const selected = contracts.find((contract) => contract.exportName === requestedExport);
    if (selected === undefined) {
      throw new Error(
        `Export "${requestedExport}" is not an Envil app environment. Choose an export created with createEnv.`,
      );
    }
    return selected;
  }
  if (contracts.length === 0) {
    throw new Error(
      `No Envil app environment was exported from "${absoluteInput}". Export the value returned by createEnv.`,
    );
  }
  if (contracts.length > 1) {
    throw new Error(
      "Found multiple exported Envil environments. Use --export <name> to choose one.",
    );
  }

  const contract = contracts[0];
  if (contract === undefined) {
    throw new Error(
      `No Envil app environment was exported from "${absoluteInput}". Export the value returned by createEnv.`,
    );
  }
  return contract;
}

/** Renders empty, deterministically ordered runtime keys for `.env.example`. */
export function renderEnvExample(contract: InspectedEnvContract): string {
  const targetOrder: Record<EnvironmentTarget, number> = {
    server: 0,
    client: 1,
  };
  const variables = contract.variables
    .filter((variable) => variable.source === "env")
    .sort((left, right) => {
      const byTarget = targetOrder[left.target] - targetOrder[right.target];
      return byTarget === 0 ? left.runtimeKey.localeCompare(right.runtimeKey) : byTarget;
    });
  const runtimeOwners = new Map<string, InspectedContractVariable>();
  for (const variable of variables) {
    const previous = runtimeOwners.get(variable.runtimeKey);
    if (previous !== undefined && previous.logicalKey !== variable.logicalKey) {
      throw new Error(
        `"${previous.logicalKey}" and "${variable.logicalKey}" both read "${variable.runtimeKey}" in the environment contract. Rename one property or map it with fromEnv().`,
      );
    }
    if (previous === undefined) {
      runtimeOwners.set(variable.runtimeKey, variable);
    }
  }
  const uniqueVariables = [...runtimeOwners.values()];
  const groups = (["server", "client"] as const)
    .map((target) =>
      uniqueVariables
        .filter((variable) => variable.target === target)
        .map((variable) => `${variable.runtimeKey}=`)
        .join("\n"),
    )
    .filter((group) => group.length > 0);

  return groups.length === 0 ? "" : `${groups.join("\n\n")}\n`;
}
