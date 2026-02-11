import { describe, expect, test } from "bun:test";

import {
  parseBooleanDirective,
  parseLiteral,
  toCodeLiteral,
  toDirectiveLiteral,
  toEnvValueLiteral,
} from "./literals.ts";

describe("parseLiteral", () => {
  test("empty string returns empty string", () => {
    expect(parseLiteral("")).toBe("");
  });

  test("whitespace-only returns empty string", () => {
    expect(parseLiteral("   ")).toBe("");
  });

  test("double-quoted string", () => {
    expect(parseLiteral('"hello"')).toBe("hello");
  });

  test("single-quoted string", () => {
    expect(parseLiteral("'hello'")).toBe("hello");
  });

  test("double-quoted string with escape sequences", () => {
    expect(parseLiteral('"hello\\nworld"')).toBe("hello\nworld");
  });

  test("single-quoted string parsed via JSON after quote replacement", () => {
    expect(parseLiteral("'hello\\nworld'")).toBe("hello\nworld");
  });

  test("single-quoted with invalid JSON falls back to unquoted content", () => {
    expect(parseLiteral("'bad\\xjson'")).toBe("bad\\xjson");
  });

  test("boolean true", () => {
    expect(parseLiteral("true")).toBe(true);
  });

  test("boolean false", () => {
    expect(parseLiteral("false")).toBe(false);
  });

  test("null", () => {
    expect(parseLiteral("null")).toBe(null);
  });

  test("positive integer", () => {
    expect(parseLiteral("42")).toBe(42);
  });

  test("negative integer", () => {
    expect(parseLiteral("-7")).toBe(-7);
  });

  test("positive float", () => {
    expect(parseLiteral("3.14")).toBe(3.14);
  });

  test("explicit positive sign", () => {
    expect(parseLiteral("+10")).toBe(10);
  });

  test("JSON object", () => {
    expect(parseLiteral('{"a":1}')).toEqual({ a: 1 });
  });

  test("JSON array", () => {
    expect(parseLiteral("[1,2,3]")).toEqual([1, 2, 3]);
  });

  test("invalid JSON object falls back to string", () => {
    expect(parseLiteral("{not json}")).toBe("{not json}");
  });

  test("invalid JSON array falls back to string", () => {
    expect(parseLiteral("[not, json")).toBe("[not, json");
  });

  test("plain string passthrough", () => {
    expect(parseLiteral("hello")).toBe("hello");
  });

  test("trims whitespace before parsing", () => {
    expect(parseLiteral("  42  ")).toBe(42);
  });

  test("zero", () => {
    expect(parseLiteral("0")).toBe(0);
  });
});

describe("toCodeLiteral", () => {
  test("string value", () => {
    expect(toCodeLiteral("hello")).toBe('"hello"');
  });

  test("string with escape characters", () => {
    expect(toCodeLiteral('say "hi"')).toBe('"say \\"hi\\""');
  });

  test("integer", () => {
    expect(toCodeLiteral(42)).toBe("42");
  });

  test("float", () => {
    expect(toCodeLiteral(3.14)).toBe("3.14");
  });

  test("boolean true", () => {
    expect(toCodeLiteral(true)).toBe("true");
  });

  test("boolean false", () => {
    expect(toCodeLiteral(false)).toBe("false");
  });

  test("null", () => {
    expect(toCodeLiteral(null)).toBe("null");
  });

  test("undefined", () => {
    expect(toCodeLiteral(undefined)).toBe("undefined");
  });

  test("object", () => {
    expect(toCodeLiteral({ a: 1 })).toBe('{"a":1}');
  });

  test("array", () => {
    expect(toCodeLiteral([1, 2])).toBe("[1,2]");
  });
});

describe("toDirectiveLiteral", () => {
  test("undefined returns empty string", () => {
    expect(toDirectiveLiteral(undefined)).toBe("");
  });

  test("delegates to toCodeLiteral for string", () => {
    expect(toDirectiveLiteral("hello")).toBe('"hello"');
  });

  test("delegates to toCodeLiteral for number", () => {
    expect(toDirectiveLiteral(42)).toBe("42");
  });
});

describe("toEnvValueLiteral", () => {
  test("string passthrough", () => {
    expect(toEnvValueLiteral("hello")).toBe("hello");
  });

  test("number stringified", () => {
    expect(toEnvValueLiteral(42)).toBe("42");
  });

  test("boolean stringified", () => {
    expect(toEnvValueLiteral(true)).toBe("true");
  });

  test("null returns empty string", () => {
    expect(toEnvValueLiteral(null)).toBe("");
  });

  test("undefined returns empty string", () => {
    expect(toEnvValueLiteral(undefined)).toBe("");
  });

  test("object returns JSON", () => {
    expect(toEnvValueLiteral({ a: 1 })).toBe('{"a":1}');
  });

  test("array returns JSON", () => {
    expect(toEnvValueLiteral([1, 2])).toBe("[1,2]");
  });
});

describe("parseBooleanDirective", () => {
  test("undefined returns default true", () => {
    expect(parseBooleanDirective(undefined, true)).toBe(true);
  });

  test("undefined returns default false", () => {
    expect(parseBooleanDirective(undefined, false)).toBe(false);
  });

  test("empty string returns default", () => {
    expect(parseBooleanDirective("", true)).toBe(true);
  });

  test("'true' returns true", () => {
    expect(parseBooleanDirective("true", false)).toBe(true);
  });

  test("'false' returns false", () => {
    expect(parseBooleanDirective("false", true)).toBe(false);
  });

  test("case insensitive TRUE", () => {
    expect(parseBooleanDirective("TRUE", false)).toBe(true);
  });

  test("case insensitive False", () => {
    expect(parseBooleanDirective("False", true)).toBe(false);
  });

  test("invalid value throws", () => {
    expect(() => parseBooleanDirective("yes", true)).toThrow(
      'Invalid boolean directive value "yes"',
    );
  });
});
