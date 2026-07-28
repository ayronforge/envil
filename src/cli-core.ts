import path from "node:path";

import { inspectEnvContract, renderEnvExample } from "./cli/contract-inspector.ts";
import {
  ensureWritableTarget,
  getDefaultEnvOutputPath,
  getDefaultExampleInputPath,
  readTextFileOrThrow,
  resolveFromCwd,
  writeFileAtomic,
} from "./cli/fs-utils.ts";
import { generateDefaultEnvSource, generateEnvSourceFromDotenv } from "./cli/init.ts";

interface CliIO {
  readonly cwd: () => string;
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

interface InitOptions {
  readonly from?: string;
  readonly output?: string;
  readonly clientPrefix?: string;
  readonly force: boolean;
  readonly help: boolean;
}

interface ExampleOptions {
  readonly input?: string;
  readonly output?: string;
  readonly exportName?: string;
  readonly force: boolean;
  readonly help: boolean;
}

const DEFAULT_IO: CliIO = {
  cwd: () => process.cwd(),
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
};

type FlagSpec = Readonly<Record<string, "string" | "boolean">>;

function parseFlags(
  args: ReadonlyArray<string>,
  specification: FlagSpec,
): Readonly<Record<string, string | boolean>> {
  const parsed: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined || !token.startsWith("--")) {
      throw new Error("Unexpected CLI argument");
    }
    const equalsIndex = token.indexOf("=");
    const name = token.slice(2, equalsIndex < 0 ? undefined : equalsIndex);
    const expected = specification[name];
    if (expected === undefined) {
      throw new Error(`Unknown option "--${name}"`);
    }
    const inlineValue = equalsIndex < 0 ? undefined : token.slice(equalsIndex + 1);
    if (expected === "boolean") {
      if (inlineValue !== undefined) {
        throw new Error(`Boolean option "--${name}" does not accept a value`);
      }
      parsed[name] = true;
      continue;
    }
    const value = inlineValue ?? args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Option "--${name}" requires a value`);
    }
    parsed[name] = value;
    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return parsed;
}

function optionalString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseInitOptions(args: ReadonlyArray<string>): InitOptions {
  const flags = parseFlags(args, {
    from: "string",
    output: "string",
    "client-prefix": "string",
    force: "boolean",
    help: "boolean",
  });
  return {
    ...(optionalString(flags.from) === undefined ? {} : { from: String(flags.from) }),
    ...(optionalString(flags.output) === undefined ? {} : { output: String(flags.output) }),
    ...(optionalString(flags["client-prefix"]) === undefined
      ? {}
      : { clientPrefix: String(flags["client-prefix"]) }),
    force: flags.force === true,
    help: flags.help === true,
  };
}

function parseExampleOptions(args: ReadonlyArray<string>): ExampleOptions {
  const flags = parseFlags(args, {
    input: "string",
    output: "string",
    export: "string",
    force: "boolean",
    help: "boolean",
  });
  return {
    ...(optionalString(flags.input) === undefined ? {} : { input: String(flags.input) }),
    ...(optionalString(flags.output) === undefined ? {} : { output: String(flags.output) }),
    ...(optionalString(flags.export) === undefined ? {} : { exportName: String(flags.export) }),
    force: flags.force === true,
    help: flags.help === true,
  };
}

async function runInit(options: InitOptions, io: CliIO): Promise<void> {
  const cwd = io.cwd();
  const outputPath = resolveFromCwd(cwd, options.output ?? (await getDefaultEnvOutputPath(cwd)));
  let source = generateDefaultEnvSource();

  if (options.from !== undefined) {
    const inputPath = resolveFromCwd(cwd, options.from);
    const basename = path.basename(inputPath);
    if (basename !== ".env" && basename !== ".env.example") {
      throw new Error("envil init --from accepts only .env or .env.example");
    }
    const dotenv = await readTextFileOrThrow(inputPath, "dotenv input");
    source = generateEnvSourceFromDotenv(dotenv, options.clientPrefix);
  }

  await ensureWritableTarget(outputPath, options.force);
  await writeFileAtomic(outputPath, source);
  io.stdout(`Generated ${outputPath}\n`);
}

async function runExample(options: ExampleOptions, io: CliIO): Promise<void> {
  const cwd = io.cwd();
  const inputPath = resolveFromCwd(cwd, options.input ?? (await getDefaultExampleInputPath(cwd)));
  const outputPath = resolveFromCwd(cwd, options.output ?? ".env.example");
  const contract = inspectEnvContract(inputPath, options.exportName);
  const source = renderEnvExample(contract);

  await ensureWritableTarget(outputPath, options.force);
  await writeFileAtomic(outputPath, source);
  io.stdout(`Generated ${outputPath}\n`);
}

/** Runs the Envil CLI without importing application modules. */
export async function runCli(argv: string[], io: Partial<CliIO> = {}): Promise<number> {
  const runtimeIO: CliIO = {
    cwd: io.cwd ?? DEFAULT_IO.cwd,
    stdout: io.stdout ?? DEFAULT_IO.stdout,
    stderr: io.stderr ?? DEFAULT_IO.stderr,
  };

  try {
    const command = argv[0];
    if (command === undefined || command === "--help" || command === "-h") {
      runtimeIO.stdout(rootHelp());
      return 0;
    }
    if (command === "init") {
      const options = parseInitOptions(argv.slice(1));
      if (options.help) {
        runtimeIO.stdout(initHelp());
        return 0;
      }
      await runInit(options, runtimeIO);
      return 0;
    }
    if (command === "example") {
      const options = parseExampleOptions(argv.slice(1));
      if (options.help) {
        runtimeIO.stdout(exampleHelp());
        return 0;
      }
      await runExample(options, runtimeIO);
      return 0;
    }

    throw new Error(`Unknown command "${command}"`);
  } catch (failure: unknown) {
    runtimeIO.stderr(`${failure instanceof Error ? failure.message : "Envil CLI failed"}\n`);
    return 1;
  }
}

function rootHelp(): string {
  return [
    "Usage:",
    "  envil init [--from .env|.env.example]",
    "  envil example --input src/env.ts",
    "",
  ].join("\n");
}

function initHelp(): string {
  return [
    "Usage:",
    "  envil init [--from .env|.env.example] [options]",
    "",
    "Options:",
    "  --client-prefix <prefix>  Explicit public client prefix",
    "  --output <path>           Generated env.ts path",
    "  --force                   Overwrite an existing output",
    "",
  ].join("\n");
}

function exampleHelp(): string {
  return [
    "Usage:",
    "  envil example --input src/env.ts [options]",
    "",
    "Options:",
    "  --export <name>  Select one export when the module has several contracts",
    "  --output <path>  Generated .env.example path",
    "  --force          Overwrite an existing output",
    "",
  ].join("\n");
}
