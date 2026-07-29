/** Runtime targets understood by the CLI environment contract. */
export type EnvironmentTarget = "server" | "client";

/** Schemas that `envil init --from` can safely infer from in-memory values. */
export type SchemaKind =
  | "requiredString"
  | "boolean"
  | "integer"
  | "number"
  | "port"
  | "url"
  | "postgresUrl"
  | "redisUrl"
  | "mongoUrl"
  | "mysqlUrl";
