import { describe, expect, test } from "bun:test";

import { Redacted, Schema } from "effect";

import {
  boolean,
  commaSeparated,
  commaSeparatedNumbers,
  commaSeparatedUrls,
  integer,
  json,
  mongoUrl,
  mysqlUrl,
  nonNegativeNumber,
  optionalString,
  port,
  positiveNumber,
  postgresUrl,
  redacted,
  redisUrl,
  requiredString,
  stringEnum,
  url,
  withDefault,
} from "./schemas.ts";

const decode = <S extends Schema.Schema.Any>(schema: S, value: unknown) =>
  Schema.decodeUnknownSync(schema)(value);

describe("withDefault", () => {
  const schema = withDefault(Schema.String, "fallback");

  test("returns default value when input is undefined", () => {
    expect(decode(schema, undefined)).toBe("fallback");
  });

  test("passes through a valid value", () => {
    expect(decode(schema, "hello")).toBe("hello");
  });

  test("works with numeric schemas (default)", () => {
    const numSchema = withDefault(Schema.Number, 42);
    expect(decode(numSchema, undefined)).toBe(42);
  });

  test("works with numeric schemas (provided)", () => {
    const numSchema = withDefault(Schema.Number, 42);
    expect(decode(numSchema, 7)).toBe(7);
  });

  test("rejects invalid types even with a default set", () => {
    expect(() => decode(schema, 123)).toThrow();
  });

  test("narrows output type to exclude undefined", () => {
    const schema = optionalString.pipe(withDefault("x"));
    type Out = Schema.Schema.Type<typeof schema>;
    const _assert: [Out] extends [string] ? ([string] extends [Out] ? true : never) : never = true;
    expect(_assert).toBe(true);
  });

  test("works piped: Schema.String.pipe(withDefault('fallback'))", () => {
    const piped = Schema.String.pipe(withDefault("fallback"));
    expect(decode(piped, undefined)).toBe("fallback");
    expect(decode(piped, "hello")).toBe("hello");
  });

  test("works piped with port: port.pipe(withDefault(3000))", () => {
    const piped = port.pipe(withDefault(3000));
    expect(decode(piped, undefined)).toBe(3000);
    expect(decode(piped, "8080")).toBe(8080);
  });

  test("works in composition: requiredString.pipe(withDefault('x'), redacted)", () => {
    const composed = requiredString.pipe(withDefault("x"), redacted);
    const result = decode(composed, undefined);
    expect(Redacted.isRedacted(result)).toBe(true);
    expect(Redacted.value(result as Redacted.Redacted<string>)).toBe("x");

    const result2 = decode(composed, "hello");
    expect(Redacted.value(result2 as Redacted.Redacted<string>)).toBe("hello");
  });
});

describe("redacted", () => {
  const schema = redacted(Schema.String);

  test("wraps valid string in Redacted", () => {
    const result = decode(schema, "secret");
    expect(Redacted.isRedacted(result)).toBe(true);
    expect(Redacted.value(result as Redacted.Redacted<string>)).toBe("secret");
  });

  test("rejects invalid input", () => {
    expect(() => decode(schema, 123)).toThrow();
  });
});

describe("requiredString", () => {
  test("accepts non-empty strings", () => {
    expect(decode(requiredString, "hello")).toBe("hello");
  });

  test("rejects empty string", () => {
    expect(() => decode(requiredString, "")).toThrow();
  });

  test("rejects undefined", () => {
    expect(() => decode(requiredString, undefined)).toThrow();
  });

  test("rejects non-strings", () => {
    expect(() => decode(requiredString, 42)).toThrow();
  });
});

describe("optionalString", () => {
  test("accepts strings", () => {
    expect(decode(optionalString, "hello")).toBe("hello");
  });

  test("accepts undefined", () => {
    expect(decode(optionalString, undefined)).toBeUndefined();
  });

  test("rejects null", () => {
    expect(() => decode(optionalString, null)).toThrow();
  });

  test("rejects numbers", () => {
    expect(() => decode(optionalString, 42)).toThrow();
  });
});

describe("positiveNumber", () => {
  test("decodes positive integer string to number", () => {
    expect(decode(positiveNumber, "5")).toBe(5);
  });

  test("decodes positive float string to number", () => {
    expect(decode(positiveNumber, "3.14")).toBe(3.14);
  });

  test("rejects '0'", () => {
    expect(() => decode(positiveNumber, "0")).toThrow();
  });

  test("rejects negative strings", () => {
    expect(() => decode(positiveNumber, "-1")).toThrow();
  });

  test("rejects non-numeric strings", () => {
    expect(() => decode(positiveNumber, "abc")).toThrow();
  });

  test("rejects undefined", () => {
    expect(() => decode(positiveNumber, undefined)).toThrow();
  });
});

describe("commaSeparated", () => {
  test("splits comma-separated string into trimmed array", () => {
    expect(decode(commaSeparated, "a, b , c")).toEqual(["a", "b", "c"]);
  });

  test("handles single value (no commas)", () => {
    expect(decode(commaSeparated, "single")).toEqual(["single"]);
  });

  test("rejects non-strings", () => {
    expect(() => decode(commaSeparated, 123)).toThrow();
  });
});

describe("commaSeparatedNumbers", () => {
  test("splits and converts to number array", () => {
    expect(decode(commaSeparatedNumbers, "1, 2, 3")).toEqual([1, 2, 3]);
  });

  test("handles floats", () => {
    expect(decode(commaSeparatedNumbers, "1.5, 2.5")).toEqual([1.5, 2.5]);
  });

  test("handles single value", () => {
    expect(decode(commaSeparatedNumbers, "42")).toEqual([42]);
  });

  test("rejects non-numeric entries", () => {
    expect(() => decode(commaSeparatedNumbers, "1,abc,3")).toThrow('"abc" is not a valid number');
  });
});

describe("url", () => {
  test("accepts http:// URLs", () => {
    expect(decode(url, "http://example.com")).toBe("http://example.com");
  });

  test("accepts https:// URLs", () => {
    expect(decode(url, "https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
  });

  test("accepts URLs with port", () => {
    expect(decode(url, "http://localhost:3000")).toBe("http://localhost:3000");
  });

  test("rejects ftp:// URLs", () => {
    expect(() => decode(url, "ftp://example.com")).toThrow();
  });

  test("rejects no-protocol strings", () => {
    expect(() => decode(url, "example.com")).toThrow();
  });

  test("rejects empty string", () => {
    expect(() => decode(url, "")).toThrow();
  });
});

describe("postgresUrl", () => {
  test("accepts valid postgresql:// URL", () => {
    const pgUrl = "postgresql://user:pass@host:5432/db";
    expect(decode(postgresUrl, pgUrl)).toBe(pgUrl);
  });

  test("rejects missing port", () => {
    expect(() => decode(postgresUrl, "postgresql://user:pass@host/db")).toThrow();
  });

  test("rejects missing db name", () => {
    expect(() => decode(postgresUrl, "postgresql://user:pass@host:5432")).toThrow();
  });

  test("rejects missing password", () => {
    expect(() => decode(postgresUrl, "postgresql://user@host:5432/db")).toThrow();
  });

  test("accepts postgres:// prefix", () => {
    const pgUrl = "postgres://user:pass@host:5432/db";
    expect(decode(postgresUrl, pgUrl)).toBe(pgUrl);
  });

  test("rejects other protocols", () => {
    expect(() => decode(postgresUrl, "mysql://user:pass@host:3306/db")).toThrow();
  });
});

describe("redisUrl", () => {
  test("accepts redis:// URL with auth, port, and db", () => {
    const rUrl = "redis://user:pass@host:6379/0";
    expect(decode(redisUrl, rUrl)).toBe(rUrl);
  });

  test("accepts redis:// URL without auth", () => {
    const rUrl = "redis://host:6379/0";
    expect(decode(redisUrl, rUrl)).toBe(rUrl);
  });

  test("accepts redis:// URL with port only", () => {
    const rUrl = "redis://host:6379";
    expect(decode(redisUrl, rUrl)).toBe(rUrl);
  });

  test("accepts rediss:// URLs (TLS)", () => {
    expect(decode(redisUrl, "rediss://host:6379")).toBe("rediss://host:6379");
  });

  test("accepts rediss:// URL with auth", () => {
    const rUrl = "rediss://user:pass@host:6379/0";
    expect(decode(redisUrl, rUrl)).toBe(rUrl);
  });

  test("rejects other protocols", () => {
    expect(() => decode(redisUrl, "http://host:6379")).toThrow();
  });
});

describe("commaSeparatedUrls", () => {
  test("splits and validates multiple URLs", () => {
    const result = decode(commaSeparatedUrls, "http://a.com, https://b.com");
    expect(result).toEqual(["http://a.com", "https://b.com"]);
  });

  test("throws when any URL is invalid", () => {
    expect(() => decode(commaSeparatedUrls, "http://a.com, not-a-url")).toThrow();
  });
});

describe("boolean", () => {
  test('accepts "true"', () => {
    expect(decode(boolean, "true")).toBe(true);
  });

  test('accepts "TRUE"', () => {
    expect(decode(boolean, "TRUE")).toBe(true);
  });

  test('accepts "True"', () => {
    expect(decode(boolean, "True")).toBe(true);
  });

  test('accepts "false"', () => {
    expect(decode(boolean, "false")).toBe(false);
  });

  test('accepts "FALSE"', () => {
    expect(decode(boolean, "FALSE")).toBe(false);
  });

  test('accepts "False"', () => {
    expect(decode(boolean, "False")).toBe(false);
  });

  test('accepts "1"', () => {
    expect(decode(boolean, "1")).toBe(true);
  });

  test('accepts "0"', () => {
    expect(decode(boolean, "0")).toBe(false);
  });

  test('rejects "yes"', () => {
    expect(() => decode(boolean, "yes")).toThrow();
  });

  test('rejects "no"', () => {
    expect(() => decode(boolean, "no")).toThrow();
  });

  test('rejects "2"', () => {
    expect(() => decode(boolean, "2")).toThrow();
  });

  test("rejects empty string", () => {
    expect(() => decode(boolean, "")).toThrow();
  });

  test("rejects undefined", () => {
    expect(() => decode(boolean, undefined)).toThrow();
  });
});

describe("integer", () => {
  test('accepts "1"', () => {
    expect(decode(integer, "1")).toBe(1);
  });

  test('accepts "0"', () => {
    expect(decode(integer, "0")).toBe(0);
  });

  test('accepts "-5"', () => {
    expect(decode(integer, "-5")).toBe(-5);
  });

  test('accepts "100"', () => {
    expect(decode(integer, "100")).toBe(100);
  });

  test('rejects "3.14"', () => {
    expect(() => decode(integer, "3.14")).toThrow();
  });

  test('rejects "abc"', () => {
    expect(() => decode(integer, "abc")).toThrow();
  });

  test("rejects empty string", () => {
    expect(() => decode(integer, "")).toThrow();
  });

  test("rejects undefined", () => {
    expect(() => decode(integer, undefined)).toThrow();
  });
});

describe("nonNegativeNumber", () => {
  test('accepts "0"', () => {
    expect(decode(nonNegativeNumber, "0")).toBe(0);
  });

  test('accepts "1"', () => {
    expect(decode(nonNegativeNumber, "1")).toBe(1);
  });

  test('accepts "3.14"', () => {
    expect(decode(nonNegativeNumber, "3.14")).toBe(3.14);
  });

  test('rejects "-1"', () => {
    expect(() => decode(nonNegativeNumber, "-1")).toThrow();
  });

  test('rejects "-0.5"', () => {
    expect(() => decode(nonNegativeNumber, "-0.5")).toThrow();
  });

  test('rejects "abc"', () => {
    expect(() => decode(nonNegativeNumber, "abc")).toThrow();
  });
});

describe("port", () => {
  test('accepts "1"', () => {
    expect(decode(port, "1")).toBe(1);
  });

  test('accepts "80"', () => {
    expect(decode(port, "80")).toBe(80);
  });

  test('accepts "443"', () => {
    expect(decode(port, "443")).toBe(443);
  });

  test('accepts "8080"', () => {
    expect(decode(port, "8080")).toBe(8080);
  });

  test('accepts "65535"', () => {
    expect(decode(port, "65535")).toBe(65535);
  });

  test('rejects "0"', () => {
    expect(() => decode(port, "0")).toThrow();
  });

  test('rejects "65536"', () => {
    expect(() => decode(port, "65536")).toThrow();
  });

  test('rejects "-1"', () => {
    expect(() => decode(port, "-1")).toThrow();
  });

  test('rejects "3.14"', () => {
    expect(() => decode(port, "3.14")).toThrow();
  });

  test('rejects "abc"', () => {
    expect(() => decode(port, "abc")).toThrow();
  });
});

describe("stringEnum", () => {
  const nodeEnv = stringEnum(["development", "staging", "production"]);

  test("accepts valid enum value", () => {
    expect(decode(nodeEnv, "development")).toBe("development");
  });

  test("accepts another valid enum value", () => {
    expect(decode(nodeEnv, "production")).toBe("production");
  });

  test("rejects invalid value", () => {
    expect(() => decode(nodeEnv, "test")).toThrow();
  });

  test("rejects empty string", () => {
    expect(() => decode(nodeEnv, "")).toThrow();
  });

  test("rejects undefined", () => {
    expect(() => decode(nodeEnv, undefined)).toThrow();
  });
});

describe("json", () => {
  const featureFlags = json(Schema.Struct({ darkMode: Schema.Boolean }));

  test("accepts valid JSON matching schema", () => {
    expect(decode(featureFlags, '{"darkMode":true}')).toEqual({ darkMode: true });
  });

  test("rejects invalid JSON", () => {
    expect(() => decode(featureFlags, "not-json")).toThrow();
  });

  test("rejects JSON not matching schema", () => {
    expect(() => decode(featureFlags, '{"darkMode":"yes"}')).toThrow();
  });

  test("rejects undefined", () => {
    expect(() => decode(featureFlags, undefined)).toThrow();
  });
});

describe("mongoUrl", () => {
  test("accepts mongodb:// URL", () => {
    const mUrl = "mongodb://user:pass@host:27017/db";
    expect(decode(mongoUrl, mUrl)).toBe(mUrl);
  });

  test("accepts mongodb+srv:// URL", () => {
    const mUrl = "mongodb+srv://user:pass@host/db";
    expect(decode(mongoUrl, mUrl)).toBe(mUrl);
  });

  test("accepts mongodb:// without auth", () => {
    const mUrl = "mongodb://host:27017/db";
    expect(decode(mongoUrl, mUrl)).toBe(mUrl);
  });

  test("accepts mongodb:// with query params", () => {
    const mUrl = "mongodb://user:pass@host:27017/db?retryWrites=true";
    expect(decode(mongoUrl, mUrl)).toBe(mUrl);
  });

  test("rejects other protocols", () => {
    expect(() => decode(mongoUrl, "postgres://user:pass@host:5432/db")).toThrow();
  });

  test("rejects empty string", () => {
    expect(() => decode(mongoUrl, "")).toThrow();
  });
});

describe("mysqlUrl", () => {
  test("accepts mysql:// URL", () => {
    const mUrl = "mysql://user:pass@host:3306/db";
    expect(decode(mysqlUrl, mUrl)).toBe(mUrl);
  });

  test("accepts mysqls:// URL", () => {
    const mUrl = "mysqls://user:pass@host:3306/db";
    expect(decode(mysqlUrl, mUrl)).toBe(mUrl);
  });

  test("rejects missing port", () => {
    expect(() => decode(mysqlUrl, "mysql://user:pass@host/db")).toThrow();
  });

  test("rejects other protocols", () => {
    expect(() => decode(mysqlUrl, "postgres://user:pass@host:3306/db")).toThrow();
  });

  test("rejects empty string", () => {
    expect(() => decode(mysqlUrl, "")).toThrow();
  });
});
