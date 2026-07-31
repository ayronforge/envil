import { envilUnplugin } from "./unplugin.ts";

/** Envil Rolldown plugin. Pass the target when building server output. */
export const envil = envilUnplugin.rolldown;

export default envil;

export type { EnvilPluginOptions } from "./unplugin.ts";
