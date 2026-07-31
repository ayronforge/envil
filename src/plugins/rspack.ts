import { envilUnplugin } from "./unplugin.ts";

/** Envil Rspack plugin. Pass the target when building server output. */
export const EnvilPlugin = envilUnplugin.rspack;

export default EnvilPlugin;

export type { EnvilPluginOptions } from "./unplugin.ts";
