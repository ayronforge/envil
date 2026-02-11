import { Function, Schema } from "effect";

export const DEFAULT_VALUE_ANNOTATION = Symbol.for("@ayronforge/envil/default-value");
export const SCHEMA_KIND_ANNOTATION = Symbol.for("@ayronforge/envil/schema-kind");
export const PLACEHOLDER_ANNOTATION = Symbol.for("@ayronforge/envil/placeholder");
export const OPTIONAL_ANNOTATION = Symbol.for("@ayronforge/envil/optional");
export const REDACTED_ANNOTATION = Symbol.for("@ayronforge/envil/redacted");
export const STRING_ENUM_VALUES_ANNOTATION = Symbol.for("@ayronforge/envil/string-enum-values");

export const withDefault: {
  <S extends Schema.Schema.Any>(
    defaultValue: NonNullable<Schema.Schema.Type<S>>,
  ): (
    schema: S,
  ) => Schema.transform<
    Schema.UndefinedOr<S>,
    Schema.SchemaClass<NonNullable<Schema.Schema.Type<S>>>
  >;
  <S extends Schema.Schema.Any>(
    schema: S,
    defaultValue: NonNullable<Schema.Schema.Type<S>>,
  ): Schema.transform<
    Schema.UndefinedOr<S>,
    Schema.SchemaClass<NonNullable<Schema.Schema.Type<S>>>
  >;
} = Function.dual(
  2,
  <S extends Schema.Schema.Any>(schema: S, defaultValue: NonNullable<Schema.Schema.Type<S>>) => {
    const withDefaultSchema = Schema.transform(
      Schema.UndefinedOr(schema),
      Schema.typeSchema(schema),
      {
        decode: (value) => value ?? defaultValue,
        encode: (value) => value,
      },
    ) as Schema.transform<
      Schema.UndefinedOr<S>,
      Schema.SchemaClass<NonNullable<Schema.Schema.Type<S>>>
    >;

    return withDefaultSchema.annotations({
      [DEFAULT_VALUE_ANNOTATION]: defaultValue,
    } as Record<PropertyKey, unknown>);
  },
);

export const optional = <S extends Schema.Schema.Any>(schema: S) =>
  Schema.UndefinedOr(schema).annotations({
    [OPTIONAL_ANNOTATION]: true,
  } as Record<PropertyKey, unknown>);

export const redacted = <S extends Schema.Schema.Any>(schema: S) =>
  Schema.Redacted(schema).annotations({
    [REDACTED_ANNOTATION]: true,
  } as Record<PropertyKey, unknown>);

export const requiredString = Schema.String.pipe(Schema.minLength(1)).annotations({
  identifier: "RequiredString",
  [SCHEMA_KIND_ANNOTATION]: "requiredString",
  [PLACEHOLDER_ANNOTATION]: "CHANGE_ME",
} as Record<PropertyKey, unknown>);

export const boolean = Schema.transform(
  Schema.String.pipe(
    Schema.filter((s) => ["true", "false", "1", "0"].includes(s.toLowerCase()), {
      identifier: "BooleanString",
      message: () => "Expected 'true', 'false', '1', or '0'",
    }),
  ),
  Schema.Boolean,
  {
    decode: (s) => s.toLowerCase() === "true" || s === "1",
    encode: (b) => (b ? "true" : "false"),
  },
).annotations({
  [SCHEMA_KIND_ANNOTATION]: "boolean",
  [PLACEHOLDER_ANNOTATION]: "true",
} as Record<PropertyKey, unknown>);

export const integer = Schema.NumberFromString.pipe(Schema.int()).annotations({
  identifier: "Integer",
  [SCHEMA_KIND_ANNOTATION]: "integer",
  [PLACEHOLDER_ANNOTATION]: "123",
} as Record<PropertyKey, unknown>);

export const number = Schema.NumberFromString.annotations({
  identifier: "Number",
  [SCHEMA_KIND_ANNOTATION]: "number",
  [PLACEHOLDER_ANNOTATION]: "3.14",
} as Record<PropertyKey, unknown>);

export const positiveNumber = Schema.NumberFromString.pipe(Schema.positive()).annotations({
  identifier: "PositiveNumber",
});

export const nonNegativeNumber = Schema.NumberFromString.pipe(Schema.nonNegative()).annotations({
  identifier: "NonNegativeNumber",
});

export const port = Schema.NumberFromString.pipe(
  Schema.int(),
  Schema.between(1, 65535),
).annotations({
  identifier: "Port",
  [SCHEMA_KIND_ANNOTATION]: "port",
  [PLACEHOLDER_ANNOTATION]: "3000",
} as Record<PropertyKey, unknown>);

export const url = Schema.String.pipe(
  Schema.filter(
    (s) => {
      try {
        new URL(s);
        return s.startsWith("http://") || s.startsWith("https://");
      } catch {
        return false;
      }
    },
    { identifier: "Url", message: () => "Expected a valid HTTP or HTTPS URL" },
  ),
).annotations({
  [SCHEMA_KIND_ANNOTATION]: "url",
  [PLACEHOLDER_ANNOTATION]: "https://example.com",
} as Record<PropertyKey, unknown>);
export type Url = Schema.Schema.Type<typeof url>;

export const postgresUrl = Schema.String.pipe(
  Schema.filter((s) => s.startsWith("postgres://") || s.startsWith("postgresql://"), {
    identifier: "PostgresUrl",
    message: () => "Expected a valid PostgreSQL connection URL",
  }),
  Schema.pattern(/^(postgres|postgresql):\/\/[^:]+:[^@]+@[^:]+:\d+\/.+$/),
).annotations({
  [SCHEMA_KIND_ANNOTATION]: "postgresUrl",
  [PLACEHOLDER_ANNOTATION]: "postgres://user:pass@localhost:5432/app",
} as Record<PropertyKey, unknown>);
export type PostgresUrl = Schema.Schema.Type<typeof postgresUrl>;

export const redisUrl = Schema.String.pipe(
  Schema.filter((s) => s.startsWith("redis://") || s.startsWith("rediss://"), {
    identifier: "RedisUrl",
    message: () => "Expected a valid Redis connection URL",
  }),
  Schema.pattern(/^rediss?:\/\/(?:[^:]+:[^@]+@)?[^:]+(?::\d+)?(?:\/\d+)?$/),
).annotations({
  [SCHEMA_KIND_ANNOTATION]: "redisUrl",
  [PLACEHOLDER_ANNOTATION]: "redis://localhost:6379",
} as Record<PropertyKey, unknown>);
export type RedisUrl = Schema.Schema.Type<typeof redisUrl>;

export const mongoUrl = Schema.String.pipe(
  Schema.filter((s) => s.startsWith("mongodb://") || s.startsWith("mongodb+srv://"), {
    identifier: "MongoUrl",
    message: () => "Expected a valid MongoDB connection URL",
  }),
  Schema.pattern(/^mongodb(\+srv)?:\/\/(?:[^:]+:[^@]+@)?[^/]+(?:\/[^?]*)?(?:\?.*)?$/),
).annotations({
  [SCHEMA_KIND_ANNOTATION]: "mongoUrl",
  [PLACEHOLDER_ANNOTATION]: "mongodb://localhost:27017/app",
} as Record<PropertyKey, unknown>);
export type MongoUrl = Schema.Schema.Type<typeof mongoUrl>;

export const mysqlUrl = Schema.String.pipe(
  Schema.filter((s) => s.startsWith("mysql://") || s.startsWith("mysqls://"), {
    identifier: "MysqlUrl",
    message: () => "Expected a valid MySQL connection URL",
  }),
  Schema.pattern(/^mysqls?:\/\/[^:]+:[^@]+@[^:]+:\d+\/.+$/),
).annotations({
  [SCHEMA_KIND_ANNOTATION]: "mysqlUrl",
  [PLACEHOLDER_ANNOTATION]: "mysql://user:pass@localhost:3306/app",
} as Record<PropertyKey, unknown>);
export type MysqlUrl = Schema.Schema.Type<typeof mysqlUrl>;

export const commaSeparated = Schema.transform(
  Schema.String,
  Schema.mutable(Schema.Array(Schema.String)),
  {
    decode: (s) => s.split(",").map((x) => x.trim()),
    encode: (a) => a.join(","),
  },
).annotations({
  [SCHEMA_KIND_ANNOTATION]: "commaSeparated",
  [PLACEHOLDER_ANNOTATION]: "alpha,beta,gamma",
} as Record<PropertyKey, unknown>);

export const commaSeparatedNumbers = Schema.transform(
  Schema.String,
  Schema.mutable(Schema.Array(Schema.Number)),
  {
    decode: (s) =>
      s.split(",").map((x) => {
        const n = Number(x.trim());
        if (Number.isNaN(n)) throw new Error(`"${x.trim()}" is not a valid number`);
        return n;
      }),
    encode: (a) => a.join(","),
  },
).annotations({
  [SCHEMA_KIND_ANNOTATION]: "commaSeparatedNumbers",
  [PLACEHOLDER_ANNOTATION]: "1,2,3",
} as Record<PropertyKey, unknown>);

export const commaSeparatedUrls = Schema.transform(
  Schema.String,
  Schema.mutable(Schema.Array(url)),
  {
    decode: (s) => s.split(",").map((x) => Schema.decodeUnknownSync(url)(x.trim())),
    encode: (a) => a.join(","),
  },
).annotations({
  [SCHEMA_KIND_ANNOTATION]: "commaSeparatedUrls",
  [PLACEHOLDER_ANNOTATION]: "https://one.example.com,https://two.example.com",
} as Record<PropertyKey, unknown>);

export const stringEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  Schema.Literal(...values).annotations({
    [SCHEMA_KIND_ANNOTATION]: "stringEnum",
    [STRING_ENUM_VALUES_ANNOTATION]: values,
    [PLACEHOLDER_ANNOTATION]: values[0],
  } as Record<PropertyKey, unknown>);

export const json = <S extends Schema.Schema.Any>(schema: S) =>
  Schema.parseJson(schema).annotations({
    [SCHEMA_KIND_ANNOTATION]: "json",
    [PLACEHOLDER_ANNOTATION]: '{"key":"value"}',
  } as Record<PropertyKey, unknown>);
