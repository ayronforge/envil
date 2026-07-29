import { envilUnplugin } from "./unplugin.ts";

/** Envil webpack plugin. Pass the target when building server output. */
export const EnvilPlugin = envilUnplugin.webpack;

export default EnvilPlugin;

export type { EnvilPluginOptions } from "./unplugin.ts";
