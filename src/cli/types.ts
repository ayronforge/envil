/** Environment contract buckets understood by the CLI. */
export type Bucket = "server" | "client" | "shared";

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
