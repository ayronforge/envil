import { describe, expect, test } from "bun:test";

import {
  transformEnvilModule as transformEnvilModuleWithMap,
  type EnvilBuildTarget,
} from "./transform.ts";

function transformEnvilModule(
  code: string,
  id: string,
  target: EnvilBuildTarget,
): string | undefined {
  return transformEnvilModuleWithMap(code, id, target)?.code;
}

const definition = `
import { client, createEnv, server as serverFragment, shared } from "@ayronforge/envil";
import { awsSecretsAdapter } from "@ayronforge/envil/aws";

const makeServerValues = () => ({
  SERVER_ONLY_SENTINEL: awsSecretsAdapter,
});

export const appEnv = createEnv(
  shared({
    APP_NAME: "Envil",
  }),
  serverFragment({
    ...makeServerValues(),
  }),
  client({
    CLIENT_ONLY_SENTINEL: "public",
  }),
);
`;

describe("Envil build transform", () => {
  test("removes an entire server expression from client builds", () => {
    const transformed = transformEnvilModule(definition, "src/env.ts", "client");

    expect(transformed).toBeDefined();
    expect(transformed).not.toContain("...makeServerValues()");
    expect(transformed).toContain("CLIENT_ONLY_SENTINEL");
    expect(transformed).toContain('APP_NAME: "Envil"');
  });

  test("keeps client and server fragments in server builds", () => {
    const transformed = transformEnvilModule(definition, "src/env.ts", "server");
    const output = transformed ?? definition;

    expect(output).toContain("SERVER_ONLY_SENTINEL");
    expect(output).toContain("CLIENT_ONLY_SENTINEL");
    expect(output).toContain('APP_NAME: "Envil"');
  });

  test("supports namespace imports without inspecting fragment contents", () => {
    const source = `
import * as envil from "@ayronforge/envil";
const values = makeArbitraryValues();
export const appEnv = envil.createEnv(envil.server(values), envil.client({ URL: "public" }));
`;
    const transformed = transformEnvilModule(source, "src/env.ts", "client");

    expect(transformed).not.toContain("envil.server(values)");
    expect(transformed).toContain('envil.client({ URL: "public" })');
  });

  test("does not rewrite local bindings that shadow the imported intrinsic", () => {
    const source = `
import { createEnv, server } from "@ayronforge/envil";
const appEnv = createEnv(server({ SECRET: "private" }));
function runCallback(server: () => string) {
  return server();
}
`;
    const transformed = transformEnvilModule(source, "src/env.ts", "client");

    expect(transformed).not.toContain('server({ SECRET: "private" })');
    expect(transformed).toContain("return server();");
  });

  test("injects an exact runtime proof into the Envil runtime", () => {
    const transformed = transformEnvilModule(
      'const target = Reflect.get(globalThis, Symbol.for("__ENVIL_RUNTIME_TARGET__"));',
      "node_modules/@ayronforge/envil/dist/index.js",
      "client",
    );

    expect(transformed).toBe('const target = "client";');
  });

  test("maps all edits from one transform back to the original module", () => {
    const source = `
import { server } from "@ayronforge/envil";
const target = Reflect.get(
  globalThis,
  Symbol.for("__ENVIL_RUNTIME_TARGET__"),
);
const fragment = server({
  SECRET: "private",
});
`;
    const transformed = transformEnvilModuleWithMap(source, "src/env.ts?client", "client");

    expect(transformed?.code).toContain('const target = "client";');
    expect(transformed?.code).toContain("const fragment = undefined;");
    expect(transformed?.map.sources).toEqual(["src/env.ts"]);
    expect(transformed?.map.sourcesContent).toEqual([source]);
    expect(transformed?.map.mappings.length).toBeGreaterThan(0);
  });

  test("removes configured resolvers referenced only by pruned server fragments", () => {
    const source = `
import { configureResolver, createEnv, fromResolver, requiredString, server } from "@ayronforge/envil";
import { adapter } from "./server-adapter.ts";

const secrets = configureResolver(adapter, {});
export const appEnv = createEnv(
  server({ TOKEN: requiredString.pipe(fromResolver(secrets, "token")) }),
);
`;
    const transformed = transformEnvilModule(source, "src/env.ts", "client");

    expect(transformed).not.toContain("const secrets = configureResolver");
    expect(transformed).toContain("createEnv(");
    expect(transformed).toContain("undefined");
  });

  test("keeps configured resolvers that are also used outside a server fragment", () => {
    const source = `
import { configureResolver, createEnv, fromResolver, requiredString, server } from "@ayronforge/envil";
import { adapter } from "./server-adapter.ts";

const secrets = configureResolver(adapter, {});
export const configuredName = secrets.name;
export const appEnv = createEnv(
  server({ TOKEN: requiredString.pipe(fromResolver(secrets, "token")) }),
);
`;
    const transformed = transformEnvilModule(source, "src/env.ts", "client");

    expect(transformed).toContain("const secrets = configureResolver");
    expect(transformed).toContain("configuredName = secrets.name");
  });

  test("keeps exported configured resolvers", () => {
    const source = `
import { configureResolver, fromResolver, requiredString, server } from "@ayronforge/envil";
import { adapter } from "./server-adapter.ts";

export const secrets = configureResolver(adapter, {});
export const fragment = server({
  TOKEN: requiredString.pipe(fromResolver(secrets, "token")),
});
`;
    const transformed = transformEnvilModule(source, "src/env.ts", "client");

    expect(transformed).toContain("export const secrets = configureResolver(adapter, {});");
    expect(transformed).toContain("export const fragment = undefined;");
  });

  test("removes only an unused resolver declarator from a shared statement", () => {
    const source = `
import { configureResolver, fromResolver, requiredString, server } from "@ayronforge/envil";
import { adapter } from "./server-adapter.ts";

const before = 1, secrets = configureResolver(adapter, {}), after = 2;
const leading = configureResolver(adapter, {}), right = 3;
const left = 4, trailing = configureResolver(adapter, {});
export const markers = [before, after];
export const fragment = server({
  TOKEN: requiredString.pipe(fromResolver(secrets, "token")),
  LEADING: requiredString.pipe(fromResolver(leading, "leading")),
  TRAILING: requiredString.pipe(fromResolver(trailing, "trailing")),
});
`;
    const transformed = transformEnvilModule(source, "src/env.ts", "client");

    expect(transformed).toContain("const before = 1, after = 2;");
    expect(transformed).toContain("const right = 3;");
    expect(transformed).toContain("const left = 4;");
    expect(transformed).not.toContain("configureResolver(adapter");
    expect(transformed).toContain("export const markers = [before, after];");
  });

  test("compiles Expo preset keys into static process.env references", () => {
    const source = `
import { client, createEnv, requiredString } from "@ayronforge/envil";
import { expo as expoPreset } from "@ayronforge/envil/presets";

export const appEnv = createEnv(
  client(
    { APP_URL: requiredString, API_TOKEN: requiredString },
    { ...expoPreset, emptyStringAsUndefined: true },
  ),
);
`;
    const transformed = transformEnvilModule(source, "src/env.ts", "client");

    expect(transformed).toContain('"EXPO_PUBLIC_APP_URL": process.env.EXPO_PUBLIC_APP_URL');
    expect(transformed).toContain('"EXPO_PUBLIC_API_TOKEN": process.env.EXPO_PUBLIC_API_TOKEN');
    expect(transformed).toContain("emptyStringAsUndefined: true");
  });

  test("compiles Expo runtime keys without pruning server builds", () => {
    const source = `
import { client, createEnv, requiredString, server } from "@ayronforge/envil";
import { expo } from "@ayronforge/envil/presets";

export const appEnv = createEnv(
  server({ TOKEN: "private" }),
  client({ APP_URL: requiredString }, expo),
);
`;
    const transformed = transformEnvilModule(source, "src/env.ts", "server");

    expect(transformed).toContain('server({ TOKEN: "private" })');
    expect(transformed).toContain('"EXPO_PUBLIC_APP_URL": process.env.EXPO_PUBLIC_APP_URL');
  });

  test("compiles explicit Expo fromEnv names", () => {
    const source = `
import { client, createEnv, fromEnv, requiredString } from "@ayronforge/envil";
import { expo } from "@ayronforge/envil/presets";

export const appEnv = createEnv(
  client(
    { URL: requiredString.pipe(fromEnv("EXPO_PUBLIC_API_URL")) },
    expo,
  ),
);
`;
    const transformed = transformEnvilModule(source, "src/env.ts", "client");

    expect(transformed).toContain('"EXPO_PUBLIC_API_URL": process.env.EXPO_PUBLIC_API_URL');
    expect(transformed).not.toContain('"EXPO_PUBLIC_URL": process.env.EXPO_PUBLIC_URL');
  });

  test("compiles Expo runtime at the spread position", () => {
    const source = `
import { client, requiredString } from "@ayronforge/envil";
import { expo } from "@ayronforge/envil/presets";

const customEnv = {};
client({ URL: requiredString }, { prefix: "EXPO_PUBLIC_ALT_", ...expo });
client({ URL: requiredString }, { runtimeEnv: customEnv, ...expo });
client({ URL: requiredString }, { ...expo, runtimeEnv: customEnv });
`;
    const transformed = transformEnvilModule(source, "src/env.ts", "client");
    const compiledExpo =
      '...{ ...expo, runtimeEnv: { "EXPO_PUBLIC_URL": process.env.EXPO_PUBLIC_URL } }';

    expect(transformed).toContain(`runtimeEnv: customEnv, ${compiledExpo}`);
    expect(transformed).toContain(`${compiledExpo}, runtimeEnv: customEnv`);
  });

  test("rejects prefix overrides after the Expo preset spread", () => {
    const source = `
import { client, requiredString } from "@ayronforge/envil";
import { expo } from "@ayronforge/envil/presets";

client({ URL: requiredString }, { ...expo, prefix: "EXPO_PUBLIC_ALT_" });
`;

    expect(() => transformEnvilModule(source, "src/env.ts", "client")).toThrow(
      'does not support overriding the preset prefix "EXPO_PUBLIC_"',
    );
  });

  test("rejects spreads that can override the Expo preset prefix", () => {
    const source = `
import { client, requiredString } from "@ayronforge/envil";
import { expo } from "@ayronforge/envil/presets";

client({ URL: requiredString }, { ...expo, ...{ prefix: "EXPO_PUBLIC_ALT_" } });
`;

    expect(() => transformEnvilModule(source, "src/env.ts", "client")).toThrow(
      'does not support overriding the preset prefix "EXPO_PUBLIC_"',
    );
  });

  test("fails closed when Expo client keys are not statically enumerable", () => {
    const source = `
import { client, requiredString } from "@ayronforge/envil";
import { expo } from "@ayronforge/envil/presets";
const values = { APP_URL: requiredString };
client(values, expo);
`;

    expect(() => transformEnvilModule(source, "src/env.ts", "client")).toThrow(
      "inline object literal",
    );
  });
});
