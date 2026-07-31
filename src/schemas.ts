import { Function, Schema, SchemaGetter } from "effect";

export const REDACTED_ANNOTATION = "@ayronforge/envil/redacted";

function withDefaultSchema<S extends Schema.Top>(
  schema: S,
  defaultValue: NonNullable<Schema.Schema.Type<S>>,
) {
  return Schema.UndefinedOr(schema).pipe(
    Schema.decodeTo(Schema.toType(schema), {
      decode: SchemaGetter.transform<S["Type"], S["Type"] | undefined>(
        (value) => value ?? defaultValue,
      ),
      encode: SchemaGetter.transform<S["Type"] | undefined, S["Type"]>((value) => value),
    }),
  );
}

export const withDefault: {
  <S extends Schema.Top>(
    defaultValue: NonNullable<Schema.Schema.Type<S>>,
  ): (schema: S) => ReturnType<typeof withDefaultSchema<S>>;
  <S extends Schema.Top>(
    schema: S,
    defaultValue: NonNullable<Schema.Schema.Type<S>>,
  ): ReturnType<typeof withDefaultSchema<S>>;
} = Function.dual(2, withDefaultSchema);

export const optional = <S extends Schema.Top>(schema: S) => Schema.UndefinedOr(schema);

export const redacted = <S extends Schema.Top>(schema: S) =>
  Schema.RedactedFromValue(schema).annotate({
    [REDACTED_ANNOTATION]: true,
  });

export const requiredString = Schema.String.check(
  Schema.isMinLength(1, {
    identifier: "RequiredString",
    message: "Enter a non-empty value",
  }),
);

const booleanString = Schema.String.check(
  Schema.makeFilter<string>((value) => ["true", "false", "1", "0"].includes(value.toLowerCase()), {
    identifier: "BooleanString",
    message: "Use one of: true, false, 1, or 0",
  }),
);

export const boolean = booleanString.pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform(
      (value: string) => value.toLowerCase() === "true" || value === "1",
    ),
    encode: SchemaGetter.transform((value: boolean) => (value ? "true" : "false")),
  }),
);

const strictNumberFromString = Schema.String.check(
  Schema.makeFilter<string>((value) => value.trim().length > 0 && Number.isFinite(Number(value))),
).pipe(
  Schema.decodeTo(Schema.Number, {
    decode: SchemaGetter.transform((value: string) => Number(value)),
    encode: SchemaGetter.transform((value: number) => String(value)),
  }),
);

export const integer = strictNumberFromString.check(Schema.isInt()).annotate({
  identifier: "Integer",
});

export const number = strictNumberFromString.annotate({
  identifier: "Number",
});

export const positiveNumber = strictNumberFromString.check(Schema.isGreaterThan(0)).annotate({
  identifier: "PositiveNumber",
});

export const nonNegativeNumber = strictNumberFromString
  .check(Schema.isGreaterThanOrEqualTo(0))
  .annotate({
    identifier: "NonNegativeNumber",
  });

export const port = strictNumberFromString
  .check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65535 }))
  .annotate({
    identifier: "Port",
  });

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export const url = Schema.String.check(
  Schema.makeFilter<string>(isHttpUrl, {
    identifier: "Url",
    message: 'Use a full HTTP or HTTPS URL, such as "https://example.com"',
  }),
);
export type Url = Schema.Schema.Type<typeof url>;

function isPostgresUrl(value: string): boolean {
  if (value !== value.trim()) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      parsed.username.length > 0 &&
      parsed.password.length > 0 &&
      parsed.hostname.length > 0 &&
      parsed.port.length > 0 &&
      parsed.pathname.length > 1
    );
  } catch {
    return false;
  }
}

export const postgresUrl = Schema.String.check(
  Schema.makeFilter<string>(isPostgresUrl, {
    identifier: "PostgresUrl",
    message: "Include protocol, username, password, host, port, and database name",
  }),
);
export type PostgresUrl = Schema.Schema.Type<typeof postgresUrl>;

export const redisUrl = Schema.String.check(
  Schema.makeFilter<string>(
    (value) => value.startsWith("redis://") || value.startsWith("rediss://"),
    {
      identifier: "RedisUrl",
      message: "Use a complete Redis connection URL",
    },
  ),
  Schema.isPattern(/^rediss?:\/\/(?:[^:]*:[^@]+@)?[^:]+(?::\d+)?(?:\/\d+)?$/, {
    message: "Check the Redis host, optional credentials, port, and database number",
  }),
);
export type RedisUrl = Schema.Schema.Type<typeof redisUrl>;

export const mongoUrl = Schema.String.check(
  Schema.makeFilter<string>(
    (value) => value.startsWith("mongodb://") || value.startsWith("mongodb+srv://"),
    {
      identifier: "MongoUrl",
      message: "Use a complete MongoDB connection URL",
    },
  ),
  Schema.isPattern(/^mongodb(\+srv)?:\/\/(?:[^:]+:[^@]+@)?[^/]+(?:\/[^?]*)?(?:\?.*)?$/, {
    message: "Check the MongoDB host, optional credentials, database, and query parameters",
  }),
);
export type MongoUrl = Schema.Schema.Type<typeof mongoUrl>;

export const mysqlUrl = Schema.String.check(
  Schema.makeFilter<string>(
    (value) => value.startsWith("mysql://") || value.startsWith("mysqls://"),
    {
      identifier: "MysqlUrl",
      message: "Use a complete MySQL connection URL",
    },
  ),
  Schema.isPattern(/^mysqls?:\/\/[^:]+:[^@]+@[^:]+:\d+\/.+$/, {
    message: "Include username, password, host, port, and database name",
  }),
);
export type MysqlUrl = Schema.Schema.Type<typeof mysqlUrl>;

export const commaSeparated = Schema.String.pipe(
  Schema.decodeTo(Schema.mutable(Schema.Array(Schema.String)), {
    decode: SchemaGetter.transform((value: string) =>
      value.split(",").map((entry) => entry.trim()),
    ),
    encode: SchemaGetter.transform((value: Array<string>) => value.join(",")),
  }),
);

export const commaSeparatedNumbers = Schema.String.check(
  Schema.makeFilter<string>(
    (value) =>
      value
        .split(",")
        .every((entry) => entry.trim().length > 0 && Number.isFinite(Number(entry.trim()))),
    {
      message: 'Use a comma-separated list of numbers, such as "1, 2, 3"',
    },
  ),
).pipe(
  Schema.decodeTo(Schema.mutable(Schema.Array(strictNumberFromString)), {
    decode: SchemaGetter.transform((value: string) =>
      value.split(",").map((entry) => entry.trim()),
    ),
    encode: SchemaGetter.transform((value: Array<string>) => value.join(",")),
  }),
);

export const commaSeparatedUrls = Schema.String.pipe(
  Schema.decodeTo(Schema.mutable(Schema.Array(url)), {
    decode: SchemaGetter.transform((value: string) =>
      value.split(",").map((entry) => entry.trim()),
    ),
    encode: SchemaGetter.transform((value: Array<string>) => value.join(",")),
  }),
);

export const stringEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  Schema.Literals(values);

export const json = <S extends Schema.Top>(schema: S) => Schema.fromJsonString(schema);
