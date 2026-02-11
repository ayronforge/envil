#!/usr/bin/env node

import { ensureWritableTarget, readTextFileOrThrow, writeFileAtomic } from "./cli/fs-utils.ts";
import {
  decodeDotenvText,
  generateEnvTs,
  getDefaultEnvOutputPath,
  getDefaultExampleInputPath,
  inferModel,
  resolveFromCwd,
} from "./cli/index.ts";
import { FRAMEWORKS, type Framework, type PrefixConfig } from "./cli/types.ts";
import { buildEnvExample } from "./introspect.ts";

interface CliIO {
  cwd: () => string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

interface AddEnvOptions {
  input?: string;
  output?: string;
  framework?: Framework;
  clientPrefix?: string;
  serverPrefix?: string;
  sharedPrefix?: string;
  force: boolean;
  help: boolean;
}

interface AddExampleOptions {
  input?: string;
  output?: string;
  force: boolean;
  help: boolean;
}

const DEFAULT_IO: CliIO = {
  cwd: () => process.cwd(),
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
};

const FRAMEWORK_PREFIXES: Record<Framework, PrefixConfig> = {
  nextjs: { server: "", client: "NEXT_PUBLIC_", shared: "" },
  vite: { server: "", client: "VITE_", shared: "" },
  expo: { server: "", client: "EXPO_PUBLIC_", shared: "" },
  nuxt: { server: "", client: "NUXT_PUBLIC_", shared: "" },
  sveltekit: { server: "", client: "PUBLIC_", shared: "" },
  astro: { server: "", client: "PUBLIC_", shared: "" },
};

export async function runCli(argv: string[], io: Partial<CliIO> = {}): Promise<number> {
  const runtimeIO: CliIO = {
    cwd: io.cwd ?? DEFAULT_IO.cwd,
    stdout: io.stdout ?? DEFAULT_IO.stdout,
    stderr: io.stderr ?? DEFAULT_IO.stderr,
  };

  try {
    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
      runtimeIO.stdout(getRootHelpText());
      return 0;
    }

    if (argv[0] !== "add") {
      throw new Error(`Unknown command "${argv[0]}".\n${getRootHelpText()}`);
    }

    const subcommand = argv[1];
    if (!subcommand || subcommand === "--help") {
      runtimeIO.stdout(getAddHelpText());
      return 0;
    }

    if (subcommand === "env") {
      const options = parseAddEnvOptions(argv.slice(2));
      if (options.help) {
        runtimeIO.stdout(getAddEnvHelpText());
        return 0;
      }

      await runAddEnv(options, runtimeIO);
      return 0;
    }

    if (subcommand === "example") {
      const options = parseAddExampleOptions(argv.slice(2));
      if (options.help) {
        runtimeIO.stdout(getAddExampleHelpText());
        return 0;
      }

      await runAddExample(options, runtimeIO);
      return 0;
    }

    throw new Error(`Unknown subcommand "add ${subcommand}".\n${getAddHelpText()}`);
  } catch (error) {
    runtimeIO.stderr(`${formatErrorMessage(error)}\n`);
    return 1;
  }
}

async function runAddEnv(options: AddEnvOptions, io: CliIO): Promise<void> {
  const cwd = io.cwd();
  const inputPath = resolveFromCwd(cwd, options.input ?? ".env.example");
  const outputPath = resolveFromCwd(cwd, options.output ?? (await getDefaultEnvOutputPath(cwd)));

  const source = await readTextFileOrThrow(inputPath, "input file");
  const dotenv = decodeDotenvText(source);
  const prefix = resolvePrefix(options, dotenv.prefix);

  const inferred = inferModel(dotenv, { prefix });
  const generated = generateEnvTs(inferred);

  await ensureWritableTarget(outputPath, options.force);
  await writeFileAtomic(outputPath, generated);

  io.stdout(`Generated ${outputPath}\n`);
}

async function runAddExample(options: AddExampleOptions, io: CliIO): Promise<void> {
  const cwd = io.cwd();
  const defaultInput = await getDefaultExampleInputPath(cwd);
  const inputPath = resolveFromCwd(cwd, options.input ?? defaultInput);
  const outputPath = resolveFromCwd(cwd, options.output ?? ".env.example");

  process.env.ENVIL_INTROSPECT_ONLY = "1";
  let mod: Record<string, unknown>;
  try {
    mod = await import(inputPath);
  } finally {
    delete process.env.ENVIL_INTROSPECT_ONLY;
  }

  if (!mod.envDefinition || typeof mod.envDefinition !== "object") {
    throw new Error(
      `Expected "envDefinition" export in ${inputPath}. Make sure the file exports an envDefinition object.`,
    );
  }

  const generated = buildEnvExample(mod.envDefinition as Parameters<typeof buildEnvExample>[0]);

  await ensureWritableTarget(outputPath, options.force);
  await writeFileAtomic(outputPath, generated);

  io.stdout(`Generated ${outputPath}\n`);
}

function resolvePrefix(options: AddEnvOptions, fromDocument?: Partial<PrefixConfig>): PrefixConfig {
  const fromFramework = options.framework ? FRAMEWORK_PREFIXES[options.framework] : undefined;

  return {
    server: options.serverPrefix ?? fromFramework?.server ?? fromDocument?.server ?? "",
    client: options.clientPrefix ?? fromFramework?.client ?? fromDocument?.client ?? "",
    shared: options.sharedPrefix ?? fromFramework?.shared ?? fromDocument?.shared ?? "",
  };
}

type FlagSpec = Record<string, "string" | "boolean">;

function parseFlags(args: ReadonlyArray<string>, spec: FlagSpec): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument "${token}"`);
    }

    const [nameWithPrefix, inlineValue] = token.split("=", 2);
    const name = nameWithPrefix.slice(2);
    const expected = spec[name];
    if (!expected) {
      throw new Error(`Unknown option "--${name}"`);
    }

    if (expected === "boolean") {
      if (inlineValue !== undefined) {
        parsed[name] = inlineValue !== "false";
      } else {
        parsed[name] = true;
      }
      continue;
    }

    if (inlineValue !== undefined) {
      parsed[name] = inlineValue;
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Option "--${name}" requires a value`);
    }

    parsed[name] = next;
    index += 1;
  }

  return parsed;
}

function parseAddEnvOptions(args: ReadonlyArray<string>): AddEnvOptions {
  const parsed = parseFlags(args, {
    input: "string",
    output: "string",
    framework: "string",
    "client-prefix": "string",
    "server-prefix": "string",
    "shared-prefix": "string",
    force: "boolean",
    help: "boolean",
  });

  const frameworkValue = parsed.framework;
  if (frameworkValue !== undefined) {
    if (typeof frameworkValue !== "string" || !FRAMEWORKS.includes(frameworkValue as Framework)) {
      throw new Error(`Invalid value for --framework. Expected one of: ${FRAMEWORKS.join(", ")}.`);
    }
  }

  return {
    input: asOptionalString(parsed.input),
    output: asOptionalString(parsed.output),
    framework: frameworkValue as Framework | undefined,
    clientPrefix: asOptionalString(parsed["client-prefix"]),
    serverPrefix: asOptionalString(parsed["server-prefix"]),
    sharedPrefix: asOptionalString(parsed["shared-prefix"]),
    force: Boolean(parsed.force),
    help: Boolean(parsed.help),
  };
}

function parseAddExampleOptions(args: ReadonlyArray<string>): AddExampleOptions {
  const parsed = parseFlags(args, {
    input: "string",
    output: "string",
    force: "boolean",
    help: "boolean",
  });

  return {
    input: asOptionalString(parsed.input),
    output: asOptionalString(parsed.output),
    force: Boolean(parsed.force),
    help: Boolean(parsed.help),
  };
}

function asOptionalString(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getRootHelpText(): string {
  return [
    "Usage:",
    "  envil add env [options]",
    "  envil add example [options]",
    "",
    getAddHelpText().trimEnd(),
    "",
  ].join("\n");
}

function getAddHelpText(): string {
  return [
    "Subcommands:",
    "  envil add env      Infer env.ts from .env.example",
    "  envil add example  Recreate .env.example from env.ts",
    "",
    "Use --help on each subcommand for details.",
    "",
  ].join("\n");
}

function getAddEnvHelpText(): string {
  return [
    "Usage:",
    "  envil add env [options]",
    "",
    "Options:",
    "  --input <path>           Input .env.example path (default: .env.example)",
    "  --output <path>          Output env.ts path (default: src/env.ts or env.ts)",
    "  --framework <name>       Prefix preset: nextjs|vite|expo|nuxt|sveltekit|astro",
    "  --client-prefix <value>  Client runtime prefix override",
    "  --server-prefix <value>  Server runtime prefix override",
    "  --shared-prefix <value>  Shared runtime prefix override",
    "  --force                  Overwrite output file if it exists",
    "  --help                   Show this help text",
    "",
  ].join("\n");
}

function getAddExampleHelpText(): string {
  return [
    "Usage:",
    "  envil add example [options]",
    "",
    "Options:",
    "  --input <path>   Input env.ts path (default: env.ts, then src/env.ts fallback)",
    "  --output <path>  Output .env.example path (default: .env.example)",
    "  --force          Overwrite output file if it exists",
    "  --help           Show this help text",
    "",
  ].join("\n");
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

if (import.meta.main) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
