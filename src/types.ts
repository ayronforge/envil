import type { Effect, Pipeable, Redacted, Schema } from "effect";

import type { EnvConfigurationError, EnvValidationError } from "./errors.ts";
import type {
  AnyConfiguredResolver,
  ConfiguredResolverError,
  ConfiguredResolverRequirements,
} from "./resolvers/types.ts";
import type {
  EnvVariableSource,
  ResolverVariableSource,
  SourcedVariable,
  VariableSource,
} from "./variable-source.ts";

/** Any Effect Schema accepted in an environment fragment. */
export type AnySchema = Schema.Top;

/** One environment variable schema, optionally paired with an explicit source. */
export type VariableDefinition = AnySchema | SourcedVariable<AnySchema, VariableSource>;

/** Values declared by one server, client, or shared fragment. */
export type EnvValues = Readonly<Record<string, unknown>>;

/** Scalar value that can be embedded directly in an environment fragment. */
export type StaticScalar = string | number | boolean | null | undefined;

/**
 * Runtime values supplied as an object, parsed JSON object, or Map.
 *
 * Object sources support exact keys and dot-separated paths into nested JSON.
 * Map sources always use exact keys.
 */
export type RuntimeEnv = Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown>;

/** Runtime targeted by an environment fragment. */
export type EnvFragmentTarget = "server" | "client" | "shared";

declare const ENV_FRAGMENT_BRAND: unique symbol;
declare const APP_ENV_BRAND: unique symbol;
declare const APP_ENV_TYPES: unique symbol;

/**
 * One immutable environment fragment.
 *
 * Values may contain any Effect Schema or static value. Runtime options belong
 * to the fragment so independently authored contexts remain composable.
 */
export interface EnvFragment<
  Target extends EnvFragmentTarget,
  Values extends EnvValues,
  Prefix extends string | undefined,
  Runtime extends RuntimeEnv | undefined,
> {
  readonly target: Target;
  readonly values: Values;
  readonly prefix: Prefix;
  readonly runtimeEnv: Runtime;
  readonly emptyStringAsUndefined: boolean | undefined;
  readonly [ENV_FRAGMENT_BRAND]: {
    readonly target: Target;
    readonly values: Values;
    readonly prefix: Prefix;
    readonly runtime: Runtime;
  };
}

/** Any environment fragment after its public generics are erased. */
export type AnyEnvFragment = EnvFragment<
  EnvFragmentTarget,
  EnvValues,
  string | undefined,
  RuntimeEnv | undefined
>;

interface VariableEntry<
  Definition extends VariableDefinition,
  Prefix extends string | undefined,
  Target extends "server" | "client",
> {
  readonly _tag: "variable";
  readonly definition: Definition;
  readonly prefix: Prefix;
  readonly target: Target;
}

interface StaticEntry<Value, Target extends EnvFragmentTarget> {
  readonly _tag: "static";
  readonly value: Value;
  readonly target: Target;
}

type AnyDefinitionEntry =
  | VariableEntry<VariableDefinition, string | undefined, "server" | "client">
  | StaticEntry<unknown, EnvFragmentTarget>;
type DefinitionEntries = Readonly<Record<string, AnyDefinitionEntry>>;

type NonUndefined<Value> = Exclude<Value, undefined>;
type OptionalityValue<Value> = Value extends Redacted.Redacted<infer Inner> ? Inner : Value;
type IsOptional<SchemaValue extends AnySchema> =
  undefined extends OptionalityValue<Schema.Schema.Type<SchemaValue>> ? true : false;
type IsRedacted<Value> =
  Extract<NonUndefined<Value>, Redacted.Redacted<unknown>> extends never ? false : true;
type Unredacted<Value> =
  NonUndefined<Value> extends Redacted.Redacted<infer Inner> ? Inner : NonUndefined<Value>;
type Redact<Value> =
  NonUndefined<Value> extends Redacted.Redacted<unknown>
    ? NonUndefined<Value>
    : Redacted.Redacted<NonUndefined<Value>>;
type NormalizeSchemaOutput<Value> =
  Value extends Redacted.Redacted<infer Inner>
    ? undefined extends Inner
      ? Redacted.Redacted<Exclude<Inner, undefined>> | undefined
      : Value
    : Value;

type SchemaOf<Variable> =
  Variable extends SourcedVariable<infer SchemaValue, infer _Source>
    ? SchemaValue
    : Variable extends AnySchema
      ? Variable
      : never;
type SourceOf<Variable> =
  Variable extends SourcedVariable<infer _SchemaValue, infer Source> ? Source : never;
type ResolverOf<Variable> = [SourceOf<Variable>] extends [never]
  ? never
  : SourceOf<Variable> extends ResolverVariableSource<
        infer Resolver extends AnyConfiguredResolver,
        infer _Reference
      >
    ? Resolver
    : never;

type VariableOutput<Variable extends VariableDefinition> =
  ResolverOf<Variable> extends never
    ? NormalizeSchemaOutput<Schema.Schema.Type<SchemaOf<Variable>>>
    : IsOptional<SchemaOf<Variable>> extends true
      ? Redact<Unredacted<Schema.Schema.Type<SchemaOf<Variable>>>> | undefined
      : Redact<Unredacted<Schema.Schema.Type<SchemaOf<Variable>>>>;

type EntryOutput<Entry> =
  Entry extends VariableEntry<infer Definition, infer _Prefix, infer _Target>
    ? VariableOutput<Definition>
    : Entry extends StaticEntry<infer Value, infer Target>
      ? Target extends "shared"
        ? DeepReadonly<Value>
        : Value
      : never;

type DeepReadonly<Value> = Value extends StaticScalar
  ? Value
  : Value extends readonly unknown[]
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value extends Readonly<Record<PropertyKey, unknown>>
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;

type Simplify<Value> = { readonly [Key in keyof Value]: Value[Key] };
type ContextOutput<Entries extends DefinitionEntries> = Simplify<{
  readonly [Key in keyof Entries]: EntryOutput<Entries[Key]>;
}>;

type PrefixValue<Prefix extends string | undefined> = Prefix extends string ? Prefix : "";
type RuntimeKey<Variable, Key extends string, Prefix extends string | undefined> = [
  SourceOf<Variable>,
] extends [never]
  ? `${PrefixValue<Prefix>}${Key}`
  : SourceOf<Variable> extends EnvVariableSource<infer Name>
    ? Name
    : SourceOf<Variable> extends ResolverVariableSource<
          infer _Resolver extends AnyConfiguredResolver,
          infer _Reference
        >
      ? ""
      : `${PrefixValue<Prefix>}${Key}`;
type SourceKind<Variable> = [SourceOf<Variable>] extends [never]
  ? "env"
  : SourceOf<Variable> extends ResolverVariableSource<
        infer _Resolver extends AnyConfiguredResolver,
        infer _Reference
      >
    ? "resolver"
    : "env";

/** Safe structural metadata retained only in TypeScript types for CLI inspection. */
export interface EnvVariableContract<
  Value,
  Encoded,
  Key extends string,
  RuntimeName extends string,
  Secret extends boolean,
  Source extends string,
  Optional extends boolean,
> {
  readonly value: Value;
  readonly encoded: Encoded;
  readonly key: Key;
  readonly runtimeKey: RuntimeName;
  readonly secret: Secret;
  readonly source: Source;
  readonly optional: Optional;
}

type ContextContract<Entries extends DefinitionEntries, Target extends "server" | "client"> = {
  readonly [Key in keyof Entries & string as Entries[Key] extends VariableEntry<
    VariableDefinition,
    string | undefined,
    Target
  >
    ? Key
    : never]: Entries[Key] extends VariableEntry<
    infer Definition,
    infer Prefix extends string | undefined,
    Target
  >
    ? EnvVariableContract<
        VariableOutput<Definition>,
        Schema.Codec.Encoded<SchemaOf<Definition>>,
        Key,
        RuntimeKey<Definition, Key, Prefix>,
        ResolverOf<Definition> extends never
          ? IsRedacted<Schema.Schema.Type<SchemaOf<Definition>>>
          : true,
        SourceKind<Definition>,
        IsOptional<SchemaOf<Definition>>
      >
    : never;
};

/** Complete type-only contract inspected by the CLI. */
export interface AppEnvContract<
  Server extends Readonly<Record<string, unknown>>,
  Client extends Readonly<Record<string, unknown>>,
> {
  readonly server: Server;
  readonly client: Client;
}

/** Internal phantom field used by inference helpers and the CLI. */
export interface AppEnvContractCarrier<Contract> {
  readonly __envilContract: Contract;
}

type ContextResolvers<Entries extends DefinitionEntries> = {
  readonly [Key in keyof Entries]: Entries[Key] extends VariableEntry<
    infer Definition,
    infer _Prefix,
    infer _Target
  >
    ? ResolverOf<Definition>
    : never;
}[keyof Entries];
type ContextSchemaRequirements<Entries extends DefinitionEntries> = {
  readonly [Key in keyof Entries]: Entries[Key] extends VariableEntry<
    infer Definition,
    infer _Prefix,
    infer _Target
  >
    ? Schema.Codec.DecodingServices<SchemaOf<Definition>>
    : never;
}[keyof Entries];

type ServerErrors<Entries extends DefinitionEntries> =
  | ConfiguredResolverError<ContextResolvers<Entries>>
  | EnvConfigurationError
  | EnvValidationError;
type ServerRequirements<Entries extends DefinitionEntries> =
  | ConfiguredResolverRequirements<ContextResolvers<Entries>>
  | ContextSchemaRequirements<Entries>;

/**
 * One composable environment with independent lazy server and client Effects.
 */
export interface AppEnv<
  ServerEntries extends DefinitionEntries,
  ClientEntries extends DefinitionEntries,
>
  extends
    AnyAppEnv,
    AppEnvContractCarrier<
      AppEnvContract<
        ContextContract<ServerEntries, "server">,
        ContextContract<ClientEntries, "client">
      >
    > {
  /** The resolved server environment Effect. */
  readonly server: Effect.Effect<
    ContextOutput<ServerEntries>,
    ServerErrors<ServerEntries>,
    ServerRequirements<ServerEntries>
  >;
  /** The resolved public client environment Effect. */
  readonly client: Effect.Effect<
    ContextOutput<ClientEntries>,
    EnvConfigurationError | EnvValidationError,
    ContextSchemaRequirements<ClientEntries>
  >;
  readonly [APP_ENV_TYPES]: {
    readonly server: ServerEntries;
    readonly client: ClientEntries;
  };
}

/** Nominal base shared by every AppEnv regardless of its inferred contexts. */
export interface AnyAppEnv extends Pipeable.Pipeable {
  readonly [APP_ENV_BRAND]: true;
}

type EntryForValue<
  Value,
  Prefix extends string | undefined,
  Target extends EnvFragmentTarget,
> = Value extends VariableDefinition
  ? Target extends "server" | "client"
    ? VariableEntry<Value, Prefix, Target>
    : never
  : StaticEntry<Value, Target>;
type FragmentEntries<Fragment> =
  Fragment extends EnvFragment<infer Target, infer Values, infer Prefix, infer _Runtime>
    ? {
        readonly [Key in keyof Values]: EntryForValue<Values[Key], Prefix, Target>;
      }
    : {};
type MergeEntries<Left, Right> = Simplify<Omit<Left, keyof Right> & Right>;

type ApplyServerFragment<Entries, Fragment> =
  Fragment extends EnvFragment<
    EnvFragmentTarget,
    EnvValues,
    string | undefined,
    RuntimeEnv | undefined
  >
    ? MergeEntries<Entries, FragmentEntries<Fragment>>
    : Entries;
type ApplyClientFragment<Entries, Fragment> =
  Fragment extends EnvFragment<infer Target, EnvValues, string | undefined, RuntimeEnv | undefined>
    ? Target extends "client" | "shared"
      ? MergeEntries<Entries, FragmentEntries<Fragment>>
      : Entries
    : Entries;

type FoldServerFragments<
  Fragments extends readonly unknown[],
  Entries = {},
> = Fragments extends readonly [infer First, ...infer Rest]
  ? FoldServerFragments<Rest, ApplyServerFragment<Entries, First>>
  : Entries extends DefinitionEntries
    ? Entries
    : never;
type FoldClientFragments<
  Fragments extends readonly unknown[],
  Entries = {},
> = Fragments extends readonly [infer First, ...infer Rest]
  ? FoldClientFragments<Rest, ApplyClientFragment<Entries, First>>
  : Entries extends DefinitionEntries
    ? Entries
    : never;
type ServerEntriesOf<Value> =
  Value extends AppEnv<infer ServerEntries, infer _ClientEntries> ? ServerEntries : {};
type ClientEntriesOf<Value> =
  Value extends AppEnv<infer _ServerEntries, infer ClientEntries> ? ClientEntries : {};
type ExtensionServerEntries<Input> = Input extends AnyAppEnv
  ? ServerEntriesOf<Input>
  : ApplyServerFragment<{}, Input>;
type ExtensionClientEntries<Input> = Input extends AnyAppEnv
  ? ClientEntriesOf<Input>
  : ApplyClientFragment<{}, Input>;
type FoldServerExtensions<
  Inputs extends readonly unknown[],
  Entries extends DefinitionEntries,
> = Inputs extends readonly [infer First, ...infer Rest]
  ? MergeEntries<Entries, ExtensionServerEntries<First>> extends infer Next
    ? Next extends DefinitionEntries
      ? FoldServerExtensions<Rest, Next>
      : never
    : never
  : Entries;
type FoldClientExtensions<
  Inputs extends readonly unknown[],
  Entries extends DefinitionEntries,
> = Inputs extends readonly [infer First, ...infer Rest]
  ? MergeEntries<Entries, ExtensionClientEntries<First>> extends infer Next
    ? Next extends DefinitionEntries
      ? FoldClientExtensions<Rest, Next>
      : never
    : never
  : Entries;

/** Final server entries inferred from a createEnv fragment tuple. */
export type CreateEnvServerEntries<Fragments extends readonly AnyEnvFragment[]> =
  FoldServerFragments<Fragments>;

/** Final client entries inferred from a createEnv fragment tuple. */
export type CreateEnvClientEntries<Fragments extends readonly AnyEnvFragment[]> =
  FoldClientFragments<Fragments>;

/** Final server entries inferred after extending an AppEnv. */
export type ExtendedServerEntries<
  Base extends AnyAppEnv,
  Inputs extends readonly (AnyAppEnv | AnyEnvFragment)[],
> = FoldServerExtensions<Inputs, ServerEntriesOf<Base>>;

/** Final client entries inferred after extending an AppEnv. */
export type ExtendedClientEntries<
  Base extends AnyAppEnv,
  Inputs extends readonly (AnyAppEnv | AnyEnvFragment)[],
> = FoldClientExtensions<Inputs, ClientEntriesOf<Base>>;

type VariableKeys<Values extends EnvValues> = {
  readonly [Key in keyof Values]: Values[Key] extends VariableDefinition ? Key : never;
}[keyof Values];
type ResolverKeys<Values extends EnvValues> = {
  readonly [Key in keyof Values]: Values[Key] extends VariableDefinition
    ? ResolverOf<Values[Key]> extends never
      ? never
      : Key
    : never;
}[keyof Values];
type ContainsRedacted<Value> =
  Value extends Redacted.Redacted<unknown>
    ? true
    : Value extends readonly (infer Item)[]
      ? ContainsRedacted<Item>
      : Value extends (...arguments_: never[]) => unknown
        ? false
        : Value extends Readonly<Record<PropertyKey, unknown>>
          ? true extends {
              readonly [Key in keyof Value]: ContainsRedacted<Value[Key]>;
            }[keyof Value]
            ? true
            : false
          : false;
type RedactedKeys<Values extends EnvValues> = {
  readonly [Key in keyof Values]: Values[Key] extends VariableDefinition
    ? true extends ContainsRedacted<Schema.Schema.Type<SchemaOf<Values[Key]>>>
      ? Key
      : never
    : true extends ContainsRedacted<Values[Key]>
      ? Key
      : never;
}[keyof Values];

type IsAny<Value> = 0 extends 1 & Value ? true : false;
type IsSharedStaticValue<Value> =
  IsAny<Value> extends true
    ? false
    : Value extends VariableDefinition | Redacted.Redacted<unknown>
      ? false
      : Value extends StaticScalar
        ? true
        : Value extends readonly (infer Item)[]
          ? IsSharedStaticValue<Item>
          : Value extends (...arguments_: never[]) => unknown
            ? false
            : Value extends Readonly<Record<PropertyKey, unknown>>
              ? false extends {
                  readonly [Key in keyof Value]: IsSharedStaticValue<Value[Key]>;
                }[keyof Value]
                ? false
                : true
              : false;
type InvalidServerKeys<Values extends EnvValues> = {
  readonly [Key in keyof Values]: Values[Key] extends VariableDefinition | StaticScalar
    ? never
    : Key;
}[keyof Values];
type InvalidSharedKeys<Values extends EnvValues> = {
  readonly [Key in keyof Values]: IsSharedStaticValue<Values[Key]> extends true ? never : Key;
}[keyof Values];

/** Rejects raw structured values from a server fragment. */
export type ValidServerValues<Values extends EnvValues> = [InvalidServerKeys<Values>] extends [
  never,
]
  ? unknown
  : never;

/** Rejects sources and sensitive values from a client fragment. */
export type ValidClientValues<Values extends EnvValues> = [
  ResolverKeys<Values> | RedactedKeys<Values> | InvalidServerKeys<Values>,
] extends [never]
  ? unknown
  : never;

/** Rejects schemas and sensitive values from a shared fragment. */
export type ValidSharedValues<Values extends EnvValues> = [InvalidSharedKeys<Values>] extends [
  never,
]
  ? unknown
  : never;

/** Returns whether a fragment contains schemas that read a runtime environment. */
export type HasRuntimeVariables<Values extends EnvValues> = [VariableKeys<Values>] extends [never]
  ? false
  : true;

/** Extracts the success value from an Envil Effect or Promise. */
export type InferEnv<Value> =
  Value extends Effect.Effect<infer Success, unknown, unknown>
    ? Success
    : Value extends PromiseLike<infer Success>
      ? Success
      : never;

/** Extracts the environment produced by `appEnv.server`. */
export type InferServerEnv<Value> =
  Value extends AppEnv<infer ServerEntries, infer _ClientEntries>
    ? ContextOutput<ServerEntries>
    : never;

/** Extracts the environment produced by `appEnv.client`. */
export type InferClientEnv<Value> =
  Value extends AppEnv<infer _ServerEntries, infer ClientEntries>
    ? ContextOutput<ClientEntries>
    : never;
