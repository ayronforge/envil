import { Data, type Effect, type Option, type Redacted } from "effect";

/** A resolved secret is either present and redacted or legitimately absent. */
export type ResolvedSecret = Option.Option<Redacted.Redacted<string>>;

/** Logical environment values returned by a resolver adapter. */
export type ResolverResult<Keys extends string = string> = Readonly<Record<Keys, ResolvedSecret>>;

interface ResolverFailureFields {
  readonly adapter: string;
  readonly operation: string;
  readonly message: string;
}

/** The adapter configuration is invalid. */
export class ResolverConfigurationError extends Data.TaggedError(
  "ResolverConfigurationError",
)<ResolverFailureFields> {}

/** The provider client could not be initialized. */
export class ResolverInitializationError extends Data.TaggedError(
  "ResolverInitializationError",
)<ResolverFailureFields> {}

/** A provider request failed for a reason other than a reliable not-found signal. */
export class ResolverRequestFailed extends Data.TaggedError(
  "ResolverRequestFailed",
)<ResolverFailureFields> {}

/** A provider response could not be decoded into the requested secret. */
export class ResolverResponseDecodeFailed extends Data.TaggedError(
  "ResolverResponseDecodeFailed",
)<ResolverFailureFields> {}

/** Sanitized failures produced by resolver adapters. */
export type ResolverError =
  | ResolverConfigurationError
  | ResolverInitializationError
  | ResolverRequestFailed
  | ResolverResponseDecodeFailed;

/**
 * Common protocol implemented by all resolver adapters.
 *
 * @template Name Stable, secret-safe adapter name used in inferred contracts.
 * @template Reference Provider-specific secret reference.
 * @template Options Provider-specific options excluding the `secrets` map.
 * @template Error Typed adapter failures.
 * @template Requirements Effect services required by the adapter.
 */
export interface ResolverAdapter<
  Name extends string,
  Reference,
  Options extends object,
  Error,
  Requirements,
> {
  readonly name: Name;
  readonly resolve: <const Keys extends string>(
    options: Options & {
      readonly secrets: Readonly<Record<Keys, Reference>>;
    },
  ) => Effect.Effect<ResolverResult<Keys>, Error, Requirements>;
}

/** Minimal marker shared by resolver adapters before generic extraction. */
export interface AnyResolverAdapter {
  readonly name: string;
}

/** Extracts the stable name carried by an adapter. */
export type AdapterName<Adapter> =
  Adapter extends ResolverAdapter<
    infer Name,
    infer _Reference,
    infer _Options,
    infer _Error,
    infer _Requirements
  >
    ? Name
    : never;

/** Extracts the secret reference type carried by an adapter. */
export type AdapterReference<Adapter> =
  Adapter extends ResolverAdapter<
    infer _Name,
    infer Reference,
    infer _Options,
    infer _Error,
    infer _Requirements
  >
    ? Reference
    : never;

/** Extracts provider-specific options carried by an adapter. */
export type AdapterOptions<Adapter> =
  Adapter extends ResolverAdapter<
    infer _Name,
    infer _Reference,
    infer Options,
    infer _Error,
    infer _Requirements
  >
    ? Options
    : never;

/** Extracts the typed error channel carried by an adapter. */
export type AdapterError<Adapter> =
  Adapter extends ResolverAdapter<
    infer _Name,
    infer _Reference,
    infer _Options,
    infer Error,
    infer _Requirements
  >
    ? Error
    : never;

/** Extracts Effect requirements carried by an adapter. */
export type AdapterRequirements<Adapter> =
  Adapter extends ResolverAdapter<
    infer _Name,
    infer _Reference,
    infer _Options,
    infer _Error,
    infer Requirements
  >
    ? Requirements
    : never;

/**
 * A configured adapter retained by `createEnv` until resolver execution.
 *
 * Its generic parameters are also the type-only source metadata used by the
 * environment contract.
 */
export interface ResolverDefinition<Name extends string, Keys extends string, Error, Requirements> {
  readonly adapterName: Name;
  readonly keys: ReadonlyArray<Keys>;
  readonly effect: Effect.Effect<ResolverResult<Keys>, Error, Requirements>;
}

/** Any configured resolver definition. */
export type AnyResolverDefinition = ResolverDefinition<string, string, unknown, unknown>;
