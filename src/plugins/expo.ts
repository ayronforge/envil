import { transformEnvilModule, type EnvilBuildTarget } from "./transform.ts";

interface BabelApi {
  readonly caller: (callback: (caller: unknown) => boolean) => boolean;
}

interface BabelParserOptions {
  readonly sourceFilename?: string;
}

interface BabelTransformOptions {
  readonly filename?: string;
}

interface BabelPlugin {
  readonly name: string;
  readonly manipulateOptions: (options: BabelTransformOptions) => void;
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
  let sourceFilename = "envil-expo.ts";
  const target: EnvilBuildTarget = api.caller(
    (caller) =>
      typeof caller === "object" && caller !== null && Reflect.get(caller, "isServer") === true,
  )
    ? "server"
    : "client";

  return {
    name: "@ayronforge/envil/expo",
    manipulateOptions(options) {
      sourceFilename = options.filename ?? sourceFilename;
    },
    parserOverride(code, parserOptions, parse) {
      const id = parserOptions.sourceFilename ?? sourceFilename;
      return parse(transformEnvilModule(code, id, target)?.code ?? code, parserOptions);
    },
  };
}
