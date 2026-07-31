import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const dependencySentinel = "DEPENDENCY_SERVER_ONLY_SENTINEL";
const transitiveDependencySentinel = "TRANSITIVE_DEPENDENCY_SERVER_ONLY_SENTINEL";
const defaultImportSentinel = "DEFAULT_IMPORTED_SERVER_ONLY_SENTINEL";
const namespaceReexportSentinel = "NAMESPACE_REEXPORTED_SERVER_ONLY_SENTINEL";
const namespaceSentinel = "MIXED_NAMESPACE_SENTINEL";
const clientSentinel = "CLIENT_ONLY_SENTINEL";
let importSequence = 0;

async function createFixture(): Promise<BundlerFixture> {
  const root = await mkdtemp(join(process.cwd(), ".envil-bundler-"));
  temporaryDirectories.push(root);
  const entry = join(root, "entry.ts");
  const dependencyRoot = join(root, "node_modules", "envil-definitions");
  const transitiveDependencyRoot = join(root, "node_modules", "envil-consumer");

  await mkdir(dependencyRoot, { recursive: true });
  await mkdir(transitiveDependencyRoot, { recursive: true });
  await writeFile(
    join(dependencyRoot, "server-only.js"),
    `export const dependencySecret = "${dependencySentinel}";\n`,
  );
  await writeFile(
    join(dependencyRoot, "package.json"),
    JSON.stringify({
      name: "envil-definitions",
      peerDependencies: {
        "@ayronforge/envil": "*",
      },
    }),
  );
  await writeFile(
    join(dependencyRoot, "envil-barrel.js"),
    `export { requiredString, server } from "@ayronforge/envil";\n`,
  );
  await writeFile(
    join(dependencyRoot, "index.js"),
    `
import { requiredString, server } from "./envil-barrel.js";
import { dependencySecret } from "./server-only.js";

export { requiredString, server };
export const dependencyFragment = server(
  { DEPENDENCY_SECRET: requiredString },
  { runtimeEnv: { DEPENDENCY_SECRET: dependencySecret } },
);
`,
  );
  await writeFile(
    join(transitiveDependencyRoot, "server-only.js"),
    `export const transitiveDependencySecret = "${transitiveDependencySentinel}";\n`,
  );
  await writeFile(
    join(transitiveDependencyRoot, "package.json"),
    JSON.stringify({
      name: "envil-consumer",
      dependencies: {
        "envil-definitions": "*",
      },
    }),
  );
  await writeFile(
    join(transitiveDependencyRoot, "index.js"),
    `
import { requiredString, server } from "envil-definitions";
import { transitiveDependencySecret } from "./server-only.js";

export const transitiveDependencyFragment = server(
  { TRANSITIVE_DEPENDENCY_SECRET: requiredString },
  { runtimeEnv: { TRANSITIVE_DEPENDENCY_SECRET: transitiveDependencySecret } },
);
`,
  );
  await writeFile(
    join(root, "server-only.ts"),
    `export const readServerValue = () => "${serverSentinel}";\n`,
  );
  await writeFile(
    join(root, "default-server-only.ts"),
    `export const defaultServerValue = "${defaultImportSentinel}";\n`,
  );
  await writeFile(
    join(root, "default-server-barrel.ts"),
    `export { server as default } from "@ayronforge/envil";\n`,
  );
  await writeFile(
    join(root, "default-server-intermediate.ts"),
    `
import server from "./default-server-barrel.ts";

export const serverFragment = server;
`,
  );
  await writeFile(
    join(root, "namespace-server-only.ts"),
    `export const namespaceServerValue = "${namespaceReexportSentinel}";\n`,
  );
  await writeFile(
    join(root, "namespace-barrel.ts"),
    `export * as envil from "@ayronforge/envil";\n`,
  );
  await writeFile(
    join(root, "envil-core.ts"),
    `
export {
  client as clientFragment,
  configureResolver as configure,
  createEnv as makeEnv,
  extendEnv as extend,
  fromEnv as runtimeName,
  fromResolver as secretReference,
  requiredString as stringValue,
  server as serverFragment,
  shared as sharedFragment,
} from "@ayronforge/envil";
`,
  );
  await writeFile(
    join(root, "envil-barrel.ts"),
    `
export {
  clientFragment as client,
  configure as configureResolver,
  makeEnv as createEnv,
  extend as extendEnv,
  runtimeName as fromEnv,
  secretReference as fromResolver,
  stringValue as requiredString,
  serverFragment as server,
  sharedFragment as shared,
} from "./envil-core.ts";
`,
  );
  await writeFile(join(root, "envil-package.ts"), `export * from "./envil-barrel.ts";\n`);
  await writeFile(
    join(root, "mixed-barrel.ts"),
    `
export { client } from "@ayronforge/envil";
export const server = (value) => value;
`,
  );
  await writeFile(
    entry,
    `
import { Effect, Option, Redacted } from "effect";
import { transitiveDependencyFragment } from "envil-consumer";
import { dependencyFragment } from "envil-definitions";
import * as mixed from "./mixed-barrel.ts";
import { envil as namespaceEnvil } from "./namespace-barrel.ts";
import { serverFragment as defaultServer } from "./default-server-intermediate.ts";
import { defaultServerValue } from "./default-server-only.ts";
import { namespaceServerValue } from "./namespace-server-only.ts";
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
} from "#envil-barrel";
import { readServerValue } from "./server-only.ts";

const localServer = server;
const mixedNamespaceValue = mixed.server("${namespaceSentinel}");
const defaultFragment = defaultServer(
  { DEFAULT_SECRET: requiredString },
  { runtimeEnv: { DEFAULT_SECRET: defaultServerValue } },
);
const namespaceFragment = namespaceEnvil.server(
  { NAMESPACE_SECRET: namespaceEnvil.requiredString },
  { runtimeEnv: { NAMESPACE_SECRET: namespaceServerValue } },
);

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
  dependencyFragment,
  transitiveDependencyFragment,
  defaultFragment,
  namespaceFragment,
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
      localServer(
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
  mixedNamespaceValue,
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

function createSourceResolver(fixture: BundlerFixture) {
  return {
    name: "envil-integration-source",
    resolveId(source: string) {
      if (source === "@ayronforge/envil") {
        return envilEntry;
      }
      if (source === "envil-definitions") {
        return join(fixture.root, "node_modules", "envil-definitions", "index.js");
      }
      if (source === "envil-consumer") {
        return join(fixture.root, "node_modules", "envil-consumer", "index.js");
      }
      return source === "#envil-barrel" ? join(fixture.root, "envil-package.ts") : null;
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
  expect(Reflect.get(result, "mixedNamespaceValue")).toBe(namespaceSentinel);
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
  expect(Reflect.get(environment, "DEFAULT_SECRET")).toBe(defaultImportSentinel);
  expect(Reflect.get(environment, "NAMESPACE_SECRET")).toBe(namespaceReexportSentinel);
  expect(Reflect.get(environment, "DEPENDENCY_SECRET")).toBe(dependencySentinel);
  expect(Reflect.get(environment, "TRANSITIVE_DEPENDENCY_SECRET")).toBe(
    transitiveDependencySentinel,
  );
  expect(Reflect.get(result, "mixedNamespaceValue")).toBe(namespaceSentinel);
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
  expect(clientBundle.code).not.toContain(dependencySentinel);
  expect(clientBundle.code).not.toContain(transitiveDependencySentinel);
  expect(clientBundle.code).not.toContain(defaultImportSentinel);
  expect(clientBundle.code).not.toContain(namespaceReexportSentinel);
  expect(clientBundle.code).toContain(namespaceSentinel);
  expect(serverBundle.code).toContain(clientSentinel);
  expect(serverBundle.code).toContain(serverSentinel);
  expect(serverBundle.code).toContain(resolverSentinel);
  expect(serverBundle.code).toContain(dependencySentinel);
  expect(serverBundle.code).toContain(transitiveDependencySentinel);
  expect(serverBundle.code).toContain(defaultImportSentinel);
  expect(serverBundle.code).toContain(namespaceReexportSentinel);
  expect(serverBundle.code).toContain(namespaceSentinel);

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
    plugins: [
      createSourceResolver(fixture),
      rollupPlugin({ target }),
      createTypeScriptTranspiler(),
    ],
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
    plugins: [
      createSourceResolver(fixture),
      rolldownPlugin({ target }),
      createTypeScriptTranspiler(),
    ],
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
      "#envil-barrel": join(fixture.root, "envil-package.ts"),
      "@ayronforge/envil": envilEntry,
      "envil-consumer": join(fixture.root, "node_modules", "envil-consumer", "index.js"),
      "envil-definitions": join(fixture.root, "node_modules", "envil-definitions", "index.js"),
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
        "#envil-barrel": join(fixture.root, "envil-package.ts"),
        "@ayronforge/envil": envilEntry,
        "envil-consumer": join(fixture.root, "node_modules", "envil-consumer", "index.js"),
        "envil-definitions": join(fixture.root, "node_modules", "envil-definitions", "index.js"),
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
        "#envil-barrel": join(fixture.root, "envil-package.ts"),
        "@ayronforge/envil": envilEntry,
        "envil-consumer": join(fixture.root, "node_modules", "envil-consumer", "index.js"),
        "envil-definitions": join(fixture.root, "node_modules", "envil-definitions", "index.js"),
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

  test("returns source maps that Rollup composes with its output", async () => {
    const root = await mkdtemp(join(process.cwd(), ".envil-sourcemap-"));
    temporaryDirectories.push(root);
    const entry = join(root, "entry.js");
    const source = `
import { server } from "@ayronforge/envil";
export const fragment = server({
  SECRET: "private",
});
`;
    await writeFile(entry, source);

    const bundle = await rollup({
      input: entry,
      external: ["@ayronforge/envil"],
      plugins: [rollupPlugin({ target: "client" })],
    });
    try {
      const generated = await bundle.generate({ format: "es", sourcemap: true });
      const chunk = generated.output.find((output) => output.type === "chunk");

      expect(chunk?.code).toContain("fragment = undefined");
      expect(chunk?.map?.sourcesContent).toContain(source);
      expect(chunk?.map?.mappings.length).toBeGreaterThan(0);
    } finally {
      await bundle.close();
    }
  });

  test("compiles and executes client and server targets with Rolldown", async () => {
    await verifyTargets(buildRolldownBundle);
  });

  test("compiles and executes client and server targets with esbuild", async () => {
    await verifyTargets(buildEsbuildBundle);
  });

  test("does not read esbuild module IDs owned by custom namespaces", async () => {
    const root = await mkdtemp(join(process.cwd(), ".envil-esbuild-namespace-"));
    temporaryDirectories.push(root);
    const entry = join(root, "entry.js");
    await writeFile(
      entry,
      'import { render } from "virtual-module"; export const result = render();\n',
    );

    const result = await buildWithEsbuild({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      plugins: [
        {
          name: "virtual-module",
          setup(build) {
            build.onResolve({ filter: /^virtual-module$/ }, () => ({
              path: "virtual-module",
              namespace: "virtual",
            }));
            build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
              contents: 'export const render = () => "virtual-result";',
              loader: "js",
            }));
          },
        },
        esbuildPlugin({ target: "client" }),
      ],
      write: false,
    });

    expect(result.outputFiles?.[0]?.text).toContain("virtual-result");
  });

  test("compiles and executes client and server targets with webpack", async () => {
    await verifyTargets(buildWebpackBundle);
  });

  test("compiles and executes client and server targets with Rspack", async () => {
    await verifyTargets(buildRspackBundle);
  });
});
