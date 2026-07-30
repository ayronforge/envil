export const vite = { prefix: "VITE_" } as const;

const expoRuntimeEnvMarker = Symbol.for("@ayronforge/envil/expo-runtime-env");

/**
 * Client fragment options for Expo.
 *
 * The Envil Expo compiler replaces the marker with statically referenced
 * `process.env.EXPO_PUBLIC_*` properties from the client schema.
 */
export const expo = {
  prefix: "EXPO_PUBLIC_",
  runtimeEnv: Object.freeze({ [expoRuntimeEnvMarker]: true }),
} as const;

export const sveltekit = { prefix: "PUBLIC_" } as const;
export const astro = { prefix: "PUBLIC_" } as const;
