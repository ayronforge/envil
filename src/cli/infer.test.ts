import { describe, expect, test } from "bun:test";

import { inferModel } from "./infer.ts";
import type { DotenvDocument, PrefixConfig } from "./types.ts";

const EMPTY_PREFIX: PrefixConfig = { server: "", client: "", shared: "" };

function entry(
  key: string,
  value: string,
  overrides?: Partial<DotenvDocument["entries"][number]>,
): DotenvDocument["entries"][number] {
  return {
    key,
    value,
    line: 1,
    directives: {},
    ...overrides,
  };
}

function inferKind(key: string, value: string) {
  const model = inferModel({ entries: [entry(key, value)] }, { prefix: EMPTY_PREFIX });
  return model.variables[0].kind;
}

function inferVariable(key: string, value: string, overrides?: Partial<DotenvDocument["entries"][number]>) {
  const model = inferModel({ entries: [entry(key, value, overrides)] }, { prefix: EMPTY_PREFIX });
  return model.variables[0];
}

describe("infer", () => {
  describe("schema kind inference", () => {
    test("infers aggressive schema kinds", () => {
      const document: DotenvDocument = {
        entries: [
          entry("DEBUG", "true"),
          entry("RETRIES", "3"),
          entry("THRESHOLD", "3.14"),
          entry("PORT", "3000"),
          entry("APP_URL", "https://example.com"),
          entry("DATABASE_URL", "postgres://user:pass@localhost:5432/db"),
          entry("REDIS_URL", "redis://localhost:6379"),
          entry("MONGO_URL", "mongodb://localhost:27017/app"),
          entry("MYSQL_URL", "mysql://user:pass@localhost:3306/app"),
          entry("NAMES", "a,b,c"),
          entry("NUMBERS", "1,2,3"),
          entry("URLS", "https://a.dev,https://b.dev"),
          entry("JSON_BLOB", '{"ok":true}'),
          entry("FALLBACK", "not-special"),
        ],
      };

      const model = inferModel(document, { prefix: EMPTY_PREFIX });
      const kindByRuntimeKey = Object.fromEntries(
        model.variables.map((variable) => [variable.runtimeKey, variable.kind]),
      );

      expect(kindByRuntimeKey.DEBUG).toBe("boolean");
      expect(kindByRuntimeKey.RETRIES).toBe("integer");
      expect(kindByRuntimeKey.THRESHOLD).toBe("number");
      expect(kindByRuntimeKey.PORT).toBe("port");
      expect(kindByRuntimeKey.APP_URL).toBe("url");
      expect(kindByRuntimeKey.DATABASE_URL).toBe("postgresUrl");
      expect(kindByRuntimeKey.REDIS_URL).toBe("redisUrl");
      expect(kindByRuntimeKey.MONGO_URL).toBe("mongoUrl");
      expect(kindByRuntimeKey.MYSQL_URL).toBe("mysqlUrl");
      expect(kindByRuntimeKey.NAMES).toBe("commaSeparated");
      expect(kindByRuntimeKey.NUMBERS).toBe("commaSeparatedNumbers");
      expect(kindByRuntimeKey.URLS).toBe("commaSeparatedUrls");
      expect(kindByRuntimeKey.JSON_BLOB).toBe("json");
      expect(kindByRuntimeKey.FALLBACK).toBe("requiredString");
    });

    test("empty value infers requiredString", () => {
      expect(inferKind("KEY", "")).toBe("requiredString");
    });

    test("whitespace-only infers requiredString", () => {
      expect(inferKind("KEY", "   ")).toBe("requiredString");
    });

    test("postgresql:// infers postgresUrl", () => {
      expect(inferKind("DB", "postgresql://localhost/db")).toBe("postgresUrl");
    });

    test("rediss:// infers redisUrl", () => {
      expect(inferKind("CACHE", "rediss://localhost:6380")).toBe("redisUrl");
    });

    test("mongodb+srv:// infers mongoUrl", () => {
      expect(inferKind("DB", "mongodb+srv://cluster.example.com/db")).toBe("mongoUrl");
    });

    test("mysqls:// infers mysqlUrl", () => {
      expect(inferKind("DB", "mysqls://user:pass@host/db")).toBe("mysqlUrl");
    });

    test("'0' infers boolean", () => {
      expect(inferKind("FLAG", "0")).toBe("boolean");
    });

    test("'1' infers boolean", () => {
      expect(inferKind("FLAG", "1")).toBe("boolean");
    });

    test("PORT out of range infers integer", () => {
      expect(inferKind("PORT", "99999")).toBe("integer");
    });

    test("negative integer", () => {
      expect(inferKind("OFFSET", "-5")).toBe("integer");
    });

    test("float value", () => {
      expect(inferKind("RATE", "0.75")).toBe("number");
    });

    test("JSON array", () => {
      expect(inferKind("LIST", "[1,2,3]")).toBe("json");
    });

    test("nested JSON object", () => {
      expect(inferKind("CONFIG", '{"a":{"b":1}}')).toBe("json");
    });

    test("invalid JSON with braces falls back to requiredString", () => {
      expect(inferKind("KEY", "{not valid json}")).toBe("requiredString");
    });

    test("ftp:// infers requiredString", () => {
      expect(inferKind("LINK", "ftp://example.com")).toBe("requiredString");
    });

    test("mixed comma-separated values", () => {
      expect(inferKind("TAGS", "a,b,c")).toBe("commaSeparated");
    });

    test("all-number CSV infers commaSeparatedNumbers", () => {
      expect(inferKind("IDS", "10,20,30")).toBe("commaSeparatedNumbers");
    });

    test("all-URL CSV infers commaSeparatedUrls", () => {
      expect(inferKind("HOSTS", "https://a.com,https://b.com")).toBe("commaSeparatedUrls");
    });

    test("leading whitespace trimmed before inference", () => {
      expect(inferKind("KEY", "  true  ")).toBe("boolean");
    });

    test("@type overrides heuristic kind", () => {
      const model = inferModel(
        {
          entries: [
            {
              ...entry("PORT", "3000"),
              directives: { type: "boolean" },
            },
          ],
        },
        { prefix: EMPTY_PREFIX },
      );
      expect(model.variables[0].kind).toBe("boolean");
    });
  });

  describe("bucket resolution", () => {
    test("bucket resolution precedence is inline bucket > section > prefix > fallback", () => {
      const model = inferModel(
        {
          entries: [
            {
              ...entry("NEXT_PUBLIC_TOKEN", "x"),
              sectionBucket: "server",
              directives: { bucket: "shared" },
            },
            {
              ...entry("CLIENT_ONLY", "x"),
              sectionBucket: "client",
            },
            entry("NEXT_PUBLIC_API_URL", "https://example.com"),
            entry("SECRET", "shhh"),
          ],
        },
        {
          prefix: { server: "SRV_", client: "NEXT_PUBLIC_", shared: "SHARED_" },
        },
      );

      const byRuntimeKey = Object.fromEntries(
        model.variables.map((variable) => [variable.runtimeKey, variable]),
      );

      expect(byRuntimeKey.NEXT_PUBLIC_TOKEN.bucket).toBe("shared");
      expect(byRuntimeKey.NEXT_PUBLIC_TOKEN.schemaKey).toBe("NEXT_PUBLIC_TOKEN");
      expect(byRuntimeKey.CLIENT_ONLY.bucket).toBe("client");
      expect(byRuntimeKey.NEXT_PUBLIC_API_URL.bucket).toBe("client");
      expect(byRuntimeKey.NEXT_PUBLIC_API_URL.schemaKey).toBe("API_URL");
      expect(byRuntimeKey.SECRET.bucket).toBe("server");
    });

    test("empty prefix does not match", () => {
      const model = inferModel(
        { entries: [entry("KEY", "value")] },
        { prefix: EMPTY_PREFIX },
      );
      expect(model.variables[0].bucket).toBe("server");
    });

    test("longest prefix wins", () => {
      const model = inferModel(
        { entries: [entry("NEXT_PUBLIC_CLIENT_API", "x")] },
        { prefix: { server: "NEXT_", client: "NEXT_PUBLIC_", shared: "" } },
      );
      expect(model.variables[0].bucket).toBe("client");
      expect(model.variables[0].schemaKey).toBe("CLIENT_API");
    });

    test("prefix equals entire key preserves original key", () => {
      const model = inferModel(
        { entries: [entry("NEXT_PUBLIC_", "x")] },
        { prefix: { server: "", client: "NEXT_PUBLIC_", shared: "" } },
      );
      expect(model.variables[0].schemaKey).toBe("NEXT_PUBLIC_");
    });

    test("no prefix match defaults to server", () => {
      const model = inferModel(
        { entries: [entry("RANDOM_KEY", "x")] },
        { prefix: { server: "", client: "NEXT_PUBLIC_", shared: "" } },
      );
      expect(model.variables[0].bucket).toBe("server");
      expect(model.variables[0].schemaKey).toBe("RANDOM_KEY");
    });
  });

  describe("normalizeDefaultValue", () => {
    test("boolean from string 'true'", () => {
      const v = inferVariable("FLAG", "true");
      expect(v.kind).toBe("boolean");
      expect(v.defaultValue).toBe(true);
    });

    test("boolean from string 'false'", () => {
      const v = inferVariable("FLAG", "false");
      expect(v.defaultValue).toBe(false);
    });

    test("boolean from string '1'", () => {
      const v = inferVariable("FLAG", "1");
      expect(v.defaultValue).toBe(true);
    });

    test("boolean from string '0'", () => {
      const v = inferVariable("FLAG", "0");
      expect(v.defaultValue).toBe(false);
    });

    test("integer truncation", () => {
      const v = inferVariable("COUNT", "3.7", { directives: { type: "integer" } });
      expect(v.defaultValue).toBe(3);
    });

    test("integer NaN defaults to 0", () => {
      const v = inferVariable("COUNT", "abc", { directives: { type: "integer" } });
      expect(v.defaultValue).toBe(0);
    });

    test("number NaN defaults to 0", () => {
      const v = inferVariable("RATE", "abc", { directives: { type: "number" } });
      expect(v.defaultValue).toBe(0);
    });

    test("port out of range defaults to 3000", () => {
      const v = inferVariable("PORT", "99999", { directives: { type: "port" } });
      expect(v.defaultValue).toBe(3000);
    });

    test("port valid value preserved", () => {
      const v = inferVariable("PORT", "8080");
      expect(v.defaultValue).toBe(8080);
    });

    test("commaSeparated from string", () => {
      const v = inferVariable("TAGS", "a,b,c");
      expect(v.defaultValue).toEqual(["a", "b", "c"]);
    });

    test("commaSeparated from string value", () => {
      const v = inferVariable("TAGS", "x,y", {
        directives: { type: "commaSeparated" },
      });
      expect(v.defaultValue).toEqual(["x", "y"]);
    });

    test("commaSeparatedNumbers from string", () => {
      const v = inferVariable("IDS", "1,2,3");
      expect(v.defaultValue).toEqual([1, 2, 3]);
    });

    test("commaSeparatedNumbers filters non-finite", () => {
      const v = inferVariable("IDS", "1,abc,3", {
        directives: { type: "commaSeparatedNumbers" },
      });
      expect(v.defaultValue).toEqual([1, 3]);
    });

    test("commaSeparatedUrls from string", () => {
      const v = inferVariable("HOSTS", "https://a.com,https://b.com");
      expect(v.defaultValue).toEqual(["https://a.com", "https://b.com"]);
    });

    test("json invalid defaults to {}", () => {
      const v = inferVariable("DATA", "not-json", {
        directives: { type: "json" },
      });
      expect(v.defaultValue).toEqual({});
    });

    test("json with value preserved", () => {
      const v = inferVariable("DATA", '{"a":1}');
      expect(v.defaultValue).toEqual({ a: 1 });
    });

    test("@no-default opts out of default", () => {
      const v = inferVariable("KEY", "hello", {
        directives: { hasDefault: false },
      });
      expect(v.hasDefault).toBe(false);
      expect(v.defaultValue).toBeUndefined();
    });

    test("url kind preserves string", () => {
      const v = inferVariable("URL", "https://example.com");
      expect(v.defaultValue).toBe("https://example.com");
    });

    test("stringEnum default preserves string value", () => {
      const v = inferVariable("ENV", "dev", {
        directives: { type: "stringEnum", stringEnumValues: ["dev", "staging", "prod"] },
      });
      expect(v.kind).toBe("stringEnum");
      expect(v.defaultValue).toBe("dev");
      expect(v.hasDefault).toBe(true);
    });

    test("stringEnum with empty value has no default", () => {
      const v = inferVariable("ENV", "", {
        directives: { type: "stringEnum", stringEnumValues: ["dev", "staging"] },
      });
      expect(v.hasDefault).toBe(false);
      expect(v.defaultValue).toBeUndefined();
    });

    test("stringEnum passes through stringEnumValues", () => {
      const v = inferVariable("ENV", "dev", {
        directives: { type: "stringEnum", stringEnumValues: ["dev", "staging", "prod"] },
      });
      expect(v.stringEnumValues).toEqual(["dev", "staging", "prod"]);
    });

    test("non-enum variable has no stringEnumValues", () => {
      const v = inferVariable("KEY", "value");
      expect(v.stringEnumValues).toBeUndefined();
    });

    test("json array value parsed", () => {
      const v = inferVariable("LIST", "[1,2,3]");
      expect(v.defaultValue).toEqual([1, 2, 3]);
    });
  });

  describe("duplicate detection", () => {
    test("same bucket duplicate throws", () => {
      expect(() =>
        inferModel(
          { entries: [entry("KEY", "a", { line: 1 }), entry("KEY", "b", { line: 2 })] },
          { prefix: EMPTY_PREFIX },
        ),
      ).toThrow('Duplicate schema key "KEY" in bucket "server"');
    });

    test("different buckets are OK", () => {
      const model = inferModel(
        {
          entries: [
            entry("KEY", "a", { sectionBucket: "server", line: 1 }),
            entry("KEY", "b", { sectionBucket: "client", line: 2 }),
          ],
        },
        { prefix: EMPTY_PREFIX },
      );
      expect(model.variables).toHaveLength(2);
    });
  });

  describe("sorting", () => {
    test("bucket order: server < client < shared", () => {
      const model = inferModel(
        {
          entries: [
            entry("C", "x", { sectionBucket: "shared" }),
            entry("A", "x", { sectionBucket: "client" }),
            entry("B", "x", { sectionBucket: "server" }),
          ],
        },
        { prefix: EMPTY_PREFIX },
      );

      expect(model.variables.map((v) => v.bucket)).toEqual(["server", "client", "shared"]);
    });

    test("alphabetical within bucket", () => {
      const model = inferModel(
        {
          entries: [
            entry("Z_KEY", "x"),
            entry("A_KEY", "x"),
            entry("M_KEY", "x"),
          ],
        },
        { prefix: EMPTY_PREFIX },
      );

      expect(model.variables.map((v) => v.schemaKey)).toEqual(["A_KEY", "M_KEY", "Z_KEY"]);
    });
  });

  describe("optional and hasDefault flags", () => {
    test("empty value has no default", () => {
      const v = inferVariable("KEY", "");
      expect(v.hasDefault).toBe(false);
      expect(v.optional).toBe(false);
    });

    test("non-empty value has default", () => {
      const v = inferVariable("KEY", "hello");
      expect(v.hasDefault).toBe(true);
    });

    test("@optional directive sets optional", () => {
      const v = inferVariable("KEY", "x", { directives: { optional: true } });
      expect(v.optional).toBe(true);
    });

    test("@redacted directive sets redacted", () => {
      const v = inferVariable("KEY", "x", { directives: { redacted: true } });
      expect(v.redacted).toBe(true);
    });

    test("@no-default on non-empty value removes default", () => {
      const v = inferVariable("PORT", "3000", { directives: { hasDefault: false } });
      expect(v.hasDefault).toBe(false);
      expect(v.defaultValue).toBeUndefined();
    });

    test("@no-default on empty value stays no-default", () => {
      const v = inferVariable("KEY", "", { directives: { hasDefault: false } });
      expect(v.hasDefault).toBe(false);
      expect(v.defaultValue).toBeUndefined();
    });

    test("assigned value is default by default", () => {
      const v = inferVariable("PORT", "8080");
      expect(v.hasDefault).toBe(true);
      expect(v.defaultValue).toBe(8080);
    });

    test("@no-default combined with @type", () => {
      const v = inferVariable("COUNT", "42", { directives: { hasDefault: false, type: "integer" } });
      expect(v.hasDefault).toBe(false);
      expect(v.kind).toBe("integer");
      expect(v.defaultValue).toBeUndefined();
    });
  });

  describe("runtimeEnv", () => {
    test("populates runtimeEnv from entries", () => {
      const model = inferModel(
        { entries: [entry("A", "1"), entry("B", "2")] },
        { prefix: EMPTY_PREFIX },
      );
      expect(model.runtimeEnv).toEqual({ A: "1", B: "2" });
    });
  });
});
