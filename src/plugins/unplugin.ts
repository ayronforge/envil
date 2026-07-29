import { createUnplugin } from "unplugin";

import {
  transformEnvilModule,
  type EnvilBuildTarget,
  type EnvilPluginOptions,
} from "./transform.ts";

const pluginName = "@ayronforge/envil";

function transformForTarget(code: string, id: string, target: EnvilBuildTarget) {
  const transformed = transformEnvilModule(code, id, target);
  return transformed === undefined ? undefined : { code: transformed, map: null };
}

export const envilUnplugin = createUnplugin<EnvilPluginOptions | undefined>((options, meta) => {
  const defaultTarget = options?.target ?? "client";

  if (meta.framework === "vite") {
    return {
      name: pluginName,
      enforce: "pre",
      vite: {
        config: () => ({
          optimizeDeps: {
            exclude: ["@ayronforge/envil"],
          },
        }),
        transform(
          code: string,
          id: string,
          transformOptions: { readonly ssr?: boolean } | undefined,
        ) {
          const target = transformOptions?.ssr ? "server" : "client";
          return transformForTarget(code, id, target);
        },
      },
    };
  }

  return {
    name: pluginName,
    enforce: "pre",
    transform(code, id) {
      return transformForTarget(code, id, defaultTarget);
    },
  };
});

export type { EnvilBuildTarget, EnvilPluginOptions } from "./transform.ts";
