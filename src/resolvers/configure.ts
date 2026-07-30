import type { ConfiguredResolver, ResolverAdapter } from "./types.ts";

/**
 * Configures provider-wide resolver options once so variables only declare
 * their own provider reference.
 */
export function configureResolver<
  const Name extends string,
  Reference,
  Options extends object,
  Error,
  Requirements,
>(
  adapter: ResolverAdapter<Name, Reference, Options, Error, Requirements>,
  options: Options,
): ConfiguredResolver<Name, Reference, Error, Requirements> {
  const configuredOptions = { ...options };
  return Object.freeze({
    name: adapter.name,
    resolve: <const Keys extends string>(referencesByKey: Readonly<Record<Keys, Reference>>) =>
      adapter.resolve({ ...configuredOptions, referencesByKey }),
  });
}
