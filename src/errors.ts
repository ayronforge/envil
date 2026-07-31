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

const expectedValueDescriptions: Readonly<Record<string, string>> = {
  RequiredString: "a non-empty string",
  BooleanString: "true, false, 1, or 0",
  Integer: "a whole number",
  Number: "a number",
  PositiveNumber: "a number greater than 0",
  NonNegativeNumber: "a number greater than or equal to 0",
  Port: "a whole number from 1 to 65535",
  Url: "a full HTTP or HTTPS URL",
  PostgresUrl: "a PostgreSQL connection URL",
  RedisUrl: "a Redis connection URL",
  MongoUrl: "a MongoDB connection URL",
  MysqlUrl: "a MySQL connection URL",
};

function formatIssue(issue: EnvValidationIssue): string {
  if (issue._tag === "MissingVariable") {
    return `- "${issue.key}" is missing. Set it before starting the application.`;
  }

  const expected =
    issue.schemaIdentifier === undefined
      ? "the expected format"
      : (expectedValueDescriptions[issue.schemaIdentifier] ??
        "a value matching the configured format");
  return `- "${issue.key}" has an invalid value. Expected ${expected}.`;
}

/** Aggregates validation failures without retaining rejected input values. */
export class EnvValidationError extends Error {
  readonly _tag = "EnvValidationError" as const;
  readonly issues: ReadonlyArray<EnvValidationIssue>;

  constructor(issues: ReadonlyArray<EnvValidationIssue>) {
    const safeIssues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
    super(
      `Environment setup failed:\n${safeIssues.map(formatIssue).join("\n")}\nUpdate the listed variables and try again.`,
    );
    this.name = "EnvValidationError";
    this.issues = safeIssues;
  }
}

/** Raised when fragments, sources, or resolvers violate a runtime invariant. */
export class EnvConfigurationError extends Error {
  readonly _tag = "EnvConfigurationError" as const;

  constructor(message: string) {
    super(message);
    this.name = "EnvConfigurationError";
  }
}

/** Raised when server environment materialization is attempted outside a proven server runtime. */
export class ServerEnvironmentAccessError extends EnvConfigurationError {
  readonly runtimeTarget: "client" | "unknown";

  constructor(runtimeTarget: "client" | "unknown") {
    const guidance =
      runtimeTarget === "client"
        ? "This code is running in a client bundle."
        : "Envil could not prove that this code is running on the server.";
    super(
      `The server environment is not available here. ${guidance} Run appEnv.server only from server code and configure the Envil build plugin when your runtime cannot be detected safely.`,
    );
    this.name = "ServerEnvironmentAccessError";
    this.runtimeTarget = runtimeTarget;
  }
}

/** Raised when application code reads a value outside the materialized environment. */
export class EnvironmentAccessError extends EnvConfigurationError {
  readonly key: string;
  readonly runtimeTarget: "server" | "client";

  constructor(runtimeTarget: "server" | "client", key: string) {
    const guidance =
      runtimeTarget === "client"
        ? "Declare it in a client fragment if it is public, or read it through appEnv.server from server code."
        : "Declare it in a server or shared fragment.";
    super(`"${key}" is not available in the ${runtimeTarget} environment. ${guidance}`);
    this.name = "EnvironmentAccessError";
    this.runtimeTarget = runtimeTarget;
    this.key = key;
  }
}
