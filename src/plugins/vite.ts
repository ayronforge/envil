import { envilUnplugin } from "./unplugin.ts";
/** Controls Envil's Vite transform. The runtime target is detected automatically. */
export interface EnvilPluginOptions {
  readonly target?: never;
}

/** Envil Vite plugin with automatic client and SSR target detection. */
export const envil = (options?: EnvilPluginOptions) => envilUnplugin.vite(options);

export default envil;
