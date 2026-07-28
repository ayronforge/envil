import type { Brand, Effect, Redacted, Schema } from "effect";

import type { PrefixMap } from "./prefix.ts";
import type {
  AdapterError,
  AdapterName,
  AdapterOptions,
  AdapterReference,
  AdapterRequirements,
  AnyResolverAdapter,
  AnyResolverDefinition,
  ResolverDefinition,
} from "./resolvers/types.ts";

/** Any context-free Effect Schema accepted in an environment bucket. */
export type AnySchema = Schema.Schema.AnyNoContext;

/** A logical environment bucket keyed by unprefixed variable names. */
export type SchemaDict = Record<string, AnySchema>;

declare const ENVIL_ENV_BRAND: unique symbol;

/** Any Envil environment accepted for composition. */
export type AnyEnv = Readonly<object> & EnvContractCarrier<AnyEnvContract>;

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
type ResolverKeys<Definition> =
  Definition extends ResolverDefinition<infer _Name, infer Keys, infer _Error, infer _Requirements>
    ? Keys
    : never;
type ResolverName<Definition> =
  Definition extends ResolverDefinition<infer Name, infer _Keys, infer _Error, infer _Requirements>
    ? Name
    : never;
type SourceForKey<
  Key extends string,
  Resolvers extends readonly AnyResolverDefinition[],
> = Resolvers[number] extends infer Definition
  ? Definition extends AnyResolverDefinition
    ? Key extends ResolverKeys<Definition>
      ? ResolverName<Definition>
      : never
    : never
  : never;
type IsResolved<Key extends string, Resolvers extends readonly AnyResolverDefinition[]> = [
  SourceForKey<Key, Resolvers>,
] extends [never]
  ? false
  : true;

type PrefixForBucket<
  Prefix extends string | PrefixMap | undefined,
  Bucket extends keyof PrefixMap,
> = Prefix extends string
  ? Prefix
  : Prefix extends PrefixMap
    ? Prefix[Bucket] extends string
      ? Prefix[Bucket]
      : ""
    : "";

type RuntimeKey<
  Key extends string,
  Bucket extends keyof PrefixMap,
  Prefix extends string | PrefixMap | undefined,
> = `${PrefixForBucket<Prefix, Bucket>}${Key}`;

type ContractValue<ValueSchema extends AnySchema, Resolved extends boolean> = Resolved extends true
  ? IsOptional<ValueSchema> extends true
    ? Redact<Unredacted<Schema.Schema.Type<ValueSchema>>> | undefined
    : Redact<Unredacted<Schema.Schema.Type<ValueSchema>>>
  : NormalizeSchemaOutput<Schema.Schema.Type<ValueSchema>>;

/** Safe structural metadata retained only in TypeScript types. */
export interface EnvVariableContract<
  Value,
  Encoded,
  Key extends string,
  Bucket extends keyof PrefixMap,
  RuntimeName extends string,
  Secret extends boolean,
  Source extends string,
  Optional extends boolean,
> {
  readonly value: Value;
  readonly encoded: Encoded;
  readonly key: Key;
  readonly bucket: Bucket;
  readonly runtimeKey: RuntimeName;
  readonly secret: Secret;
  readonly source: Source;
  readonly optional: Optional;
}

type BucketContract<
  Bucket extends keyof PrefixMap,
  Schemas extends SchemaDict,
  Prefix extends string | PrefixMap | undefined,
  Resolvers extends readonly AnyResolverDefinition[],
> = {
  readonly [Key in keyof Schemas & string]: EnvVariableContract<
    ContractValue<Schemas[Key], IsResolved<Key, Resolvers>>,
    Schema.Schema.Encoded<Schemas[Key]>,
    Key,
    Bucket,
    RuntimeKey<Key, Bucket, Prefix>,
    IsResolved<Key, Resolvers> extends true ? true : IsRedacted<Schema.Schema.Type<Schemas[Key]>>,
    IsResolved<Key, Resolvers> extends true ? SourceForKey<Key, Resolvers> : "runtime",
    IsOptional<Schemas[Key]>
  >;
};

/** Complete type-only environment contract inspected by the CLI. */
export interface EnvContract<
  Server extends Readonly<
    Record<
      string,
      EnvVariableContract<
        unknown,
        unknown,
        string,
        keyof PrefixMap,
        string,
        boolean,
        string,
        boolean
      >
    >
  >,
  Client extends Readonly<
    Record<
      string,
      EnvVariableContract<
        unknown,
        unknown,
        string,
        keyof PrefixMap,
        string,
        boolean,
        string,
        boolean
      >
    >
  >,
  Shared extends Readonly<
    Record<
      string,
      EnvVariableContract<
        unknown,
        unknown,
        string,
        keyof PrefixMap,
        string,
        boolean,
        string,
        boolean
      >
    >
  >,
> {
  readonly server: Server;
  readonly client: Client;
  readonly shared: Shared;
}

/** Internal phantom field used by inference helpers and the CLI. */
export interface EnvContractCarrier<Contract> extends Brand.Brand<typeof ENVIL_ENV_BRAND> {
  readonly __envilContract: Contract;
}

/** Builds the complete contract for one environment definition. */
export type BuildEnvContract<
  Server extends SchemaDict,
  Client extends SchemaDict,
  Shared extends SchemaDict,
  Prefix extends string | PrefixMap | undefined,
  Resolvers extends readonly AnyResolverDefinition[],
> = EnvContract<
  BucketContract<"server", Server, Prefix, Resolvers>,
  BucketContract<"client", Client, Prefix, Resolvers>,
  BucketContract<"shared", Shared, Prefix, Resolvers>
>;

type ContractRecord = Readonly<
  Record<
    string,
    EnvVariableContract<unknown, unknown, string, keyof PrefixMap, string, boolean, string, boolean>
  >
>;
type AnyEnvContract = EnvContract<ContractRecord, ContractRecord, ContractRecord>;
type EmptyEnvContract = EnvContract<{}, {}, {}>;

type ContractOf<Value> =
  Value extends EnvContractCarrier<infer Contract>
    ? Contract
    : Value extends Effect.Effect<infer Success, unknown, unknown>
      ? ContractOf<Success>
      : Value extends PromiseLike<infer Success>
        ? ContractOf<Success>
        : never;

type ContractOfOrEmpty<Value> = [ContractOf<Value>] extends [never]
  ? EmptyEnvContract
  : ContractOf<Value> extends infer Contract extends AnyEnvContract
    ? Contract
    : EmptyEnvContract;

type MergeContractRecords<Left extends ContractRecord, Right extends ContractRecord> = Readonly<
  Omit<Left, keyof Right> & Right
>;

type MergeEnvContracts<Left extends AnyEnvContract, Right extends AnyEnvContract> = EnvContract<
  MergeContractRecords<Left["server"], Right["server"]>,
  MergeContractRecords<Left["client"], Right["client"]>,
  MergeContractRecords<Left["shared"], Right["shared"]>
>;

type MergeExtendedContracts<
  Envs extends readonly AnyEnv[],
  Accumulator extends AnyEnvContract = EmptyEnvContract,
> = Envs extends readonly [infer First extends AnyEnv, ...infer Rest extends readonly AnyEnv[]]
  ? MergeExtendedContracts<Rest, MergeEnvContracts<Accumulator, ContractOfOrEmpty<First>>>
  : Accumulator;

/** Combines inherited contracts left-to-right before applying the current definition. */
export type ComposedEnvContract<
  Extends extends readonly AnyEnv[],
  Current extends AnyEnvContract,
> = MergeEnvContracts<MergeExtendedContracts<Extends>, Current>;

type ValuesOf<Bucket extends ContractRecord> = {
  readonly [Key in keyof Bucket]: Bucket[Key]["value"];
};

/** Extracts the complete decoded environment from an Effect, Promise, or resolved value. */
export type InferEnv<Value> =
  ContractOf<Value> extends infer Contract extends AnyEnvContract
    ? Readonly<
        ValuesOf<Contract["server"]> & ValuesOf<Contract["client"]> & ValuesOf<Contract["shared"]>
      >
    : never;

type ResolvedEnv<Value> =
  Value extends Effect.Effect<infer Success, unknown, unknown>
    ? Success
    : Value extends PromiseLike<infer Success>
      ? Success
      : Value;

type MergeEnvs<Envs extends readonly AnyEnv[]> = Envs extends readonly [
  infer First extends AnyEnv,
  ...infer Rest extends readonly AnyEnv[],
]
  ? ResolvedEnv<First> & MergeEnvs<Rest>
  : {};
type KnownKeys<Value> = keyof {
  [Key in keyof Value as string extends Key ? never : Key]: Value[Key];
};

/** Final runtime object with the type-only contract attached. */
export type EnvValue<Extends extends readonly AnyEnv[], Contract extends AnyEnvContract> = Readonly<
  Omit<
    MergeEnvs<Extends>,
    | keyof EnvContractCarrier<unknown>
    | KnownKeys<Contract["server"]>
    | KnownKeys<Contract["client"]>
    | KnownKeys<Contract["shared"]>
  > &
    ValuesOf<Contract["server"]> &
    ValuesOf<Contract["client"]> &
    ValuesOf<Contract["shared"]>
> &
  EnvContractCarrier<Contract>;

/** Common options shared by all environment creation boundaries. */
export interface EnvOptions<
  Server extends SchemaDict,
  Client extends SchemaDict,
  Shared extends SchemaDict,
  Extends extends readonly AnyEnv[] = readonly [],
  Prefix extends string | PrefixMap | undefined = undefined,
> {
  readonly server?: Server;
  readonly client?: Client;
  readonly shared?: Shared;
  readonly extends?: Extends;
  readonly prefix?: Prefix;
  readonly runtimeEnv?: Readonly<Record<string, string | undefined>>;
  readonly isServer?: boolean;
  readonly emptyStringAsUndefined?: boolean;
}

type ServerKey<Server extends SchemaDict> = keyof Server & string;

/** Schema-bound builder exposed inside the `resolvers` callback. */
export interface ResolverTools<Server extends SchemaDict, AvailableRequirements = unknown> {
  readonly resolve: <
    Adapter extends AnyResolverAdapter,
    const Secrets extends Readonly<Record<string, AdapterReference<Adapter>>>,
  >(
    adapter: AdapterRequirements<Adapter> extends AvailableRequirements ? Adapter : never,
    options: AdapterOptions<Adapter> & {
      readonly secrets: Secrets &
        Partial<Readonly<Record<ServerKey<Server>, AdapterReference<Adapter>>>> &
        Record<Exclude<keyof Secrets, ServerKey<Server>>, never>;
    },
  ) => ResolverDefinition<
    AdapterName<Adapter>,
    keyof Secrets & string,
    AdapterError<Adapter>,
    AdapterRequirements<Adapter>
  >;
}

type DefinitionKeys<Definition> =
  Definition extends ResolverDefinition<infer _Name, infer Keys, infer _Error, infer _Requirements>
    ? Keys
    : never;
type ValidateResolverTuple<
  Resolvers extends readonly AnyResolverDefinition[],
  Seen extends string = never,
> = Resolvers extends readonly [
  infer First extends AnyResolverDefinition,
  ...infer Rest extends readonly AnyResolverDefinition[],
]
  ? Extract<DefinitionKeys<First>, Seen> extends never
    ? ValidateResolverTuple<Rest, Seen | DefinitionKeys<First>>
    : never
  : unknown;

/** Rejects resolver tuples containing the same logical key more than once. */
export type ValidResolverTuple<Resolvers extends readonly AnyResolverDefinition[]> = Resolvers &
  ValidateResolverTuple<Resolvers>;

type RedactedKeys<Schemas extends SchemaDict> = {
  [Key in keyof Schemas]: IsRedacted<Schema.Schema.Type<Schemas[Key]>> extends true ? Key : never;
}[keyof Schemas];
type BucketDuplicates<
  Server extends SchemaDict,
  Client extends SchemaDict,
  Shared extends SchemaDict,
> = Extract<keyof Server, keyof Client | keyof Shared> | Extract<keyof Client, keyof Shared>;
type LogicalPhysicalKeys<
  Schemas extends SchemaDict,
  Bucket extends keyof PrefixMap,
  Prefix extends string | PrefixMap | undefined,
> = {
  [Key in keyof Schemas & string]: RuntimeKey<Key, Bucket, Prefix>;
}[keyof Schemas & string];
type PhysicalDuplicates<
  Server extends SchemaDict,
  Client extends SchemaDict,
  Shared extends SchemaDict,
  Prefix extends string | PrefixMap | undefined,
> =
  | Extract<
      LogicalPhysicalKeys<Server, "server", Prefix>,
      LogicalPhysicalKeys<Client, "client", Prefix> | LogicalPhysicalKeys<Shared, "shared", Prefix>
    >
  | Extract<
      LogicalPhysicalKeys<Client, "client", Prefix>,
      LogicalPhysicalKeys<Shared, "shared", Prefix>
    >;

/** Compile-time invariants applied to every environment options object. */
export type ValidEnvOptions<
  Server extends SchemaDict,
  Client extends SchemaDict,
  Shared extends SchemaDict,
  Prefix extends string | PrefixMap | undefined,
> = [BucketDuplicates<Server, Client, Shared>] extends [never]
  ? [RedactedKeys<Client> | RedactedKeys<Shared>] extends [never]
    ? [PhysicalDuplicates<Server, Client, Shared, Prefix>] extends [never]
      ? unknown
      : never
    : never
  : never;

/** Union of typed resolver failures in a configured tuple. */
export type ResolverErrors<Resolvers extends readonly AnyResolverDefinition[]> =
  Resolvers[number] extends ResolverDefinition<
    infer _Name,
    infer _Keys,
    infer Error,
    infer _Requirements
  >
    ? Error
    : never;

/** Union of Effect requirements in a configured tuple. */
export type ResolverRequirements<Resolvers extends readonly AnyResolverDefinition[]> =
  Resolvers[number] extends ResolverDefinition<
    infer _Name,
    infer _Keys,
    infer _Error,
    infer Requirements
  >
    ? Requirements
    : never;

export type { PrefixMap };
