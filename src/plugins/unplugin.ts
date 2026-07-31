import { dirname } from "node:path";

import type { PluginContext as RolldownPluginContext } from "rolldown";
import type { PluginContext as RollupPluginContext } from "rollup";
import { createUnplugin, type NativeBuildContext } from "unplugin";

import {
  createExportOriginCache,
  transformEnvilModule,
  transformResolvedEnvilModule,
  type EnvilBuildTarget,
  type EnvilPluginOptions,
} from "./transform.ts";
import type { ExportOriginCache, ModuleResolver } from "./transform/ast.ts";

const pluginName = "@ayronforge/envil";

function nativeModuleResolver(context: NativeBuildContext): ModuleResolver | undefined {
  if (context.framework === "esbuild") {
    return async (specifier, importer) => {
      const resolved = await context.build.resolve(specifier, {
        kind: "import-statement",
        resolveDir: dirname(importer),
      });
      return resolved.errors.length > 0 || resolved.external || resolved.path === ""
        ? undefined
        : resolved.path;
    };
  }
  if (context.framework === "webpack") {
    const resolve = context.loaderContext?.getResolve({ dependencyType: "esm" });
    return resolve === undefined
      ? undefined
      : async (specifier, importer) => resolve(dirname(importer), specifier);
  }
  if (context.framework === "rspack") {
    const loaderContext = context.loaderContext;
    return loaderContext === undefined
      ? undefined
      : (specifier, importer) =>
          new Promise((resolve, reject) => {
            loaderContext.resolve(dirname(importer), specifier, (error, resolved) => {
              if (error !== null && error !== undefined) {
                reject(error);
                return;
              }
              resolve(typeof resolved === "string" ? resolved : undefined);
            });
          });
  }
  return undefined;
}

function rollupModuleResolver(context: RollupPluginContext): ModuleResolver {
  return async (specifier, importer) => {
    const resolved = await context.resolve(specifier, importer, { skipSelf: true });
    if (resolved === null || resolved.external) {
      return undefined;
    }
    context.addWatchFile(resolved.id);
    return resolved.id;
  };
}

function rolldownModuleResolver(context: RolldownPluginContext): ModuleResolver {
  return async (specifier, importer) => {
    const resolved = await context.resolve(specifier, importer, { skipSelf: true });
    if (resolved === null || resolved.external) {
      return undefined;
    }
    context.addWatchFile(resolved.id);
    return resolved.id;
  };
}

async function transformForTarget(
  code: string,
  id: string,
  target: EnvilBuildTarget,
  resolveModule?: ModuleResolver,
  originCache?: ExportOriginCache,
) {
  const transformed =
    resolveModule === undefined
      ? transformEnvilModule(code, id, target)
      : await transformResolvedEnvilModule(code, id, target, resolveModule, originCache);
  return transformed;
}

export const envilUnplugin = createUnplugin<EnvilPluginOptions | undefined>((options) => {
  const defaultTarget = options?.target ?? "client";
  let originCache = createExportOriginCache();

  return {
    name: pluginName,
    enforce: "pre",
    buildStart() {
      originCache = createExportOriginCache();
    },
    async transform(code, id) {
      const nativeContext = this.getNativeBuildContext?.();
      return transformForTarget(
        code,
        id,
        defaultTarget,
        nativeContext === undefined ? undefined : nativeModuleResolver(nativeContext),
        originCache,
      );
    },
    rollup: {
      async transform(this: RollupPluginContext, code, id) {
        return transformForTarget(code, id, defaultTarget, rollupModuleResolver(this), originCache);
      },
    },
    rolldown: {
      async transform(this: RolldownPluginContext, code, id) {
        return transformForTarget(
          code,
          id,
          defaultTarget,
          rolldownModuleResolver(this),
          originCache,
        );
      },
    },
    vite: {
      config: () => ({
        optimizeDeps: {
          exclude: ["@ayronforge/envil"],
        },
      }),
      async transform(
        this: RollupPluginContext,
        code: string,
        id: string,
        transformOptions: { readonly ssr?: boolean } | undefined,
      ) {
        const target = transformOptions?.ssr ? "server" : "client";
        return transformForTarget(code, id, target, rollupModuleResolver(this), originCache);
      },
    },
  };
});

export type { EnvilBuildTarget, EnvilPluginOptions } from "./transform.ts";
