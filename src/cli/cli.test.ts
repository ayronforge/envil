import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { runCli } from "../cli-core.ts";

import { inspectEnvContract, renderEnvExample } from "./contract-inspector.ts";
import { generateDefaultEnvSource, generateEnvSourceFromDotenv } from "./init.ts";

const temporaryDirectories: string[] = [];

async function createFixture(): Promise<string> {
  const directory = await mkdtemp(path.join(process.cwd(), ".envil-test-"));
  temporaryDirectories.push(directory);
  await writeFile(
    path.join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "ESNext",
        moduleResolution: "bundler",
        target: "ES2022",
        allowImportingTsExtensions: true,
        noEmit: true,
      },
      include: ["./*.ts"],
    }),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("envil init", () => {
  test("generates a server starter without choosing a client runtime", () => {
    const source = generateDefaultEnvSource();

    expect(source).toContain("export const appEnv = createEnv");
    expect(source).toContain("server({");
    expect(source).toContain("DATABASE_URL: redacted(requiredString)");
    expect(source).not.toContain("client(");
    expect(source).not.toContain("prefix:");
    expect(source).not.toContain("runtimeEnv:");
  });

  test("uses dotenv values only to infer target schemas", () => {
    const secret = "postgres://user:password@db.example.com:5432/app";
    const source = generateEnvSourceFromDotenv(
      `DATABASE_URL=${secret}\nVITE_APP_URL=https://example.com\nPORT=3000\n`,
    );

    expect(source).toContain("DATABASE_URL: redacted(postgresUrl)");
    expect(source).toContain("APP_URL: url");
    expect(source).toContain("PORT: port");
    expect(source).toContain('prefix: "VITE_"');
    expect(source).not.toContain("runtimeEnv:");
    expect(source).not.toContain(secret);
  });

  test("redacts sensitive names and inferred server connection URLs", () => {
    const source = generateEnvSourceFromDotenv(
      [
        "AWS_SECRET_ACCESS_KEY=private-value",
        "CACHE=redis://host:6379/0",
        "DOCUMENTS=mongodb://host:27017/app",
        "MYSQL_URL=mysql://user:password@host:3306/app",
        "SECRETARY_EMAIL=assistant@example.com",
      ].join("\n"),
    );

    expect(source).toContain("AWS_SECRET_ACCESS_KEY: redacted(requiredString)");
    expect(source).toContain("CACHE: redacted(redisUrl)");
    expect(source).toContain("DOCUMENTS: redacted(mongoUrl)");
    expect(source).toContain("MYSQL_URL: redacted(mysqlUrl)");
    expect(source).toContain("SECRETARY_EMAIL: requiredString");
    expect(source).not.toContain("private-value");
  });

  test("falls back safely when database URLs do not satisfy their schemas", () => {
    const source = generateEnvSourceFromDotenv(
      [
        "POSTGRES_URL=postgres://localhost/app",
        "REDIS_URL=redis://",
        "MONGO_URL=mongodb://",
        "MYSQL_URL=mysql://localhost/app",
      ].join("\n"),
    );

    expect(source.match(/redacted\(requiredString\)/g)).toHaveLength(4);
    expect(source).not.toContain("postgresUrl");
    expect(source).not.toContain("redisUrl");
    expect(source).not.toContain("mongoUrl");
    expect(source).not.toContain("mysqlUrl");
  });

  test("infers numeric port values before boolean shorthand", () => {
    const source = generateEnvSourceFromDotenv("PORT=1\nADMIN_PORT=3000\nENABLED=0\n");

    expect(source).toContain("PORT: port");
    expect(source).toContain("ADMIN_PORT: port");
    expect(source).toContain("ENABLED: boolean");
  });

  test("infers schemas only from values their decoders accept", () => {
    const source = generateEnvSourceFromDotenv(
      'ENABLED=" true "\nDATABASE_URL=" postgres://user:password@host:5432/app "\nPORT=" 3000 "\n',
    );

    expect(source).toContain("ENABLED: requiredString");
    expect(source).toContain("DATABASE_URL: redacted(requiredString)");
    expect(source).toContain("PORT: port");
    expect(source).not.toContain("postgresUrl");
  });

  test("rejects ambiguous known client prefixes without exposing values", () => {
    const secret = "private-value";
    expect(() =>
      generateEnvSourceFromDotenv(`VITE_URL=${secret}\nEXPO_PUBLIC_URL=${secret}\n`),
    ).toThrow("--client-prefix");

    try {
      generateEnvSourceFromDotenv(`VITE_URL=${secret}\nEXPO_PUBLIC_URL=${secret}\n`);
    } catch (failure: unknown) {
      expect(String(failure)).not.toContain(secret);
    }
  });

  test("allows the same property name in server and client targets", () => {
    const source = generateEnvSourceFromDotenv(
      "URL=https://server.example.com\nVITE_URL=https://client.example.com\n",
    );

    expect(source.match(/URL: url/g)).toHaveLength(2);
    expect(source.indexOf("  client(")).toBeLessThan(source.indexOf("  server("));
  });

  test("emits __proto__ as a computed property", () => {
    const source = generateEnvSourceFromDotenv("VITE___proto__=public\n");

    expect(source).toContain('["__proto__"]: requiredString');
    expect(source).not.toContain("\n      __proto__:");
  });

  test("generates Expo-prefixed definitions without choosing a runtime", () => {
    const source = generateEnvSourceFromDotenv(
      "DATABASE_URL=postgres://user:password@host:5432/app\nEXPO_PUBLIC_APP_URL=https://example.com\n",
    );

    expect(source).toContain("APP_URL: url");
    expect(source).toContain('prefix: "EXPO_PUBLIC_"');
    expect(source).not.toContain("@ayronforge/envil/presets");
    expect(source).not.toContain("runtimeEnv:");
  });

  test("rejects unsupported Nuxt environment sources", () => {
    expect(() => generateEnvSourceFromDotenv("NUXT_PUBLIC_API_URL=https://example.com")).toThrow(
      "Nuxt is not supported",
    );
    expect(() =>
      generateEnvSourceFromDotenv("API_URL=https://example.com", "NUXT_PUBLIC_"),
    ).toThrow("Nuxt is not supported");
  });

  test("CLI writes one app environment definition", async () => {
    const directory = await createFixture();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(["init"], {
      cwd: () => directory,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toHaveLength(1);
    expect(await readFile(path.join(directory, "env.ts"), "utf8")).toContain(
      "export const appEnv = createEnv",
    );
  });
});

describe("envil example", () => {
  test("inspects the app contract without executing the module", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { client, createEnv, redacted, server, shared, url } from "../src/index.ts";',
        "",
        "export const appEnv = createEnv(",
        "  server({ DATABASE_URL: redacted(url) }),",
        "  client({ APP_URL: url }, { runtimeEnv: {}, prefix: 'VITE_' }),",
        "  shared({ APP_NAME: 'Envil' }),",
        ");",
        "",
        'throw new Error("THIS_MODULE_MUST_NOT_EXECUTE");',
      ].join("\n"),
    );

    const contract = inspectEnvContract(inputPath);
    const example = renderEnvExample(contract);

    expect(contract.exportName).toBe("appEnv");
    expect(example).toBe("DATABASE_URL=\n\nVITE_APP_URL=\n");
    expect(example).not.toContain("APP_NAME");
    expect(example).not.toContain("THIS_MODULE_MUST_NOT_EXECUTE");
  });

  test("uses fromEnv names and omits resolver-backed variables", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { configureResolver, createEnv, customSecretsAdapter, fromEnv, fromResolver, requiredString, server } from "../src/index.ts";',
        "",
        "const source = configureResolver(customSecretsAdapter, {});",
        "export const appEnv = createEnv(",
        "  server({",
        '      TOKEN: requiredString.pipe(fromResolver(source, "private-reference")),',
        '      DATABASE_URL: requiredString.pipe(fromEnv("POSTGRES_URL")),',
        "  }),",
        ");",
      ].join("\n"),
    );

    expect(renderEnvExample(inspectEnvContract(inputPath))).toBe("POSTGRES_URL=\n");
  });

  test("rejects empty runtime names instead of rendering invalid dotenv entries", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { createEnv, fromEnv, requiredString, server } from "../src/index.ts";',
        "export const appEnv = createEnv(",
        '  server({ TOKEN: requiredString.pipe(fromEnv("")) }),',
        ");",
      ].join("\n"),
    );

    expect(() => inspectEnvContract(inputPath)).toThrow("empty environment variable name");

    await writeFile(
      inputPath,
      [
        'import { createEnv, requiredString, server } from "../src/index.ts";',
        'export const appEnv = createEnv(server({ "": requiredString }));',
      ].join("\n"),
    );

    expect(() => inspectEnvContract(inputPath)).toThrow("empty environment variable name");
  });

  test("rejects runtime names that dotenv cannot represent", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");

    for (const runtimeName of ["A=B", "A\nB"]) {
      await writeFile(
        inputPath,
        [
          'import { createEnv, fromEnv, requiredString, server } from "../src/index.ts";',
          "export const appEnv = createEnv(",
          `  server({ TOKEN: requiredString.pipe(fromEnv(${JSON.stringify(runtimeName)})) }),`,
          ");",
        ].join("\n"),
      );

      expect(() => inspectEnvContract(inputPath)).toThrow(
        "cannot render this environment variable name in dotenv format",
      );
    }
  });

  test("rejects duplicate runtime names instead of hiding them", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { createEnv, fromEnv, requiredString, server } from "../src/index.ts";',
        "export const appEnv = createEnv(",
        "  server({",
        '    FIRST: requiredString.pipe(fromEnv("TOKEN")),',
        '    SECOND: requiredString.pipe(fromEnv("TOKEN")),',
        "  }),",
        ");",
      ].join("\n"),
    );

    expect(() => renderEnvExample(inspectEnvContract(inputPath))).toThrow(
      '"FIRST" and "SECOND" both read "TOKEN"',
    );
  });

  test('treats a resolver named "env" as resolver-backed metadata', async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { configureResolver, createEnv, fromEnv, fromResolver, requiredString, server } from "../src/index.ts";',
        'import type { ResolverAdapter } from "../src/index.ts";',
        "",
        'const adapter = { name: "env", resolve: () => { throw new Error("not executed"); } } satisfies ResolverAdapter<"env", string, {}, never, never>;',
        "const source = configureResolver(adapter, {});",
        "export const appEnv = createEnv(",
        "  server({",
        '    TOKEN: requiredString.pipe(fromResolver(source, "private-reference")),',
        '    DATABASE_URL: requiredString.pipe(fromEnv("POSTGRES_URL")),',
        "  }),",
        ");",
      ].join("\n"),
    );

    expect(renderEnvExample(inspectEnvContract(inputPath))).toBe("POSTGRES_URL=\n");
  });

  test("omits a server definition shadowed by the winning client definition", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { client, createEnv, requiredString, server } from "../src/index.ts";',
        "",
        "export const appEnv = createEnv(",
        "  server({ URL: requiredString }),",
        "  client({ URL: requiredString }, { runtimeEnv: {}, prefix: 'VITE_' }),",
        ");",
      ].join("\n"),
    );

    expect(renderEnvExample(inspectEnvContract(inputPath))).toBe("VITE_URL=\n");
  });

  test("renders the final contract produced by extendEnv composition", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { client, configureResolver, createEnv, customSecretsAdapter, extendEnv, fromEnv, fromResolver, requiredString, server } from "../src/index.ts";',
        "",
        "const source = configureResolver(customSecretsAdapter, {});",
        "const baseEnv = createEnv(",
        "  server({",
        '    DATABASE: requiredString.pipe(fromEnv("OLD_DATABASE")),',
        '    TOKEN: requiredString.pipe(fromResolver(source, "private-reference")),',
        "  }),",
        ");",
        "",
        "export const appEnv = baseEnv.pipe(",
        "  extendEnv(",
        "    createEnv(",
        "      server({",
        '        DATABASE: requiredString.pipe(fromEnv("NEW_DATABASE")),',
        '        PORT: requiredString.pipe(fromEnv("SERVER_PORT")),',
        "      }),",
        "    ),",
        "  ),",
        "  extendEnv(",
        "    client(",
        "      { DATABASE: requiredString, APP_URL: requiredString },",
        "      { runtimeEnv: {}, prefix: 'PUBLIC_' },",
        "    ),",
        "  ),",
        ");",
        "",
        'throw new Error("THIS_COMPOSED_MODULE_MUST_NOT_EXECUTE");',
      ].join("\n"),
    );

    expect(renderEnvExample(inspectEnvContract(inputPath))).toBe(
      "SERVER_PORT=\n\nPUBLIC_APP_URL=\nPUBLIC_DATABASE=\n",
    );
  });

  test("requires --export when several app environments are exported", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { createEnv } from "../src/index.ts";',
        "export const first = createEnv();",
        "export const second = createEnv();",
      ].join("\n"),
    );

    expect(() => inspectEnvContract(inputPath)).toThrow("--export");
    expect(inspectEnvContract(inputPath, "second").exportName).toBe("second");
  });

  test("explains fragment prefixes whose type was widened", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { client, createEnv, requiredString } from "../src/index.ts";',
        'const prefix: string = "APP_";',
        "export const appEnv = createEnv(",
        "  client({ TOKEN: requiredString }, { runtimeEnv: {}, prefix }),",
        ");",
      ].join("\n"),
    );

    expect(() => inspectEnvContract(inputPath)).toThrow(
      "Envil could not determine the generated variable names. Keep prefixes and environment names as string literals instead of typing them as string.",
    );
  });

  test("rejects widened fragment records instead of emitting an empty example", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { createEnv, requiredString, server } from "../src/index.ts";',
        "const values: Record<string, typeof requiredString> = { PORT: requiredString };",
        "export const appEnv = createEnv(server(values));",
      ].join("\n"),
    );

    expect(() => inspectEnvContract(inputPath)).toThrow("index signature");
  });

  test("rejects widened numeric fragment records instead of emitting an empty example", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { createEnv, requiredString, server } from "../src/index.ts";',
        "const values: Record<number, typeof requiredString> = { 1: requiredString };",
        "export const appEnv = createEnv(server(values));",
      ].join("\n"),
    );

    expect(() => inspectEnvContract(inputPath)).toThrow("index signature");
  });

  test("normalizes numeric fragment keys to their runtime string form", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { createEnv, requiredString, server } from "../src/index.ts";',
        "export const appEnv = createEnv(server({ 1: requiredString }));",
      ].join("\n"),
    );

    expect(renderEnvExample(inspectEnvContract(inputPath))).toBe("1=\n");
  });

  test("CLI stderr omits compiler source details", async () => {
    const directory = await createFixture();
    const secret = "SECRET_LITERAL_MUST_NOT_LEAK";
    await writeFile(
      path.join(directory, "env.ts"),
      `const value: never = "${secret}";\nexport { value };\n`,
    );
    const stderr: string[] = [];
    const exitCode = await runCli(["example", "--input", "env.ts", "--output", ".env.example"], {
      cwd: () => directory,
      stdout: () => {},
      stderr: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).not.toContain(secret);
    expect(stderr.join("")).not.toContain("line");
  });
});

test("only init and example are accepted commands", async () => {
  const stderr: string[] = [];
  const exitCode = await runCli(["add", "env"], {
    stderr: (message) => stderr.push(message),
  });

  expect(exitCode).toBe(1);
  expect(stderr.join("")).toContain('Unknown command "add"');
  expect(stderr.join("")).toContain('Run "envil --help"');
});

test("CLI option errors explain the correct syntax", async () => {
  const stderr: string[] = [];
  const exitCode = await runCli(["init", "--force=true"], {
    stderr: (message) => stderr.push(message),
  });

  expect(exitCode).toBe(1);
  expect(stderr.join("")).toContain('Use "--force" without a value.');
});
