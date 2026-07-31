import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Redacted } from "effect";
import { build } from "vite";

import envil from "./vite.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Envil Vite integration", () => {
  test("compiles and executes independent client and SSR targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "envil-vite-"));
    temporaryDirectories.push(root);
    const entry = join(root, "entry.ts");
    const clientOutDir = join(root, "dist-client");
    const serverOutDir = join(root, "dist-server");
    const dependencyRoot = join(root, "node_modules", "envil-definitions");

    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(
      join(dependencyRoot, "server-only.js"),
      `export const dependencySecret = "DEPENDENCY_SERVER_ONLY_SENTINEL";\n`,
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

export const dependencyFragment = server(
  { DEPENDENCY_SECRET: requiredString },
  { runtimeEnv: { DEPENDENCY_SECRET: dependencySecret } },
);
`,
    );
    await writeFile(
      join(root, "server-only.ts"),
      `
export const readServerValue = () => "IMPORTED_SERVER_ONLY_SENTINEL";
`,
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
import { dependencyFragment } from "envil-definitions";
import * as mixed from "./mixed-barrel.ts";
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

export const mixedNamespaceValue = mixed.server("MIXED_NAMESPACE_SENTINEL");

const baseEnv = createEnv(
  shared({ APP_NAME: "Base" }),
  dependencyFragment,
  client(
    { CLIENT_ONLY_SENTINEL: requiredString },
    {
      runtimeEnv: new Map([["WEB_CLIENT_ONLY_SENTINEL", "public"]]),
      prefix: "WEB_",
    },
  ),
);

const appEnv = baseEnv.pipe(
  extendEnv(
    createEnv(
      server(
        {
          SERVER_ONLY_SENTINEL: requiredString.pipe(fromEnv("service.secret")),
          RESOLVED_SECRET: requiredString.pipe(
            fromResolver(
              configureResolver(
                {
                  name: "CUSTOM_RESOLVER_SERVER_ONLY_SENTINEL",
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
              ),
              "custom-reference",
            ),
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

export const runClient = () => Effect.runSync(appEnv.client);
export const runServer = () => Effect.runSync(Effect.result(appEnv.server));
export const revealRedacted = (value) => Redacted.value(value);
`,
    );

    const sharedConfig = {
      root,
      logLevel: "silent",
      plugins: [envil()],
      resolve: {
        alias: [
          {
            find: "#envil-barrel",
            replacement: join(root, "envil-package.ts"),
          },
          {
            find: "@ayronforge/envil",
            replacement: resolve(import.meta.dir, "../index.ts"),
          },
          {
            find: "envil-definitions",
            replacement: join(dependencyRoot, "index.js"),
          },
          {
            find: /^effect$/,
            replacement: resolve(import.meta.dir, "../../node_modules/effect/dist/index.js"),
          },
        ],
      },
    } as const;

    await build({
      ...sharedConfig,
      build: {
        outDir: clientOutDir,
        emptyOutDir: true,
        lib: {
          entry,
          formats: ["es"],
          fileName: () => "bundle.js",
        },
      },
    });
    await build({
      ...sharedConfig,
      build: {
        outDir: serverOutDir,
        emptyOutDir: true,
        ssr: entry,
        rollupOptions: {
          output: {
            entryFileNames: "bundle.mjs",
          },
        },
      },
    });

    const clientBundlePath = join(clientOutDir, "bundle.js");
    const serverBundlePath = join(serverOutDir, "bundle.mjs");
    const clientBundle = await readFile(clientBundlePath, "utf8");
    const serverBundle = await readFile(serverBundlePath, "utf8");
    expect(clientBundle).not.toContain("IMPORTED_SERVER_ONLY_SENTINEL");
    expect(clientBundle).not.toContain("CUSTOM_RESOLVER_SERVER_ONLY_SENTINEL");
    expect(clientBundle).not.toContain("DEPENDENCY_SERVER_ONLY_SENTINEL");
    expect(clientBundle).toContain("MIXED_NAMESPACE_SENTINEL");
    expect(clientBundle).not.toContain("__ENVIL_RUNTIME_TARGET__");
    expect(clientBundle).toContain("CLIENT_ONLY_SENTINEL");
    expect(serverBundle).toContain("IMPORTED_SERVER_ONLY_SENTINEL");
    expect(serverBundle).toContain("CUSTOM_RESOLVER_SERVER_ONLY_SENTINEL");
    expect(serverBundle).toContain("DEPENDENCY_SERVER_ONLY_SENTINEL");
    expect(serverBundle).toContain("MIXED_NAMESPACE_SENTINEL");
    expect(serverBundle).not.toContain("__ENVIL_RUNTIME_TARGET__");
    expect(serverBundle).toContain("CLIENT_ONLY_SENTINEL");

    const clientModule: unknown = await import(
      `${pathToFileURL(clientBundlePath).href}?target=client`
    );
    const serverModule: unknown = await import(
      `${pathToFileURL(serverBundlePath).href}?target=server`
    );
    if (
      typeof clientModule !== "object" ||
      clientModule === null ||
      typeof Reflect.get(clientModule, "runServer") !== "function" ||
      typeof Reflect.get(clientModule, "runClient") !== "function" ||
      typeof serverModule !== "object" ||
      serverModule === null ||
      typeof Reflect.get(serverModule, "runServer") !== "function" ||
      typeof Reflect.get(serverModule, "revealRedacted") !== "function"
    ) {
      throw new Error("Expected both Vite targets to export their environment runners.");
    }

    const clientEnvironment: unknown = Reflect.apply(
      Reflect.get(clientModule, "runClient"),
      undefined,
      [],
    );
    const blockedServer: unknown = Reflect.apply(
      Reflect.get(clientModule, "runServer"),
      undefined,
      [],
    );
    const serverResult: unknown = Reflect.apply(
      Reflect.get(serverModule, "runServer"),
      undefined,
      [],
    );
    if (
      typeof clientEnvironment !== "object" ||
      clientEnvironment === null ||
      typeof blockedServer !== "object" ||
      blockedServer === null ||
      typeof serverResult !== "object" ||
      serverResult === null
    ) {
      throw new Error("Expected the Vite targets to execute real Envil Effects.");
    }

    expect(Reflect.get(clientEnvironment, "APP_NAME")).toBe("Application");
    expect(Reflect.get(clientEnvironment, "CLIENT_ONLY_SENTINEL")).toBe("public");
    expect(Reflect.get(blockedServer, "_tag")).toBe("Failure");
    const failure: unknown = Reflect.get(blockedServer, "failure");
    if (typeof failure !== "object" || failure === null) {
      throw new Error("Expected the client target to return a typed server-access failure.");
    }
    expect(Reflect.get(failure, "name")).toBe("ServerEnvironmentAccessError");

    expect(Reflect.get(serverResult, "_tag")).toBe("Success");
    const serverEnvironment: unknown = Reflect.get(serverResult, "success");
    if (typeof serverEnvironment !== "object" || serverEnvironment === null) {
      throw new Error("Expected the SSR target to materialize the server environment.");
    }
    expect(Reflect.get(serverEnvironment, "SERVER_ONLY_SENTINEL")).toBe(
      "IMPORTED_SERVER_ONLY_SENTINEL",
    );
    expect(Reflect.get(serverEnvironment, "APP_NAME")).toBe("Application");
    expect(Reflect.get(serverEnvironment, "CLIENT_ONLY_SENTINEL")).toBe("public");
    const resolvedSecret: unknown = Reflect.get(serverEnvironment, "RESOLVED_SECRET");
    expect(Redacted.isRedacted(resolvedSecret)).toBe(true);
    if (Redacted.isRedacted(resolvedSecret)) {
      expect(
        Reflect.apply(Reflect.get(serverModule, "revealRedacted"), undefined, [resolvedSecret]),
      ).toBe("resolved:custom-reference");
    }
  }, 30_000);

  test("invalidates resolved barrel origins during development updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "envil-vite-watch-"));
    temporaryDirectories.push(root);
    const barrel = join(root, "envil-barrel.ts");
    const entry = join(root, "entry.ts");
    await writeFile(barrel, 'export { server as fragment } from "@ayronforge/envil";\n');
    const source =
      'import { fragment } from "./envil-barrel.ts"; export const value = fragment({ SECRET: "x" });\n';
    await writeFile(entry, source);
    const plugin = envil();
    if (typeof plugin.buildStart !== "function" || typeof plugin.transform !== "function") {
      throw new Error("Expected Vite buildStart and transform hooks.");
    }
    const context = {
      addWatchFile() {},
      async resolve(specifier: string, importer: string) {
        return specifier === "./envil-barrel.ts" && importer === entry
          ? { id: barrel, external: false }
          : null;
      },
    };

    await Reflect.apply(plugin.buildStart, context, []);
    const initial: unknown = await Reflect.apply(plugin.transform, context, [
      source,
      entry,
      undefined,
    ]);
    if (typeof initial !== "object" || initial === null) {
      throw new Error("Expected the initial client transform.");
    }
    expect(Reflect.get(initial, "code")).not.toContain("fragment({ SECRET");

    await writeFile(barrel, "export const fragment = (value) => value;\n");
    if (typeof plugin.watchChange !== "function") {
      throw new Error("Expected a Vite watchChange hook.");
    }
    await Reflect.apply(plugin.watchChange, context, [barrel, { event: "update" }]);
    const updated: unknown = await Reflect.apply(plugin.transform, context, [
      source,
      entry,
      undefined,
    ]);
    const updatedCode =
      typeof updated === "object" && updated !== null ? Reflect.get(updated, "code") : source;
    expect(updatedCode).toContain("fragment({ SECRET");
  });
});
