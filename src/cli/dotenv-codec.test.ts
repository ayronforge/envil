import { describe, expect, test } from "bun:test";

import { decodeDotenvText, encodeDotenvText } from "./dotenv-codec.ts";
import type { SchemaKind } from "./types.ts";

describe("dotenv-codec", () => {
  describe("parsing", () => {
    test("decodes directives, sections, and assignments", () => {
      const source = [
        "# @client",
        "# @type boolean",
        "# @optional",
        "NEXT_PUBLIC_FEATURE=true # @redacted",
        "",
        "# @server",
        "# @bucket shared",
        "APP_NAME=envil",
        "",
      ].join("\n");

      const parsed = decodeDotenvText(source);
      expect(parsed.entries).toHaveLength(2);

      expect(parsed.entries[0]).toMatchObject({
        key: "NEXT_PUBLIC_FEATURE",
        value: "true",
        sectionBucket: "client",
        directives: {
          type: "boolean",
          optional: true,
          redacted: true,
        },
      });

      expect(parsed.entries[1]).toMatchObject({
        key: "APP_NAME",
        value: "envil",
        sectionBucket: "server",
        directives: {
          bucket: "shared",
        },
      });
    });

    test("empty input returns no entries", () => {
      const parsed = decodeDotenvText("");
      expect(parsed.entries).toHaveLength(0);
    });

    test("blank lines and non-directive comments are skipped", () => {
      const source = ["", "# just a comment", "", "KEY=value", ""].join("\n");
      const parsed = decodeDotenvText(source);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0].key).toBe("KEY");
    });

    test("multiple sections", () => {
      const source = [
        "# @server",
        "A=1",
        "# @client",
        "B=2",
        "# @shared",
        "C=3",
      ].join("\n");

      const parsed = decodeDotenvText(source);
      expect(parsed.entries[0].sectionBucket).toBe("server");
      expect(parsed.entries[1].sectionBucket).toBe("client");
      expect(parsed.entries[2].sectionBucket).toBe("shared");
    });

    test("section prefix directives", () => {
      const source = [
        "# @server SRV_",
        "KEY=value",
        "# @client NEXT_PUBLIC_",
        "KEY2=value2",
      ].join("\n");

      const parsed = decodeDotenvText(source);
      expect(parsed.prefix).toEqual({
        server: "SRV_",
        client: "NEXT_PUBLIC_",
      });
    });

    test("inline directives", () => {
      const source = "KEY=value # @redacted @type port\n";
      const parsed = decodeDotenvText(source);
      expect(parsed.entries[0].directives).toMatchObject({
        redacted: true,
        type: "port",
      });
    });

    test("double-quoted value", () => {
      const parsed = decodeDotenvText('KEY="hello world"\n');
      expect(parsed.entries[0].value).toBe("hello world");
    });

    test("single-quoted value", () => {
      const parsed = decodeDotenvText("KEY='hello world'\n");
      expect(parsed.entries[0].value).toBe("hello world");
    });

    test("inline comment separated from value", () => {
      const parsed = decodeDotenvText("KEY=value # just a comment\n");
      expect(parsed.entries[0].value).toBe("value");
    });

    test("hash inside double quotes is not a comment", () => {
      const parsed = decodeDotenvText('KEY="has#hash"\n');
      expect(parsed.entries[0].value).toBe("has#hash");
    });

    test("empty value", () => {
      const parsed = decodeDotenvText("KEY=\n");
      expect(parsed.entries[0].value).toBe("");
    });

    test("handles CR+LF line endings", () => {
      const source = "# @server\r\nKEY=value\r\n";
      const parsed = decodeDotenvText(source);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0].sectionBucket).toBe("server");
    });

    test("malformed assignment throws", () => {
      expect(() => decodeDotenvText("NOT_AN_ASSIGNMENT\n")).toThrow("Malformed assignment");
    });

    test("section directive inline throws", () => {
      expect(() => decodeDotenvText("KEY=value # @server\n")).toThrow(
        "Section directives are not allowed inline",
      );
    });

    test("unknown directive throws", () => {
      expect(() => decodeDotenvText("# @unknown\nKEY=value\n")).toThrow(
        'Unknown directive "@unknown"',
      );
    });

    test("@type without value throws", () => {
      expect(() => decodeDotenvText("# @type\nKEY=value\n")).toThrow(
        '"@type" requires a value',
      );
    });

    test("@no-default sets hasDefault false", () => {
      const parsed = decodeDotenvText("# @no-default\nKEY=value\n");
      expect(parsed.entries[0].directives).toMatchObject({
        hasDefault: false,
      });
    });

    test("@no-default inline", () => {
      const parsed = decodeDotenvText("KEY=value # @no-default\n");
      expect(parsed.entries[0].directives.hasDefault).toBe(false);
    });

    test("@no-default combined with other directives", () => {
      const parsed = decodeDotenvText("# @no-default @type integer\nKEY=42\n");
      expect(parsed.entries[0].directives.hasDefault).toBe(false);
      expect(parsed.entries[0].directives.type).toBe("integer");
    });

    test("@optional false", () => {
      const parsed = decodeDotenvText("# @optional false\nKEY=value\n");
      expect(parsed.entries[0].directives.optional).toBe(false);
    });

    test("@redacted false", () => {
      const parsed = decodeDotenvText("# @redacted false\nKEY=value\n");
      expect(parsed.entries[0].directives.redacted).toBe(false);
    });

    test("@bucket with valid value", () => {
      const parsed = decodeDotenvText("# @bucket client\nKEY=value\n");
      expect(parsed.entries[0].directives.bucket).toBe("client");
    });

    test("@bucket with invalid value throws", () => {
      expect(() => decodeDotenvText("# @bucket invalid\nKEY=value\n")).toThrow(
        'Invalid bucket "invalid"',
      );
    });

    test("@bucket without value throws", () => {
      expect(() => decodeDotenvText("# @bucket\nKEY=value\n")).toThrow(
        '"@bucket" requires a value',
      );
    });

    test("@server with value sets section and prefix", () => {
      const parsed = decodeDotenvText("# @server SRV_\nKEY=value\n");
      expect(parsed.entries[0].sectionBucket).toBe("server");
      expect(parsed.prefix).toEqual({ server: "SRV_" });
    });

    test("@client with value sets section and prefix", () => {
      const parsed = decodeDotenvText("# @client NEXT_PUBLIC_\nKEY=value\n");
      expect(parsed.entries[0].sectionBucket).toBe("client");
      expect(parsed.prefix).toEqual({ client: "NEXT_PUBLIC_" });
    });

    test("@shared with value sets section and prefix", () => {
      const parsed = decodeDotenvText("# @shared SHARED_\nKEY=value\n");
      expect(parsed.entries[0].sectionBucket).toBe("shared");
      expect(parsed.prefix).toEqual({ shared: "SHARED_" });
    });

    test("section without prefix does not add to prefix map", () => {
      const parsed = decodeDotenvText("# @server\nKEY=value\n");
      expect(parsed.prefix).toBeUndefined();
    });

    test("multiple sections with prefixes", () => {
      const source = [
        "# @server SRV_",
        "A=1",
        "# @client CLI_",
        "B=2",
        "# @shared S_",
        "C=3",
      ].join("\n");
      const parsed = decodeDotenvText(source);
      expect(parsed.prefix).toEqual({ server: "SRV_", client: "CLI_", shared: "S_" });
      expect(parsed.entries[0].sectionBucket).toBe("server");
      expect(parsed.entries[1].sectionBucket).toBe("client");
      expect(parsed.entries[2].sectionBucket).toBe("shared");
    });

    test("@type enum parses comma-separated values", () => {
      const parsed = decodeDotenvText("# @type enum dev,staging,prod\nNODE_ENV=dev\n");
      expect(parsed.entries[0].directives.type).toBe("stringEnum");
      expect(parsed.entries[0].directives.stringEnumValues).toEqual(["dev", "staging", "prod"]);
    });

    test("@type enum trims whitespace around values", () => {
      const parsed = decodeDotenvText("# @type enum dev , staging , prod\nNODE_ENV=dev\n");
      expect(parsed.entries[0].directives.stringEnumValues).toEqual(["dev", "staging", "prod"]);
    });

    test("@type enum single value", () => {
      const parsed = decodeDotenvText("# @type enum only\nKEY=only\n");
      expect(parsed.entries[0].directives.type).toBe("stringEnum");
      expect(parsed.entries[0].directives.stringEnumValues).toEqual(["only"]);
    });

    test("@type enum inline", () => {
      const parsed = decodeDotenvText("NODE_ENV=dev # @type enum dev,staging,prod\n");
      expect(parsed.entries[0].directives.type).toBe("stringEnum");
      expect(parsed.entries[0].directives.stringEnumValues).toEqual(["dev", "staging", "prod"]);
    });

    test("@type enum without values throws", () => {
      expect(() => decodeDotenvText("# @type enum\nKEY=value\n")).toThrow(
        '"@type enum" requires comma-separated values',
      );
    });

    test("@type enum with only spaces throws", () => {
      expect(() => decodeDotenvText("# @type enum   \nKEY=value\n")).toThrow(
        '"@type enum" requires comma-separated values',
      );
    });

    test("@type enum combined with @no-default", () => {
      const parsed = decodeDotenvText("# @type enum a,b,c @no-default\nKEY=a\n");
      expect(parsed.entries[0].directives.type).toBe("stringEnum");
      expect(parsed.entries[0].directives.stringEnumValues).toEqual(["a", "b", "c"]);
      expect(parsed.entries[0].directives.hasDefault).toBe(false);
    });

    test("throws on malformed @type value", () => {
      expect(() => decodeDotenvText("# @type nope\nKEY=value\n")).toThrow(
        'Invalid @type value "nope"',
      );
    });
  });

  describe("schema kind aliases", () => {
    const aliasCases: Array<[string, SchemaKind]> = [
      ["string", "requiredString"],
      ["requiredString", "requiredString"],
      ["bool", "boolean"],
      ["boolean", "boolean"],
      ["int", "integer"],
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
      ["json", "json"],
      ["json(Schema.Unknown)", "json"],
    ];

    test.each(aliasCases)("alias '%s' resolves to %s", (alias, expected) => {
      const parsed = decodeDotenvText(`# @type ${alias}\nKEY=value\n`);
      expect(parsed.entries[0].directives.type).toBe(expected);
    });
  });

  describe("encoding", () => {
    test("encodes grouped output with deterministic hint lines", () => {
      const output = encodeDotenvText({
        entries: [
          {
            key: "PORT",
            value: "3000",
            line: 1,
            sectionBucket: "server",
            directives: {
              type: "port",
              bucket: "server",
              optional: false,
              hasDefault: true,
              redacted: false,
            },
          },
        ],
      });

      expect(output).toContain("# @server");
      expect(output).toContain("# @client");
      expect(output).toContain("# @shared");
      expect(output).not.toContain("# @type");
      expect(output).not.toContain("# @bucket");
      expect(output).not.toContain("# @no-default");
      expect(output).not.toContain("# @optional");
      expect(output).not.toContain("# @redacted");
      expect(output).toContain("PORT=3000");
    });

    test("empty entries produces section headers only", () => {
      const output = encodeDotenvText({ entries: [] });
      expect(output).toContain("# @server");
      expect(output).toContain("# @client");
      expect(output).toContain("# @shared");
    });

    test("prefix rendered in section headers", () => {
      const output = encodeDotenvText({
        entries: [{ key: "K", value: "v", line: 1, directives: {} }],
        prefix: { server: "SRV_", client: "NEXT_PUBLIC_" },
      });
      expect(output).toContain("# @server SRV_");
      expect(output).toContain("# @client NEXT_PUBLIC_");
    });

    test("entries grouped by bucket", () => {
      const output = encodeDotenvText({
        entries: [
          { key: "A", value: "1", line: 1, directives: { bucket: "client" } },
          { key: "B", value: "2", line: 2, directives: { bucket: "server" } },
        ],
      });

      const serverIdx = output.indexOf("# @server");
      const clientIdx = output.indexOf("# @client");
      const bIdx = output.indexOf("B=2");
      const aIdx = output.indexOf("A=1");
      expect(bIdx).toBeGreaterThan(serverIdx);
      expect(bIdx).toBeLessThan(clientIdx);
      expect(aIdx).toBeGreaterThan(clientIdx);
    });

    test("optional flag renders # @optional", () => {
      const output = encodeDotenvText({
        entries: [
          { key: "K", value: "v", line: 1, directives: { optional: true } },
        ],
      });
      expect(output).toContain("# @optional");
    });

    test("redacted flag renders # @redacted", () => {
      const output = encodeDotenvText({
        entries: [
          { key: "K", value: "v", line: 1, directives: { redacted: true } },
        ],
      });
      expect(output).toContain("# @redacted");
    });

    test("values with spaces get quoted", () => {
      const output = encodeDotenvText({
        entries: [{ key: "K", value: "hello world", line: 1, directives: {} }],
      });
      expect(output).toContain('K="hello world"');
    });

    test("values with hash get quoted", () => {
      const output = encodeDotenvText({
        entries: [{ key: "K", value: "has#hash", line: 1, directives: {} }],
      });
      expect(output).toContain('K="has#hash"');
    });

    test("empty value renders as KEY=", () => {
      const output = encodeDotenvText({
        entries: [{ key: "K", value: "", line: 1, directives: {} }],
      });
      expect(output).toContain("K=");
      expect(output).not.toContain('K=""');
    });

    test("sort by line then key", () => {
      const output = encodeDotenvText({
        entries: [
          { key: "B", value: "2", line: 1, directives: {} },
          { key: "A", value: "1", line: 1, directives: {} },
          { key: "C", value: "3", line: 2, directives: {} },
        ],
      });
      const aIdx = output.indexOf("A=1");
      const bIdx = output.indexOf("B=2");
      const cIdx = output.indexOf("C=3");
      expect(aIdx).toBeLessThan(bIdx);
      expect(bIdx).toBeLessThan(cIdx);
    });

    test("invalid document throws", () => {
      expect(() => encodeDotenvText(null as never)).toThrow("Invalid dotenv document");
    });

    test("@no-default renders # @no-default", () => {
      const output = encodeDotenvText({
        entries: [
          { key: "K", value: "v", line: 1, directives: { hasDefault: false } },
        ],
      });
      expect(output).toContain("# @no-default");
    });

    test("hasDefault true does not render # @no-default", () => {
      const output = encodeDotenvText({
        entries: [
          { key: "K", value: "v", line: 1, directives: { hasDefault: true } },
        ],
      });
      expect(output).not.toContain("# @no-default");
    });

    test("stringEnum renders # @type enum line", () => {
      const output = encodeDotenvText({
        entries: [
          {
            key: "ENV",
            value: "dev",
            line: 1,
            directives: { type: "stringEnum", stringEnumValues: ["dev", "staging", "prod"] },
          },
        ],
      });
      expect(output).toContain("# @type enum dev,staging,prod");
      expect(output).toContain("ENV=dev");
    });

    test("stringEnum without values does not render @type line", () => {
      const output = encodeDotenvText({
        entries: [
          { key: "K", value: "v", line: 1, directives: { type: "stringEnum" } },
        ],
      });
      expect(output).not.toContain("# @type");
    });

    test("section prefix in headers without separate prefix lines", () => {
      const output = encodeDotenvText({
        entries: [{ key: "K", value: "v", line: 1, directives: {} }],
        prefix: { server: "SRV_" },
      });
      expect(output).toContain("# @server SRV_");
      expect(output).not.toContain("# @prefix");
    });

    test("shared prefix only", () => {
      const output = encodeDotenvText({
        entries: [{ key: "K", value: "v", line: 1, directives: {} }],
        prefix: { shared: "APP_" },
      });
      expect(output).toContain("# @shared APP_");
      expect(output).toContain("# @server\n");
      expect(output).toContain("# @client\n");
    });

    test("all three directives combined in encoding", () => {
      const output = encodeDotenvText({
        entries: [
          {
            key: "ENV",
            value: "dev",
            line: 1,
            directives: {
              type: "stringEnum",
              stringEnumValues: ["dev", "staging", "prod"],
              hasDefault: false,
              redacted: true,
            },
          },
        ],
      });
      expect(output).toContain("# @type enum dev,staging,prod");
      expect(output).toContain("# @no-default");
      expect(output).toContain("# @redacted");
      expect(output).toContain("ENV=dev");
    });

    test("default-to-server when no bucket info", () => {
      const output = encodeDotenvText({
        entries: [{ key: "K", value: "v", line: 1, directives: {} }],
      });
      const serverIdx = output.indexOf("# @server");
      const kIdx = output.indexOf("K=v");
      const clientIdx = output.indexOf("# @client");
      expect(kIdx).toBeGreaterThan(serverIdx);
      expect(kIdx).toBeLessThan(clientIdx);
    });
  });

  describe("round-trip", () => {
    test("@no-default survives encode -> decode", () => {
      const encoded = encodeDotenvText({
        entries: [
          { key: "PORT", value: "3000", line: 1, directives: { hasDefault: false } },
        ],
      });
      const decoded = decodeDotenvText(encoded);
      expect(decoded.entries[0].directives.hasDefault).toBe(false);
    });

    test("section prefix survives encode -> decode", () => {
      const encoded = encodeDotenvText({
        entries: [
          { key: "SRV_PORT", value: "3000", line: 1, directives: { bucket: "server" } },
        ],
        prefix: { server: "SRV_", client: "NEXT_PUBLIC_" },
      });
      const decoded = decodeDotenvText(encoded);
      expect(decoded.prefix).toEqual({ server: "SRV_", client: "NEXT_PUBLIC_" });
    });

    test("@type enum survives encode -> decode", () => {
      const encoded = encodeDotenvText({
        entries: [
          {
            key: "ENV",
            value: "dev",
            line: 1,
            directives: { type: "stringEnum", stringEnumValues: ["dev", "staging", "prod"] },
          },
        ],
      });
      const decoded = decodeDotenvText(encoded);
      expect(decoded.entries[0].directives.type).toBe("stringEnum");
      expect(decoded.entries[0].directives.stringEnumValues).toEqual(["dev", "staging", "prod"]);
    });

    test("all three features combined round-trip", () => {
      const original = {
        entries: [
          {
            key: "SRV_NODE_ENV",
            value: "dev",
            line: 1,
            directives: {
              type: "stringEnum" as const,
              stringEnumValues: ["dev", "staging", "prod"],
              hasDefault: false,
              bucket: "server" as const,
            },
          },
          {
            key: "NEXT_PUBLIC_API",
            value: "https://example.com",
            line: 2,
            directives: { bucket: "client" as const, optional: true },
          },
        ],
        prefix: { server: "SRV_", client: "NEXT_PUBLIC_" },
      };
      const encoded = encodeDotenvText(original);
      const decoded = decodeDotenvText(encoded);

      const envEntry = decoded.entries.find((e) => e.key === "SRV_NODE_ENV")!;
      expect(envEntry.directives.type).toBe("stringEnum");
      expect(envEntry.directives.stringEnumValues).toEqual(["dev", "staging", "prod"]);
      expect(envEntry.directives.hasDefault).toBe(false);

      const apiEntry = decoded.entries.find((e) => e.key === "NEXT_PUBLIC_API")!;
      expect(apiEntry.directives.optional).toBe(true);

      expect(decoded.prefix).toEqual({ server: "SRV_", client: "NEXT_PUBLIC_" });
    });
  });
});
