import { Schema } from "effect";

export const withDefault = <S extends Schema.Schema.Any>(
  schema: S,
  defaultValue: Schema.Schema.Type<S>,
) =>
  Schema.transform(Schema.UndefinedOr(schema), Schema.typeSchema(schema), {
    decode: (value) => value ?? defaultValue,
    encode: (value) => value,
  });

export const redacted = <S extends Schema.Schema.Any>(schema: S) => Schema.Redacted(schema);

export const requiredString = Schema.String.pipe(Schema.minLength(1));
export const optionalString = Schema.UndefinedOr(Schema.String);
export const positiveNumber = Schema.NumberFromString.pipe(Schema.positive());

export const commaSeparated = Schema.transform(
  Schema.String,
  Schema.mutable(Schema.Array(Schema.String)),
  {
    decode: (s) => s.split(",").map((x) => x.trim()),
    encode: (a) => a.join(","),
  },
);

export const commaSeparatedNumbers = Schema.transform(
  Schema.String,
  Schema.mutable(Schema.Array(Schema.Number)),
  {
    decode: (s) => s.split(",").map((x) => Number(x.trim())),
    encode: (a) => a.join(","),
  },
);

export const url = Schema.String.pipe(
  Schema.filter((s) => {
    try {
      new URL(s);
      return s.startsWith("http://") || s.startsWith("https://");
    } catch {
      return false;
    }
  }),
);
export type Url = Schema.Schema.Type<typeof url>;

export const postgresUrl = Schema.String.pipe(
  Schema.startsWith("postgresql://"),
  Schema.pattern(/^(postgres|postgresql):\/\/[^:]+:[^@]+@[^:]+:\d+\/.+$/),
);
export type PostgresUrl = Schema.Schema.Type<typeof postgresUrl>;

export const redisUrl = Schema.String.pipe(
  Schema.startsWith("redis://"),
  Schema.pattern(/^redis[s]?:\/\/(?:[^:]+:[^@]+@)?[^:]+(?::\d+)?(?:\/\d+)?$/),
);
export type RedisUrl = Schema.Schema.Type<typeof redisUrl>;

export const commaSeparatedUrls = Schema.transform(
  Schema.String,
  Schema.mutable(Schema.Array(url)),
  {
    decode: (s) => s.split(",").map((x) => Schema.decodeUnknownSync(url)(x.trim())),
    encode: (a) => a.join(","),
  },
);
