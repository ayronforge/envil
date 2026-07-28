import path from "node:path";

import ts from "typescript6";

import type { Bucket } from "./types.ts";

/** One environment variable recovered from type-only contract metadata. */
export interface InspectedContractVariable {
  readonly bucket: Bucket;
  readonly logicalKey: string;
  readonly runtimeKey: string;
  readonly secret: boolean;
  readonly source: string;
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
    throw new Error("The environment contract is missing required type metadata");
  }
  const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? fallbackLocation;

  const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
  if (!propertyType.isStringLiteral()) {
    throw new Error(
      `The environment contract contains a widened ${propertyName}; concrete environment names cannot be generated`,
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
    throw new Error("The environment contract is missing required type metadata");
  }
  const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? fallbackLocation;

  const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
  if ((propertyType.flags & ts.TypeFlags.BooleanLiteral) === 0) {
    throw new Error("The environment contract contains non-literal boolean metadata");
  }
  return checker.typeToString(propertyType) === "true";
}

function inspectBucket(
  checker: ts.TypeChecker,
  contractType: ts.Type,
  bucket: Bucket,
): ReadonlyArray<InspectedContractVariable> {
  const bucketProperty = contractType.getProperty(bucket);
  const bucketDeclaration = bucketProperty?.valueDeclaration ?? bucketProperty?.declarations?.[0];
  if (bucketProperty === undefined || bucketDeclaration === undefined) {
    throw new Error(`The environment contract is missing its ${bucket} bucket`);
  }

  const bucketType = checker.getTypeOfSymbolAtLocation(bucketProperty, bucketDeclaration);
  return checker.getPropertiesOfType(bucketType).map((variable) => {
    const declaration =
      variable.valueDeclaration ?? variable.declarations?.[0] ?? bucketDeclaration;
    const metadataType = checker.getTypeOfSymbolAtLocation(variable, declaration);
    return {
      bucket,
      logicalKey: variable.getName(),
      runtimeKey: literalString(checker, metadataType, "runtimeKey", declaration),
      secret: literalBoolean(checker, metadataType, "secret", declaration),
      source: literalString(checker, metadataType, "source", declaration),
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
    variables: (["server", "client", "shared"] as const).flatMap((bucket) =>
      inspectBucket(checker, contractType, bucket),
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
    throw new Error("Unable to locate a tsconfig.json for the input module");
  }

  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined) {
    throw new Error("Unable to read the nearest tsconfig.json");
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
    throw new Error("Unable to load the input module into the TypeScript program");
  }
  if (
    program.getSyntacticDiagnostics(sourceFile).length > 0 ||
    program.getSemanticDiagnostics(sourceFile).length > 0
  ) {
    throw new Error(
      "The input module could not be typechecked; compiler details were omitted to protect environment data",
    );
  }

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    throw new Error("The input module has no inspectable exports");
  }
  const contracts = checker.getExportsOfModule(moduleSymbol).flatMap((symbol) => {
    const contract = inspectExport(checker, symbol, sourceFile);
    return contract === undefined ? [] : [contract];
  });

  if (requestedExport !== undefined) {
    const selected = contracts.find((contract) => contract.exportName === requestedExport);
    if (selected === undefined) {
      throw new Error(`Export "${requestedExport}" does not carry an Envil contract`);
    }
    return selected;
  }
  if (contracts.length === 0) {
    throw new Error("No exported Envil contract was found in the input module");
  }
  if (contracts.length > 1) {
    throw new Error(
      "Multiple exported Envil contracts were found; select one with --export <name>",
    );
  }

  const contract = contracts[0];
  if (contract === undefined) {
    throw new Error("No exported Envil contract was found in the input module");
  }
  return contract;
}

/** Renders empty, deterministically ordered physical keys for `.env.example`. */
export function renderEnvExample(contract: InspectedEnvContract): string {
  const bucketOrder: Record<Bucket, number> = {
    server: 0,
    client: 1,
    shared: 2,
  };
  const variables = [...contract.variables].sort((left, right) => {
    const byBucket = bucketOrder[left.bucket] - bucketOrder[right.bucket];
    return byBucket === 0 ? left.runtimeKey.localeCompare(right.runtimeKey) : byBucket;
  });
  const groups = (["server", "client", "shared"] as const)
    .map((bucket) =>
      variables
        .filter((variable) => variable.bucket === bucket)
        .map((variable) => `${variable.runtimeKey}=`)
        .join("\n"),
    )
    .filter((group) => group.length > 0);

  return groups.length === 0 ? "" : `${groups.join("\n\n")}\n`;
}
