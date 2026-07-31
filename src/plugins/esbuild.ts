import { envilUnplugin } from "./unplugin.ts";

/** Envil esbuild plugin. Pass the target when building server output. */
export const envil = envilUnplugin.esbuild;

export default envil;

export type { EnvilPluginOptions } from "./unplugin.ts";
