import { describe, expect, test } from "bun:test";

import { generateEnvTs } from "./generate-env-ts.ts";
import type { InferredModel, InferredVariable, SchemaKind } from "./types.ts";

const EMPTY_PREFIX = { server: "", client: "", shared: "" };

function variable(overrides: Partial<InferredVariable> = {}): InferredVariable {
  return {
    schemaKey: "KEY",
    runtimeKey: "KEY",
    bucket: "server",
    kind: "requiredString",
    optional: false,
    hasDefault: false,
    redacted: false,
    sourceLine: 1,
    ...overrides,
  };
}

function model(variables: InferredVariable[], prefix = EMPTY_PREFIX): InferredModel {
  return { prefix, variables, runtimeEnv: {} };
}

describe("generate-env-ts", () => {
  test("generates deterministic imports, order, and wrapper composition", () => {
    const source = generateEnvTs(
      model(
        [
          variable({
            schemaKey: "PORT",
            runtimeKey: "PORT",
            kind: "port",
            hasDefault: true,
            defaultValue: 3000,
            redacted: true,
          }),
          variable({
            schemaKey: "FEATURE_FLAG",
            runtimeKey: "FEATURE_FLAG",
            bucket: "shared",
            kind: "boolean",
            optional: true,
          }),
          variable({
            schemaKey: "RAW_NUMBER",
            runtimeKey: "RAW_NUMBER",
            kind: "number",
          }),
          variable({
            schemaKey: "META",
            runtimeKey: "META",
            bucket: "shared",
            kind: "json",
          }),
          variable({
            schemaKey: "API_URL",
            runtimeKey: "NEXT_PUBLIC_API_URL",
            bucket: "client",
            kind: "url",
            sourceLine: 5,
          }),
        ],
        { server: "", client: "NEXT_PUBLIC_", shared: "" },
      ),
    );

    expect(source).toContain(
      'import { boolean, createEnv, json, number, optional, port, redacted, url, withDefault } from "@ayronforge/envil";',
    );
    expect(source).toContain('import { Schema } from "effect";');
    expect(source).toContain("PORT: redacted(withDefault(port, 3000))");
    expect(source).toContain("RAW_NUMBER: number");
    expect(source).toContain("FEATURE_FLAG: optional(boolean)");
    expect(source).toContain("META: json(Schema.Unknown)");
    expect(source).toContain("export const envDefinition = {");
    expect(source).toContain("export const env = createEnv(envDefinition);");
  });

  describe("empty model", () => {
    test("produces valid output", () => {
      const source = generateEnvTs(model([]));
      expect(source).toContain("export const envDefinition = {");
      expect(source).toContain("export const env = createEnv(envDefinition);");
    });

    test("does not import Schema", () => {
      const source = generateEnvTs(model([]));
      expect(source).not.toContain("Schema");
    });
  });

  describe("single-bucket models", () => {
    test("server only", () => {
      const source = generateEnvTs(model([variable({ bucket: "server" })]));
      expect(source).toContain("server: {");
      expect(source).toContain("KEY: requiredString,");
    });

    test("client only", () => {
      const source = generateEnvTs(model([variable({ bucket: "client", schemaKey: "API" })]));
      expect(source).toContain("client: {");
      expect(source).toContain("API: requiredString,");
    });

    test("shared only", () => {
      const source = generateEnvTs(model([variable({ bucket: "shared", schemaKey: "NAME" })]));
      expect(source).toContain("shared: {");
      expect(source).toContain("NAME: requiredString,");
    });
  });

  describe("base expressions", () => {
    const kindCases: Array<[SchemaKind, string]> = [
      ["requiredString", "requiredString"],
      ["boolean", "boolean"],
      ["integer", "integer"],
      ["number", "number"],
      ["port", "port"],
      ["url", "url"],
      ["postgresUrl", "postgresUrl"],
      ["redisUrl", "redisUrl"],
      ["mongoUrl", "mongoUrl"],
      ["mysqlUrl", "mysqlUrl"],
      ["commaSeparated", "commaSeparated"],
      ["commaSeparatedNumbers", "commaSeparatedNumbers"],
      ["commaSeparatedUrls", "commaSeparatedUrls"],
      ["json", "json(Schema.Unknown)"],
    ];

    test.each(kindCases)("kind '%s' renders as %s", (kind, expectedExpr) => {
      const source = generateEnvTs(model([variable({ kind })]));
      expect(source).toContain(`KEY: ${expectedExpr},`);
    });
  });

  describe("quoteObjectKey", () => {
    test("valid identifier is unquoted", () => {
      const source = generateEnvTs(model([variable({ schemaKey: "MY_KEY" })]));
      expect(source).toContain("MY_KEY: requiredString,");
    });

    test("hyphenated key is quoted", () => {
      const source = generateEnvTs(model([variable({ schemaKey: "my-key" })]));
      expect(source).toContain('"my-key": requiredString,');
    });

    test("numeric-start key is quoted", () => {
      const source = generateEnvTs(model([variable({ schemaKey: "0KEY" })]));
      expect(source).toContain('"0KEY": requiredString,');
    });

    test("$ prefix key is unquoted", () => {
      const source = generateEnvTs(model([variable({ schemaKey: "$KEY" })]));
      expect(source).toContain("$KEY: requiredString,");
    });
  });

  describe("wrapper composition", () => {
    test("optional-only wraps base", () => {
      const source = generateEnvTs(model([variable({ optional: true })]));
      expect(source).toContain("KEY: optional(requiredString),");
    });

    test("hasDefault suppresses optional", () => {
      const source = generateEnvTs(
        model([variable({ optional: true, hasDefault: true, defaultValue: "x" })]),
      );
      expect(source).toContain('KEY: withDefault(requiredString, "x"),');
      expect(source).not.toContain("optional(");
    });

    test("redacted outermost", () => {
      const source = generateEnvTs(
        model([variable({ redacted: true, hasDefault: true, defaultValue: "x" })]),
      );
      expect(source).toContain('KEY: redacted(withDefault(requiredString, "x")),');
    });

    test("all combined: hasDefault + redacted", () => {
      const source = generateEnvTs(
        model([
          variable({
            kind: "port",
            optional: true,
            hasDefault: true,
            defaultValue: 3000,
            redacted: true,
          }),
        ]),
      );
      expect(source).toContain("KEY: redacted(withDefault(port, 3000)),");
    });

    test("optional + redacted without default", () => {
      const source = generateEnvTs(model([variable({ optional: true, redacted: true })]));
      expect(source).toContain("KEY: redacted(optional(requiredString)),");
    });
  });

  describe("imports", () => {
    test("no Schema import without json kind", () => {
      const source = generateEnvTs(model([variable({ kind: "port" })]));
      expect(source).not.toContain("Schema");
      expect(source).not.toContain('from "effect"');
    });

    test("Schema import present with json kind", () => {
      const source = generateEnvTs(model([variable({ kind: "json" })]));
      expect(source).toContain('import { Schema } from "effect";');
    });

    test("helpers sorted alphabetically", () => {
      const source = generateEnvTs(
        model([
          variable({ kind: "url", schemaKey: "A" }),
          variable({ kind: "boolean", schemaKey: "B" }),
        ]),
      );
      const importMatch = source.match(/import \{ (.+) \} from "@ayronforge\/envil"/);
      const imports = importMatch![1].split(", ");
      expect(imports).toEqual([...imports].sort());
    });
  });

  describe("alphabetical sorting within bucket", () => {
    test("variables sorted by schemaKey", () => {
      const source = generateEnvTs(
        model([
          variable({ schemaKey: "ZEBRA" }),
          variable({ schemaKey: "ALPHA" }),
          variable({ schemaKey: "MIDDLE" }),
        ]),
      );
      const alphaIdx = source.indexOf("ALPHA:");
      const middleIdx = source.indexOf("MIDDLE:");
      const zebraIdx = source.indexOf("ZEBRA:");
      expect(alphaIdx).toBeLessThan(middleIdx);
      expect(middleIdx).toBeLessThan(zebraIdx);
    });
  });

  describe("prefix values", () => {
    test("renders prefix config", () => {
      const source = generateEnvTs(
        model([], { server: "SRV_", client: "NEXT_PUBLIC_", shared: "" }),
      );
      expect(source).toContain('server: "SRV_"');
      expect(source).toContain('client: "NEXT_PUBLIC_"');
      expect(source).toContain('shared: ""');
    });
  });

  describe("stringEnum", () => {
    test("renders stringEnum with values", () => {
      const source = generateEnvTs(
        model([
          variable({
            kind: "stringEnum",
            stringEnumValues: ["dev", "staging", "prod"],
          }),
        ]),
      );
      expect(source).toContain('KEY: stringEnum(["dev", "staging", "prod"]),');
    });

    test("stringEnum imports stringEnum helper", () => {
      const source = generateEnvTs(
        model([
          variable({
            kind: "stringEnum",
            stringEnumValues: ["a", "b"],
          }),
        ]),
      );
      expect(source).toContain("stringEnum");
      const importMatch = source.match(/import \{ (.+) \} from "@ayronforge\/envil"/);
      expect(importMatch![1]).toContain("stringEnum");
    });

    test("stringEnum with withDefault", () => {
      const source = generateEnvTs(
        model([
          variable({
            kind: "stringEnum",
            stringEnumValues: ["dev", "staging", "prod"],
            hasDefault: true,
            defaultValue: "dev",
          }),
        ]),
      );
      expect(source).toContain('KEY: withDefault(stringEnum(["dev", "staging", "prod"]), "dev"),');
    });

    test("stringEnum with optional", () => {
      const source = generateEnvTs(
        model([
          variable({
            kind: "stringEnum",
            stringEnumValues: ["a", "b"],
            optional: true,
          }),
        ]),
      );
      expect(source).toContain('KEY: optional(stringEnum(["a", "b"])),');
    });

    test("stringEnum with redacted", () => {
      const source = generateEnvTs(
        model([
          variable({
            kind: "stringEnum",
            stringEnumValues: ["x", "y"],
            redacted: true,
          }),
        ]),
      );
      expect(source).toContain('KEY: redacted(stringEnum(["x", "y"])),');
    });

    test("stringEnum with all wrappers", () => {
      const source = generateEnvTs(
        model([
          variable({
            kind: "stringEnum",
            stringEnumValues: ["a", "b", "c"],
            hasDefault: true,
            defaultValue: "a",
            redacted: true,
          }),
        ]),
      );
      expect(source).toContain('KEY: redacted(withDefault(stringEnum(["a", "b", "c"]), "a")),');
    });

    test("stringEnum does not import Schema", () => {
      const source = generateEnvTs(
        model([
          variable({
            kind: "stringEnum",
            stringEnumValues: ["a"],
          }),
        ]),
      );
      expect(source).not.toContain('from "effect"');
    });

    test("stringEnum values with special characters", () => {
      const source = generateEnvTs(
        model([
          variable({
            kind: "stringEnum",
            stringEnumValues: ["hello world", 'has"quote'],
          }),
        ]),
      );
      expect(source).toContain('stringEnum(["hello world", "has\\"quote"])');
    });

    test("stringEnum single value", () => {
      const source = generateEnvTs(
        model([
          variable({
            kind: "stringEnum",
            stringEnumValues: ["only"],
          }),
        ]),
      );
      expect(source).toContain('KEY: stringEnum(["only"]),');
    });
  });

  describe("default values", () => {
    test("array default rendered", () => {
      const source = generateEnvTs(
        model([variable({ kind: "commaSeparated", hasDefault: true, defaultValue: ["a", "b"] })]),
      );
      expect(source).toContain('withDefault(commaSeparated, ["a","b"])');
    });

    test("object default rendered", () => {
      const source = generateEnvTs(
        model([variable({ kind: "json", hasDefault: true, defaultValue: { x: 1 } })]),
      );
      expect(source).toContain('withDefault(json(Schema.Unknown), {"x":1})');
    });

    test("string default rendered with quotes", () => {
      const source = generateEnvTs(model([variable({ hasDefault: true, defaultValue: "hello" })]));
      expect(source).toContain('withDefault(requiredString, "hello")');
    });

    test("boolean default rendered", () => {
      const source = generateEnvTs(
        model([variable({ kind: "boolean", hasDefault: true, defaultValue: true })]),
      );
      expect(source).toContain("withDefault(boolean, true)");
    });

    test("numeric default rendered", () => {
      const source = generateEnvTs(
        model([variable({ kind: "port", hasDefault: true, defaultValue: 8080 })]),
      );
      expect(source).toContain("withDefault(port, 8080)");
    });
  });
});
