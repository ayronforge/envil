import { transformEnvilModule, type EnvilBuildTarget } from "./transform.ts";

interface BabelApi {
  readonly caller: (callback: (caller: unknown) => boolean) => boolean;
}

interface BabelParserOptions {
  readonly sourceFilename?: string;
}

interface BabelPlugin {
  readonly name: string;
  readonly parserOverride: (
    code: string,
    parserOptions: BabelParserOptions,
    parse: (code: string, parserOptions: BabelParserOptions) => unknown,
  ) => unknown;
}

/**
 * Babel plugin for Expo that runs the Envil compiler before Expo inlines
 * `process.env.EXPO_PUBLIC_*` references.
 */
export default function envilExpoPlugin(api: BabelApi): BabelPlugin {
  const target: EnvilBuildTarget = api.caller(
    (caller) =>
      typeof caller === "object" && caller !== null && Reflect.get(caller, "isServer") === true,
  )
    ? "server"
    : "client";

  return {
    name: "@ayronforge/envil/expo",
    parserOverride(code, parserOptions, parse) {
      const id = parserOptions.sourceFilename ?? "envil-expo.ts";
      return parse(transformEnvilModule(code, id, target) ?? code, parserOptions);
    },
  };
}
