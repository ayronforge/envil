import { describe, expect, test } from "bun:test";

import { Redacted, Schema } from "effect";

import {
  commaSeparated,
  commaSeparatedNumbers,
  commaSeparatedUrls,
  optionalString,
  positiveNumber,
  postgresUrl,
  redacted,
  redisUrl,
  requiredString,
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

  test("produces NaN for non-numeric entries", () => {
    const result = decode(commaSeparatedNumbers, "1,abc,3");
    expect(result[0]).toBe(1);
    expect(result[1]).toBeNaN();
    expect(result[2]).toBe(3);
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

  test("rejects postgres:// prefix", () => {
    expect(() => decode(postgresUrl, "postgres://user:pass@host:5432/db")).toThrow();
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

  test("rejects rediss:// URLs", () => {
    expect(() => decode(redisUrl, "rediss://host:6379")).toThrow();
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
