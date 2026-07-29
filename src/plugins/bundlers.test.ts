import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import rspack from "@rspack/core";
import { Redacted } from "effect";
import { build as buildWithEsbuild } from "esbuild";
import { rolldown } from "rolldown";
import { rollup } from "rollup";
import ts from "typescript6";
import webpack from "webpack";

import esbuildPlugin from "./esbuild.ts";
import rolldownPlugin from "./rolldown.ts";
import rollupPlugin from "./rollup.ts";
import RspackPlugin from "./rspack.ts";
import WebpackPlugin from "./webpack.ts";

type BuildTarget = "server" | "client";
type BuildBundle = (fixture: BundlerFixture, target: BuildTarget) => Promise<BuiltBundle>;

interface BundlerFixture {
  readonly root: string;
  readonly entry: string;
}

interface BuiltBundle {
  readonly code: string;
  readonly path: string;
}

const temporaryDirectories: string[] = [];
const envilEntry = resolve(import.meta.dir, "../index.ts");
const runtimeResultKey = "__ENVIL_INTEGRATION_RESULT__";
const serverSentinel = "IMPORTED_SERVER_ONLY_SENTINEL";
const resolverSentinel = "CUSTOM_RESOLVER_SERVER_ONLY_SENTINEL";
const clientSentinel = "CLIENT_ONLY_SENTINEL";
let importSequence = 0;

async function createFixture(): Promise<BundlerFixture> {
  const root = await mkdtemp(join(process.cwd(), ".envil-bundler-"));
  temporaryDirectories.push(root);
  const entry = join(root, "entry.ts");

  await writeFile(
    join(root, "server-only.ts"),
    `export const readServerValue = () => "${serverSentinel}";\n`,
  );
  await writeFile(
    entry,
    `
import { Effect, Option, Redacted } from "effect";
import {
  client,
  configureResolver,
  createEnv,
  extendEnv,
  fromEnv,
  fromResolver,
  requiredString,
  server,
  shared,
} from "@ayronforge/envil";
import { readServerValue } from "./server-only.ts";

const resolver = configureResolver(
  {
    name: "${resolverSentinel}",
    resolve: ({ referencesByKey }) =>
      Effect.succeed(
        Object.fromEntries(
          Object.entries(referencesByKey).map(([key, reference]) => [
            key,
            Option.some(Redacted.make("resolved:" + reference)),
          ]),
        ),
      ),
  },
  {},
);

const baseEnv = createEnv(
  shared({ APP_NAME: "Base" }),
  client(
    { PUBLIC: requiredString },
    {
      runtimeEnv: new Map([["WEB_PUBLIC", "${clientSentinel}"]]),
      prefix: "WEB_",
    },
  ),
);

const appEnv = baseEnv.pipe(
  extendEnv(
    createEnv(
      server(
        {
          SECRET: requiredString.pipe(fromEnv("service.secret")),
          RESOLVED: requiredString.pipe(
            fromResolver(resolver, "custom-reference"),
          ),
        },
        {
          runtimeEnv: {
            service: {
              secret: readServerValue(),
            },
          },
        },
      ),
    ),
  ),
  extendEnv(shared({ APP_NAME: "Application" })),
);

Reflect.set(globalThis, "${runtimeResultKey}", {
  client: Effect.runSync(appEnv.client),
  server: Effect.runSync(Effect.result(appEnv.server)),
});
`,
  );

  return { root, entry };
}

function outputChunkCode(
  output: ReadonlyArray<
    { readonly type: "asset" } | { readonly type: "chunk"; readonly code: string }
  >,
): string {
  const chunk = output.find(
    (candidate): candidate is { readonly type: "chunk"; readonly code: string } =>
      candidate.type === "chunk",
  );
  if (chunk === undefined) {
    throw new Error("Expected the bundler to produce a JavaScript chunk.");
  }
  return chunk.code;
}

function createSourceResolver() {
  return {
    name: "envil-integration-source",
    resolveId(source: string) {
      return source === "@ayronforge/envil" ? envilEntry : null;
    },
  };
}

function createTypeScriptTranspiler() {
  return {
    name: "envil-integration-typescript",
    transform(code: string, id: string) {
      if (!/\.[cm]?tsx?$/.test(id)) {
        return null;
      }
      return {
        code: ts.transpileModule(code, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
          fileName: id,
        }).outputText,
        map: null,
      };
    },
  };
}

function runtimeResult(): Readonly<Record<string, unknown>> {
  const result: unknown = Reflect.get(globalThis, runtimeResultKey);
  Reflect.deleteProperty(globalThis, runtimeResultKey);
  if (typeof result !== "object" || result === null) {
    throw new Error("Expected the generated bundle to execute the real Envil runtime.");
  }
  return result;
}

async function executeBundle(bundle: BuiltBundle): Promise<Readonly<Record<string, unknown>>> {
  importSequence += 1;
  await import(`${pathToFileURL(bundle.path).href}?run=${importSequence}`);
  return runtimeResult();
}

function expectObject(value: unknown, label: string): object {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value;
}

function expectClientRuntime(result: Readonly<Record<string, unknown>>): void {
  const client = expectObject(Reflect.get(result, "client"), "the client environment");
  const server = expectObject(Reflect.get(result, "server"), "the server result");
  expect(Reflect.get(client, "APP_NAME")).toBe("Application");
  expect(Reflect.get(client, "PUBLIC")).toBe(clientSentinel);
  expect(Reflect.get(server, "_tag")).toBe("Failure");
}

function expectServerRuntime(result: Readonly<Record<string, unknown>>): void {
  const client = expectObject(Reflect.get(result, "client"), "the client environment");
  const server = expectObject(Reflect.get(result, "server"), "the server result");
  expect(Reflect.get(client, "APP_NAME")).toBe("Application");
  expect(Reflect.get(client, "PUBLIC")).toBe(clientSentinel);
  expect(Reflect.get(server, "_tag")).toBe("Success");
  const environment = expectObject(Reflect.get(server, "success"), "the server environment");
  expect(Reflect.get(environment, "APP_NAME")).toBe("Application");
  expect(Reflect.get(environment, "PUBLIC")).toBe(clientSentinel);
  expect(Reflect.get(environment, "SECRET")).toBe(serverSentinel);
  const resolved: unknown = Reflect.get(environment, "RESOLVED");
  expect(Redacted.isRedacted(resolved)).toBe(true);
  if (Redacted.isRedacted(resolved)) {
    expect(Redacted.value(resolved)).toBe("resolved:custom-reference");
  }
}

async function verifyTargets(buildBundle: BuildBundle): Promise<void> {
  const fixture = await createFixture();
  const clientBundle = await buildBundle(fixture, "client");
  const serverBundle = await buildBundle(fixture, "server");

  expect(clientBundle.code).toContain(clientSentinel);
  expect(clientBundle.code).not.toContain(serverSentinel);
  expect(clientBundle.code).not.toContain(resolverSentinel);
  expect(serverBundle.code).toContain(clientSentinel);
  expect(serverBundle.code).toContain(serverSentinel);
  expect(serverBundle.code).toContain(resolverSentinel);

  expectClientRuntime(await executeBundle(clientBundle));
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  try {
    expectServerRuntime(await executeBundle(serverBundle));
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", previousWindow);
    }
  }
}

async function buildRollupBundle(
  fixture: BundlerFixture,
  target: BuildTarget,
): Promise<BuiltBundle> {
  const bundle = await rollup({
    input: fixture.entry,
    external: ["effect"],
    plugins: [createSourceResolver(), rollupPlugin({ target }), createTypeScriptTranspiler()],
  });
  try {
    const generated = await bundle.generate({ format: "es" });
    const code = outputChunkCode(generated.output);
    const path = join(fixture.root, `rollup-${target}.mjs`);
    await writeFile(path, code);
    return { code, path };
  } finally {
    await bundle.close();
  }
}

async function buildRolldownBundle(
  fixture: BundlerFixture,
  target: BuildTarget,
): Promise<BuiltBundle> {
  const bundle = await rolldown({
    input: fixture.entry,
    external: ["effect"],
    plugins: [createSourceResolver(), rolldownPlugin({ target }), createTypeScriptTranspiler()],
  });
  try {
    const generated = await bundle.generate({ format: "es" });
    const code = outputChunkCode(generated.output);
    const path = join(fixture.root, `rolldown-${target}.mjs`);
    await writeFile(path, code);
    return { code, path };
  } finally {
    await bundle.close();
  }
}

async function buildEsbuildBundle(
  fixture: BundlerFixture,
  target: BuildTarget,
): Promise<BuiltBundle> {
  const result = await buildWithEsbuild({
    alias: {
      "@ayronforge/envil": envilEntry,
    },
    entryPoints: [fixture.entry],
    bundle: true,
    external: ["effect"],
    format: "esm",
    platform: "node",
    plugins: [esbuildPlugin({ target })],
    treeShaking: true,
    write: false,
  });
  const output = result.outputFiles?.[0];
  if (output === undefined) {
    throw new Error("Expected esbuild to produce an in-memory JavaScript bundle.");
  }
  const path = join(fixture.root, `esbuild-${target}.mjs`);
  await writeFile(path, output.text);
  return { code: output.text, path };
}

async function buildWebpackBundle(
  fixture: BundlerFixture,
  target: BuildTarget,
): Promise<BuiltBundle> {
  const outputPath = join(fixture.root, `webpack-${target}`);
  const compiler = webpack({
    entry: fixture.entry,
    experiments: {
      outputModule: true,
    },
    externals: {
      effect: "module effect",
    },
    externalsType: "module",
    mode: "production",
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          loader: "esbuild-loader",
          options: {
            target: "es2022",
          },
        },
      ],
    },
    optimization: {
      minimize: false,
      usedExports: true,
    },
    output: {
      filename: "bundle.mjs",
      module: true,
      path: outputPath,
    },
    plugins: [WebpackPlugin({ target })],
    resolve: {
      alias: {
        "@ayronforge/envil": envilEntry,
      },
      extensions: [".ts", ".js"],
    },
    target: "node",
  });

  await new Promise<void>((resolveBuild, rejectBuild) => {
    compiler.run((failure, stats) => {
      compiler.close((closeFailure) => {
        const buildFailure =
          failure ??
          closeFailure ??
          (stats === undefined || stats.hasErrors()
            ? new Error(stats?.toString({ all: false, errors: true }) ?? "webpack failed.")
            : undefined);
        if (buildFailure !== undefined) {
          rejectBuild(buildFailure);
          return;
        }
        resolveBuild();
      });
    });
  });

  const path = join(outputPath, "bundle.mjs");
  return { code: await readFile(path, "utf8"), path };
}

async function buildRspackBundle(
  fixture: BundlerFixture,
  target: BuildTarget,
): Promise<BuiltBundle> {
  const outputPath = join(fixture.root, `rspack-${target}`);
  const compiler = rspack({
    entry: fixture.entry,
    experiments: {
      outputModule: true,
    },
    externals: {
      effect: "module effect",
    },
    externalsType: "module",
    mode: "production",
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: {
                syntax: "typescript",
              },
              target: "es2022",
            },
          },
        },
      ],
    },
    optimization: {
      minimize: false,
      usedExports: true,
    },
    output: {
      filename: "bundle.mjs",
      module: true,
      path: outputPath,
    },
    plugins: [RspackPlugin({ target })],
    resolve: {
      alias: {
        "@ayronforge/envil": envilEntry,
      },
      extensions: [".ts", ".js"],
    },
    target: "node",
  });

  await new Promise<void>((resolveBuild, rejectBuild) => {
    compiler.run((failure, stats) => {
      compiler.close((closeFailure) => {
        const buildFailure =
          failure ??
          closeFailure ??
          (stats === undefined || stats.hasErrors()
            ? new Error(stats?.toString({ all: false, errors: true }) ?? "Rspack failed.")
            : undefined);
        if (buildFailure !== undefined) {
          rejectBuild(buildFailure);
          return;
        }
        resolveBuild();
      });
    });
  });

  const path = join(outputPath, "bundle.mjs");
  return { code: await readFile(path, "utf8"), path };
}

afterEach(async () => {
  Reflect.deleteProperty(globalThis, runtimeResultKey);
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Envil bundler integration", () => {
  test("compiles and executes client and server targets with Rollup", async () => {
    await verifyTargets(buildRollupBundle);
  });

  test("compiles and executes client and server targets with Rolldown", async () => {
    await verifyTargets(buildRolldownBundle);
  });

  test("compiles and executes client and server targets with esbuild", async () => {
    await verifyTargets(buildEsbuildBundle);
  });

  test("compiles and executes client and server targets with webpack", async () => {
    await verifyTargets(buildWebpackBundle);
  });

  test("compiles and executes client and server targets with Rspack", async () => {
    await verifyTargets(buildRspackBundle);
  });
});
