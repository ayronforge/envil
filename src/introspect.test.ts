import { describe, expect, test } from "bun:test";

import { buildEnvExample, examineSchema } from "./introspect.ts";
import {
  boolean,
  optional,
  port,
  redacted,
  requiredString,
  stringEnum,
  url,
  withDefault,
} from "./schemas.ts";

describe("examineSchema", () => {
  test("bare requiredString", () => {
    const result = examineSchema(requiredString);
    expect(result.kind).toBe("requiredString");
    expect(result.optional).toBe(false);
    expect(result.hasDefault).toBe(false);
    expect(result.redacted).toBe(false);
    expect(result.stringEnumValues).toBeUndefined();
  });

  test("optional(requiredString)", () => {
    const result = examineSchema(optional(requiredString));
    expect(result.optional).toBe(true);
    expect(result.hasDefault).toBe(false);
    expect(result.kind).toBe("requiredString");
  });

  test("withDefault(port, 3000)", () => {
    const result = examineSchema(withDefault(port, 3000));
    expect(result.hasDefault).toBe(true);
    expect(result.defaultValue).toBe(3000);
    expect(result.kind).toBe("port");
  });

  test("redacted(requiredString)", () => {
    const result = examineSchema(redacted(requiredString));
    expect(result.redacted).toBe(true);
    expect(result.kind).toBe("requiredString");
  });

  test("stringEnum extracts values", () => {
    const schema = stringEnum(["dev", "staging", "prod"]);
    const result = examineSchema(schema);
    expect(result.kind).toBe("stringEnum");
    expect(result.stringEnumValues).toEqual(["dev", "staging", "prod"]);
    expect(result.placeholder).toBe("dev");
  });

  test("stringEnum with withDefault", () => {
    const schema = withDefault(stringEnum(["a", "b", "c"]), "a");
    const result = examineSchema(schema);
    expect(result.kind).toBe("stringEnum");
    expect(result.stringEnumValues).toEqual(["a", "b", "c"]);
    expect(result.hasDefault).toBe(true);
    expect(result.defaultValue).toBe("a");
  });

  test("stringEnum with optional", () => {
    const schema = optional(stringEnum(["x", "y"]));
    const result = examineSchema(schema);
    expect(result.kind).toBe("stringEnum");
    expect(result.stringEnumValues).toEqual(["x", "y"]);
    expect(result.optional).toBe(true);
  });

  test("stringEnum with redacted", () => {
    const schema = redacted(stringEnum(["a", "b"]));
    const result = examineSchema(schema);
    expect(result.kind).toBe("stringEnum");
    expect(result.stringEnumValues).toEqual(["a", "b"]);
    expect(result.redacted).toBe(true);
  });

  test("non-enum schema has no stringEnumValues", () => {
    const result = examineSchema(boolean);
    expect(result.stringEnumValues).toBeUndefined();
  });

  test("redacted + withDefault + stringEnum", () => {
    const schema = redacted(withDefault(stringEnum(["dev", "prod"]), "dev"));
    const result = examineSchema(schema);
    expect(result.kind).toBe("stringEnum");
    expect(result.stringEnumValues).toEqual(["dev", "prod"]);
    expect(result.redacted).toBe(true);
    expect(result.hasDefault).toBe(true);
    expect(result.defaultValue).toBe("dev");
  });
});

describe("buildEnvExample", () => {
  test("stringEnum emits @type enum directive", () => {
    const output = buildEnvExample({
      server: {
        NODE_ENV: stringEnum(["dev", "staging", "prod"]),
      },
    });
    expect(output).toContain("# @type enum dev,staging,prod");
    expect(output).toContain("NODE_ENV=dev");
  });

  test("stringEnum with withDefault uses default value", () => {
    const output = buildEnvExample({
      server: {
        ENV: withDefault(stringEnum(["a", "b", "c"]), "b"),
      },
    });
    expect(output).toContain("ENV=b");
  });

  test("stringEnum without default uses placeholder (first value)", () => {
    const output = buildEnvExample({
      server: {
        MODE: optional(stringEnum(["fast", "slow"])),
      },
    });
    expect(output).toContain("MODE=fast");
  });

  test("prefix rendered in section headers", () => {
    const output = buildEnvExample({
      prefix: { server: "SRV_", client: "NEXT_PUBLIC_" },
      server: {
        PORT: withDefault(port, 3000),
      },
      client: {
        API: url,
      },
    });
    expect(output).toContain("# @server SRV_");
    expect(output).toContain("# @client NEXT_PUBLIC_");
    expect(output).toContain("SRV_PORT=3000");
    expect(output).toContain("NEXT_PUBLIC_API=https://example.com");
    expect(output).not.toContain("# @prefix");
  });

  test("no-default entries use placeholder", () => {
    const output = buildEnvExample({
      server: {
        SECRET: requiredString,
      },
    });
    expect(output).toContain("SECRET=CHANGE_ME");
  });
});
