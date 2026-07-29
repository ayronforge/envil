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
});
