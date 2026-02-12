import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Schema } from "effect";

import { runCli } from "../cli-core.ts";
import { buildEnvExample } from "../introspect.ts";
import * as S from "../schemas.ts";

import { decodeDotenvText } from "./dotenv-codec.ts";
import { generateEnvTs } from "./generate-env-ts.ts";
import { inferModel } from "./infer.ts";
import type { InferredVariable, SchemaKind } from "./types.ts";
import { FRAMEWORKS, type Framework } from "./types.ts";

function createBufferedIO(cwd: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    io: {
      cwd: () => cwd,
      stdout: (message: string) => {
        stdout.push(message);
      },
      stderr: (message: string) => {
        stderr.push(message);
      },
    },
  };
}

describe("envil cli", () => {
  describe("integration", () => {
    test("add env creates env.ts from .env.example", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-add-env-"));
      await mkdir(path.join(tempDir, "src"), { recursive: true });
      await writeFile(
        path.join(tempDir, ".env.example"),
        ["# @server", "PORT=3000", "# @client", "NEXT_PUBLIC_API_URL=https://example.com", ""].join(
          "\n",
        ),
        "utf8",
      );

      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "env"], io.io);

      expect(code).toBe(0);
      const generated = await readFile(path.join(tempDir, "src", "env.ts"), "utf8");
      expect(generated).toContain("export const envDefinition = {");
      expect(generated).toContain("export const env = createEnv(envDefinition);");
      expect(io.stderr.join("")).toBe("");

      await rm(tempDir, { recursive: true, force: true });
    });

    test("env.ts -> .env.example round-trip preserves content", () => {
      const input = "# @server\nPORT=3000\n# @client\nNEXT_PUBLIC_API_URL=https://example.com\n";
      const prefix = { server: "", client: "", shared: "" };

      const dotenv = decodeDotenvText(input);
      const model = inferModel(dotenv, { prefix });
      const definition = modelToDefinition(model);
      const recreated = buildEnvExample(definition);

      expect(recreated).toContain("# @server");
      expect(recreated).toContain("# @client");
      expect(recreated).toContain("# @shared");
      expect(recreated).toContain("PORT=3000");
      expect(recreated).toContain("NEXT_PUBLIC_API_URL=https://example.com");
    });

    test("refuses to overwrite output without --force", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-overwrite-"));
      await writeFile(path.join(tempDir, ".env.example"), "PORT=3000\n", "utf8");
      await writeFile(path.join(tempDir, "env.ts"), "existing\n", "utf8");

      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "env", "--output", "env.ts"], io.io);

      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain("already exists");

      await rm(tempDir, { recursive: true, force: true });
    });

    test("applies framework and explicit prefix flags", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-prefix-"));
      await writeFile(
        path.join(tempDir, ".env.example"),
        "NEXT_PUBLIC_API_URL=https://example.com\n",
        "utf8",
      );

      const io = createBufferedIO(tempDir);
      expect(
        await runCli(["add", "env", "--framework", "nextjs", "--output", "env.ts"], io.io),
      ).toBe(0);
      let generated = await readFile(path.join(tempDir, "env.ts"), "utf8");
      expect(generated).toContain('client: "NEXT_PUBLIC_"');

      expect(
        await runCli(
          [
            "add",
            "env",
            "--framework",
            "nextjs",
            "--client-prefix",
            "CUSTOM_",
            "--output",
            "env.ts",
            "--force",
          ],
          io.io,
        ),
      ).toBe(0);
      generated = await readFile(path.join(tempDir, "env.ts"), "utf8");
      expect(generated).toContain('client: "CUSTOM_"');

      await rm(tempDir, { recursive: true, force: true });
    });

    test("round-trip is stable: .env.example -> env.ts -> .env.example -> env.ts", () => {
      const input =
        "# @server\n# @type port\nPORT=3000\n\n# @client\nNEXT_PUBLIC_API_URL=https://example.com\n";
      const prefix = { server: "", client: "", shared: "" };

      const dotenv1 = decodeDotenvText(input);
      const model1 = inferModel(dotenv1, { prefix });
      const envTs1 = generateEnvTs(model1);

      const definition = modelToDefinition(model1);
      const exampleText = buildEnvExample(definition);

      const dotenv2 = decodeDotenvText(exampleText);
      const model2 = inferModel(dotenv2, { prefix });
      const envTs2 = generateEnvTs(model2);

      expect(envTs2).toBe(envTs1);
    });
  });

  describe("help output", () => {
    test("no args shows root help", async () => {
      const io = createBufferedIO("/tmp");
      const code = await runCli([], io.io);
      expect(code).toBe(0);
      expect(io.stdout.join("")).toContain("envil add env");
    });

    test("--help shows root help", async () => {
      const io = createBufferedIO("/tmp");
      const code = await runCli(["--help"], io.io);
      expect(code).toBe(0);
      expect(io.stdout.join("")).toContain("envil add env");
    });

    test("-h shows root help", async () => {
      const io = createBufferedIO("/tmp");
      const code = await runCli(["-h"], io.io);
      expect(code).toBe(0);
      expect(io.stdout.join("")).toContain("envil add env");
    });

    test("add alone shows add help", async () => {
      const io = createBufferedIO("/tmp");
      const code = await runCli(["add"], io.io);
      expect(code).toBe(0);
      expect(io.stdout.join("")).toContain("Subcommands:");
    });

    test("add --help shows add help", async () => {
      const io = createBufferedIO("/tmp");
      const code = await runCli(["add", "--help"], io.io);
      expect(code).toBe(0);
      expect(io.stdout.join("")).toContain("Subcommands:");
    });

    test("add env --help shows add env help", async () => {
      const io = createBufferedIO("/tmp");
      const code = await runCli(["add", "env", "--help"], io.io);
      expect(code).toBe(0);
      const output = io.stdout.join("");
      expect(output).toContain("--input");
      expect(output).toContain("--output");
      expect(output).toContain("--framework");
    });

    test("add example --help shows add example help", async () => {
      const io = createBufferedIO("/tmp");
      const code = await runCli(["add", "example", "--help"], io.io);
      expect(code).toBe(0);
      const output = io.stdout.join("");
      expect(output).toContain("--input");
      expect(output).toContain("--output");
      expect(output).toContain("--force");
    });
  });

  describe("error handling", () => {
    test("unknown command returns 1", async () => {
      const io = createBufferedIO("/tmp");
      const code = await runCli(["bogus"], io.io);
      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain('Unknown command "bogus"');
    });

    test("unknown subcommand returns 1", async () => {
      const io = createBufferedIO("/tmp");
      const code = await runCli(["add", "bogus"], io.io);
      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain('Unknown subcommand "add bogus"');
    });

    test("missing input file returns 1", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-missing-"));
      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "env"], io.io);
      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain("Unable to read");
      await rm(tempDir, { recursive: true, force: true });
    });

    test("invalid envDefinition schema entry returns actionable error", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-invalid-definition-"));
      await writeFile(
        path.join(tempDir, "env.ts"),
        [
          "export const envDefinition = {",
          '  server: { BAD: "not-a-schema" },',
          "  client: {},",
          "  shared: {},",
          "};",
          "",
        ].join("\n"),
        "utf8",
      );

      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "example", "--input", "env.ts"], io.io);

      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain("Invalid envDefinition");
      expect(io.stderr.join("")).toContain("envDefinition.server.BAD must be an Effect Schema");
      await rm(tempDir, { recursive: true, force: true });
    });
  });

  describe("flag parsing", () => {
    test("unknown option returns 1", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-flag-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "env", "--unknown"], io.io);
      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain('Unknown option "--unknown"');
      await rm(tempDir, { recursive: true, force: true });
    });

    test("missing string value returns 1", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-flag-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "env", "--input"], io.io);
      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain('"--input" requires a value');
      await rm(tempDir, { recursive: true, force: true });
    });

    test("missing value before another flag returns 1", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-flag-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "env", "--input", "--force"], io.io);
      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain('"--input" requires a value');
      await rm(tempDir, { recursive: true, force: true });
    });

    test("inline = syntax works", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-flag-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      const io = createBufferedIO(tempDir);
      const code = await runCli(
        [
          "add",
          "env",
          `--input=${path.join(tempDir, ".env.example")}`,
          "--output",
          path.join(tempDir, "env.ts"),
        ],
        io.io,
      );
      expect(code).toBe(0);
      await rm(tempDir, { recursive: true, force: true });
    });

    test("--force=false does not set force", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-flag-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      await writeFile(path.join(tempDir, "env.ts"), "existing\n", "utf8");
      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "env", "--output", "env.ts", "--force=false"], io.io);
      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain("already exists");
      await rm(tempDir, { recursive: true, force: true });
    });

    test("--force=0 does not set force", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-flag-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      await writeFile(path.join(tempDir, "env.ts"), "existing\n", "utf8");
      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "env", "--output", "env.ts", "--force=0"], io.io);
      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain("already exists");
      await rm(tempDir, { recursive: true, force: true });
    });

    test("--force=False does not set force", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-flag-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      await writeFile(path.join(tempDir, "env.ts"), "existing\n", "utf8");
      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "env", "--output", "env.ts", "--force=False"], io.io);
      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain("already exists");
      await rm(tempDir, { recursive: true, force: true });
    });

    test("invalid boolean flag value returns 1", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-flag-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "env", "--force=maybe"], io.io);
      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain('Invalid value for --force: "maybe"');
      await rm(tempDir, { recursive: true, force: true });
    });

    test("unexpected positional argument returns 1", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-flag-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "env", "extra"], io.io);
      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain('Unexpected argument "extra"');
      await rm(tempDir, { recursive: true, force: true });
    });
  });

  describe("invalid framework", () => {
    test("--framework rails returns error", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-framework-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      const io = createBufferedIO(tempDir);
      const code = await runCli(["add", "env", "--framework", "rails"], io.io);
      expect(code).toBe(1);
      expect(io.stderr.join("")).toContain("Invalid value for --framework");
      await rm(tempDir, { recursive: true, force: true });
    });
  });

  describe("resolvePrefix", () => {
    test("framework-only sets client prefix", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-resolve-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      const io = createBufferedIO(tempDir);
      await runCli(["add", "env", "--framework", "nextjs", "--output", "env.ts"], io.io);
      const content = await readFile(path.join(tempDir, "env.ts"), "utf8");
      expect(content).toContain('client: "NEXT_PUBLIC_"');
      await rm(tempDir, { recursive: true, force: true });
    });

    test("explicit prefix overrides framework", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-resolve-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      const io = createBufferedIO(tempDir);
      await runCli(
        ["add", "env", "--framework", "nextjs", "--client-prefix", "MY_", "--output", "env.ts"],
        io.io,
      );
      const content = await readFile(path.join(tempDir, "env.ts"), "utf8");
      expect(content).toContain('client: "MY_"');
      await rm(tempDir, { recursive: true, force: true });
    });

    test("document prefix used as fallback", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-resolve-"));
      await writeFile(path.join(tempDir, ".env.example"), "# @client DOC_\nKEY=value\n", "utf8");
      const io = createBufferedIO(tempDir);
      await runCli(["add", "env", "--output", "env.ts"], io.io);
      const content = await readFile(path.join(tempDir, "env.ts"), "utf8");
      expect(content).toContain('client: "DOC_"');
      await rm(tempDir, { recursive: true, force: true });
    });

    test("explicit prefix overrides document prefix", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-resolve-"));
      await writeFile(path.join(tempDir, ".env.example"), "# @client DOC_\nKEY=value\n", "utf8");
      const io = createBufferedIO(tempDir);
      await runCli(["add", "env", "--client-prefix", "CLI_", "--output", "env.ts"], io.io);
      const content = await readFile(path.join(tempDir, "env.ts"), "utf8");
      expect(content).toContain('client: "CLI_"');
      await rm(tempDir, { recursive: true, force: true });
    });

    test("all empty when no prefix source", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "envil-resolve-"));
      await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
      const io = createBufferedIO(tempDir);
      await runCli(["add", "env", "--output", "env.ts"], io.io);
      const content = await readFile(path.join(tempDir, "env.ts"), "utf8");
      expect(content).toContain('server: ""');
      expect(content).toContain('client: ""');
      expect(content).toContain('shared: ""');
      await rm(tempDir, { recursive: true, force: true });
    });
  });

  describe("framework presets", () => {
    const frameworkCases: Array<[Framework, string]> = [
      ["nextjs", "NEXT_PUBLIC_"],
      ["vite", "VITE_"],
      ["expo", "EXPO_PUBLIC_"],
      ["nuxt", "NUXT_PUBLIC_"],
      ["sveltekit", "PUBLIC_"],
      ["astro", "PUBLIC_"],
    ];

    test.each(frameworkCases)(
      "framework '%s' sets client prefix to '%s'",
      async (framework, expectedPrefix) => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), `envil-fw-${framework}-`));
        await writeFile(path.join(tempDir, ".env.example"), "KEY=value\n", "utf8");
        const io = createBufferedIO(tempDir);
        await runCli(["add", "env", "--framework", framework, "--output", "env.ts"], io.io);
        const content = await readFile(path.join(tempDir, "env.ts"), "utf8");
        expect(content).toContain(`client: "${expectedPrefix}"`);
        await rm(tempDir, { recursive: true, force: true });
      },
    );

    test("FRAMEWORKS constant includes all tested frameworks", () => {
      expect(FRAMEWORKS).toEqual(["nextjs", "vite", "expo", "nuxt", "sveltekit", "astro"]);
    });
  });
});

function baseSchema(kind: SchemaKind, enumValues?: readonly string[]): Schema.Schema.Any {
  switch (kind) {
    case "boolean":
      return S.boolean;
    case "integer":
      return S.integer;
    case "number":
      return S.number;
    case "port":
      return S.port;
    case "url":
      return S.url;
    case "postgresUrl":
      return S.postgresUrl;
    case "redisUrl":
      return S.redisUrl;
    case "mongoUrl":
      return S.mongoUrl;
    case "mysqlUrl":
      return S.mysqlUrl;
    case "commaSeparated":
      return S.commaSeparated;
    case "commaSeparatedNumbers":
      return S.commaSeparatedNumbers;
    case "commaSeparatedUrls":
      return S.commaSeparatedUrls;
    case "json":
      return S.json(Schema.Unknown);
    case "stringEnum":
      return S.stringEnum(enumValues as [string, ...string[]]);
    default:
      return S.requiredString;
  }
}

function variableToSchema(v: InferredVariable): Schema.Schema.Any {
  let schema = baseSchema(v.kind, v.stringEnumValues);
  if (v.optional && !v.hasDefault) schema = S.optional(schema);
  if (v.hasDefault) schema = S.withDefault(schema, v.defaultValue as never);
  if (v.redacted) schema = S.redacted(schema);
  return schema;
}

function modelToDefinition(model: {
  prefix: { server: string; client: string; shared: string };
  variables: ReadonlyArray<InferredVariable>;
}) {
  const definition: Record<string, unknown> = {
    prefix: model.prefix,
    server: {} as Record<string, Schema.Schema.Any>,
    client: {} as Record<string, Schema.Schema.Any>,
    shared: {} as Record<string, Schema.Schema.Any>,
  };

  for (const v of model.variables) {
    (definition[v.bucket] as Record<string, Schema.Schema.Any>)[v.schemaKey] = variableToSchema(v);
  }

  return definition as Parameters<typeof buildEnvExample>[0];
}
