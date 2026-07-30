import { describe, expect, test } from "bun:test";

import { transformEnvilModule } from "./transform.ts";

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
