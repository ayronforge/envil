import { envilUnplugin } from "./unplugin.ts";

/** Envil Rollup plugin. Pass the target when building server output. */
export const envil = envilUnplugin.rollup;

export default envil;

export type { EnvilPluginOptions } from "./unplugin.ts";
