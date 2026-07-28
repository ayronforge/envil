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
  test("generates the secure default starter", () => {
    expect(generateDefaultEnvSource()).toContain("DATABASE_URL: redacted(url)");
    expect(generateDefaultEnvSource()).toContain('client: "VITE_"');
    expect(generateDefaultEnvSource()).not.toContain("CHANGE_ME");
  });

  test("uses dotenv values only to infer schemas", () => {
    const secret = "postgres://user:password@db.example.com:5432/app";
    const source = generateEnvSourceFromDotenv(
      `DATABASE_URL=${secret}\nVITE_APP_URL=https://example.com\nPORT=3000\n`,
    );

    expect(source).toContain("DATABASE_URL: redacted(postgresUrl)");
    expect(source).toContain("APP_URL: url");
    expect(source).toContain("PORT: port");
    expect(source).toContain('client: "VITE_"');
    expect(source).not.toContain(secret);
    expect(source).not.toContain("withDefault");
    expect(source).not.toContain("shared:");
  });

  test("parses quoted values, inline comments, and hashes inside quotes", () => {
    const source = generateEnvSourceFromDotenv(
      [
        'PORT="3000" # local port',
        'VITE_APP_URL="https://example.com/#documentation" # public URL',
      ].join("\n"),
    );

    expect(source).toContain("PORT: port");
    expect(source).toContain("APP_URL: url");
    expect(source).toContain('client: "VITE_"');
  });

  test("redacts common compound credential names without matching unrelated words", () => {
    const source = generateEnvSourceFromDotenv(
      [
        "AWS_SECRET_ACCESS_KEY=private-value",
        "STRIPE_SECRET_KEY=private-value",
        "AWS_ACCESS_KEY_ID=private-value",
        "SECRETARY_EMAIL=assistant@example.com",
        "MONKEY=capuchin",
      ].join("\n"),
    );

    expect(source).toContain("AWS_SECRET_ACCESS_KEY: redacted(requiredString)");
    expect(source).toContain("STRIPE_SECRET_KEY: redacted(requiredString)");
    expect(source).toContain("AWS_ACCESS_KEY_ID: redacted(requiredString)");
    expect(source).toContain("SECRETARY_EMAIL: requiredString");
    expect(source).toContain("MONKEY: requiredString");
    expect(source).not.toContain("private-value");
  });

  test("rejects ambiguous known client prefixes without exposing values", () => {
    const secret = "private-value";
    expect(() =>
      generateEnvSourceFromDotenv(`VITE_URL=${secret}\nNEXT_PUBLIC_URL=${secret}\n`),
    ).toThrow("--client-prefix");

    try {
      generateEnvSourceFromDotenv(`VITE_URL=${secret}\nNEXT_PUBLIC_URL=${secret}\n`);
    } catch (failure: unknown) {
      expect(String(failure)).not.toContain(secret);
    }
  });

  test("rejects logical collisions created by prefix removal", () => {
    expect(() =>
      generateEnvSourceFromDotenv(
        "APP_URL=https://server.example.com\nVITE_APP_URL=https://client.example.com\n",
      ),
    ).toThrow("more than one bucket");
  });

  test("CLI writes one env.ts file", async () => {
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
    expect(await readFile(path.join(directory, "env.ts"), "utf8")).toContain("createEnvSync");
  });
});

describe("envil example", () => {
  test("inspects the phantom contract without executing the module", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { createEnv, redacted, requiredString, url } from "../src/index.ts";',
        "",
        "export const env = createEnv({",
        "  server: { DATABASE_URL: redacted(url) },",
        "  client: { APP_URL: url },",
        '  prefix: { client: "VITE_" },',
        "  runtimeEnv: {},",
        "});",
        "",
        'throw new Error("THIS_MODULE_MUST_NOT_EXECUTE");',
      ].join("\n"),
    );

    const contract = inspectEnvContract(inputPath);
    const example = renderEnvExample(contract);

    expect(contract.exportName).toBe("env");
    expect(example).toBe("DATABASE_URL=\n\nVITE_APP_URL=\n");
    expect(example).not.toContain("THIS_MODULE_MUST_NOT_EXECUTE");
  });

  test("includes inherited contracts in generated examples", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { createEnvSync, redacted, requiredString, url } from "../src/index.ts";',
        "",
        "const baseEnv = createEnvSync({",
        "  server: { DATABASE_URL: redacted(url) },",
        "  client: { API_URL: url },",
        '  prefix: { client: "VITE_" },',
        "  runtimeEnv: {},",
        "});",
        "",
        "export const env = createEnvSync({",
        "  extends: [baseEnv],",
        "  server: { APP_NAME: requiredString },",
        "  runtimeEnv: {},",
        "});",
      ].join("\n"),
    );

    const example = renderEnvExample(inspectEnvContract(inputPath));

    expect(example).toBe("APP_NAME=\nDATABASE_URL=\n\nVITE_API_URL=\n");
  });

  test("requires --export when several contracts are exported", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { createEnv } from "../src/index.ts";',
        "export const first = createEnv({ server: {} });",
        "export const second = createEnv({ server: {} });",
      ].join("\n"),
    );

    expect(() => inspectEnvContract(inputPath)).toThrow("--export");
    expect(inspectEnvContract(inputPath, "second").exportName).toBe("second");
  });

  test("fails widened physical keys explicitly", async () => {
    const directory = await createFixture();
    const inputPath = path.join(directory, "env.ts");
    await writeFile(
      inputPath,
      [
        'import { createEnv, requiredString } from "../src/index.ts";',
        'const prefix: string = "APP_";',
        "export const env = createEnv({",
        "  server: { TOKEN: requiredString },",
        "  prefix,",
        "});",
      ].join("\n"),
    );

    expect(() => inspectEnvContract(inputPath)).toThrow("widened runtimeKey");
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
});
