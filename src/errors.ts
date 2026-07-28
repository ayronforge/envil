/** A secret-safe description of a missing environment variable. */
export interface MissingVariableIssue {
  readonly _tag: "MissingVariable";
  readonly key: string;
  readonly schemaIdentifier?: string;
  readonly sensitive: boolean;
}

/** A secret-safe description of an invalid environment variable. */
export interface InvalidVariableIssue {
  readonly _tag: "InvalidVariable";
  readonly key: string;
  readonly schemaIdentifier?: string;
  readonly sensitive: boolean;
}

/** Structured validation issues emitted by Envil. */
export type EnvValidationIssue = MissingVariableIssue | InvalidVariableIssue;

function formatIssue(issue: EnvValidationIssue): string {
  if (issue._tag === "MissingVariable") {
    return `${issue.key}: Required value is missing`;
  }

  return `${issue.key}: Expected ${
    issue.schemaIdentifier ?? "a value matching the configured schema"
  } (actual value omitted)`;
}

/** Aggregates validation failures without retaining rejected input values. */
export class EnvValidationError extends Error {
  readonly _tag = "EnvValidationError" as const;
  readonly issues: ReadonlyArray<EnvValidationIssue>;

  constructor(issues: ReadonlyArray<EnvValidationIssue>) {
    const safeIssues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
    super(`Invalid environment variables:\n${safeIssues.map(formatIssue).join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = safeIssues;
  }
}

/** Raised when browser code reads a server-only environment variable. */
export class ClientAccessError extends Error {
  readonly _tag = "ClientAccessError" as const;
  readonly variableName: string;

  constructor(variableName: string) {
    super(`Attempted to access server-side env var "${variableName}" on client`);
    this.name = "ClientAccessError";
    this.variableName = variableName;
  }
}

/** Raised when environment buckets, prefixes, or resolvers violate a runtime invariant. */
export class EnvConfigurationError extends Error {
  readonly _tag = "EnvConfigurationError" as const;

  constructor(message: string) {
    super(message);
    this.name = "EnvConfigurationError";
  }
}
