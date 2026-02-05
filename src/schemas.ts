import { Function, Schema } from "effect";

export const withDefault: {
	<S extends Schema.Schema.Any>(
		defaultValue: Schema.Schema.Type<S>,
	): (schema: S) => Schema.transform<Schema.UndefinedOr<S>, Schema.SchemaClass<Schema.Schema.Type<S>>>;
	<S extends Schema.Schema.Any>(
		schema: S,
		defaultValue: Schema.Schema.Type<S>,
	): Schema.transform<Schema.UndefinedOr<S>, Schema.SchemaClass<Schema.Schema.Type<S>>>;
} = Function.dual(
	2,
	<S extends Schema.Schema.Any>(schema: S, defaultValue: Schema.Schema.Type<S>) =>
		Schema.transform(Schema.UndefinedOr(schema), Schema.typeSchema(schema), {
			decode: (value) => value ?? defaultValue,
			encode: (value) => value,
		}),
);

export const redacted = <S extends Schema.Schema.Any>(schema: S) => Schema.Redacted(schema);

export const requiredString = Schema.String.pipe(Schema.minLength(1)).annotations({
	identifier: "RequiredString",
});
export const optionalString = Schema.UndefinedOr(Schema.String);
export const positiveNumber = Schema.NumberFromString.pipe(Schema.positive()).annotations({
	identifier: "PositiveNumber",
});

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
		decode: (s) =>
			s.split(",").map((x) => {
				const n = Number(x.trim());
				if (Number.isNaN(n)) throw new Error(`"${x.trim()}" is not a valid number`);
				return n;
			}),
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
	}, { identifier: "Url", message: () => "Expected a valid HTTP or HTTPS URL" }),
);
export type Url = Schema.Schema.Type<typeof url>;

export const postgresUrl = Schema.String.pipe(
	Schema.filter((s) => s.startsWith("postgres://") || s.startsWith("postgresql://"), {
		identifier: "PostgresUrl",
		message: () => "Expected a valid PostgreSQL connection URL",
	}),
	Schema.pattern(/^(postgres|postgresql):\/\/[^:]+:[^@]+@[^:]+:\d+\/.+$/),
);
export type PostgresUrl = Schema.Schema.Type<typeof postgresUrl>;

export const redisUrl = Schema.String.pipe(
	Schema.filter((s) => s.startsWith("redis://") || s.startsWith("rediss://"), {
		identifier: "RedisUrl",
		message: () => "Expected a valid Redis connection URL",
	}),
	Schema.pattern(/^rediss?:\/\/(?:[^:]+:[^@]+@)?[^:]+(?::\d+)?(?:\/\d+)?$/),
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
);

export const integer = Schema.NumberFromString.pipe(Schema.int()).annotations({
	identifier: "Integer",
});

export const nonNegativeNumber = Schema.NumberFromString.pipe(Schema.nonNegative()).annotations({
	identifier: "NonNegativeNumber",
});

export const port = Schema.NumberFromString.pipe(Schema.int(), Schema.between(1, 65535)).annotations(
	{ identifier: "Port" },
);

export const stringEnum = <T extends readonly [string, ...string[]]>(values: T) =>
	Schema.Literal(...values);

export const json = <S extends Schema.Schema.Any>(schema: S) => Schema.parseJson(schema);

export const mongoUrl = Schema.String.pipe(
	Schema.filter((s) => s.startsWith("mongodb://") || s.startsWith("mongodb+srv://"), {
		identifier: "MongoUrl",
		message: () => "Expected a valid MongoDB connection URL",
	}),
	Schema.pattern(/^mongodb(\+srv)?:\/\/(?:[^:]+:[^@]+@)?[^/]+(?:\/[^?]*)?(?:\?.*)?$/),
);
export type MongoUrl = Schema.Schema.Type<typeof mongoUrl>;

export const mysqlUrl = Schema.String.pipe(
	Schema.filter((s) => s.startsWith("mysql://") || s.startsWith("mysqls://"), {
		identifier: "MysqlUrl",
		message: () => "Expected a valid MySQL connection URL",
	}),
	Schema.pattern(/^mysqls?:\/\/[^:]+:[^@]+@[^:]+:\d+\/.+$/),
);
export type MysqlUrl = Schema.Schema.Type<typeof mysqlUrl>;
