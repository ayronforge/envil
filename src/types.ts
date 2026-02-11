import { Effect, Redacted, type Schema } from "effect";

import type { PrefixMap } from "./prefix.ts";
import type { ResolverError, ResolverResult } from "./resolvers/types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = Schema.Schema<any, any, never>;

export type { AnySchema };
export type SchemaDict = Record<string, AnySchema>;
export type InferEnv<T extends SchemaDict> = { [K in keyof T]: Schema.Schema.Type<T[K]> };

export type MaybeRedact<T> = T extends Redacted.Redacted<infer _> ? T : Redacted.Redacted<T>;

export type InferEnvAutoRedacted<
  T extends SchemaDict,
  ResolverKeys extends string,
  Prefix extends string = "",
> = {
  [K in keyof T]: `${Prefix}${K & string}` extends ResolverKeys
    ? MaybeRedact<Schema.Schema.Type<T[K]>>
    : Schema.Schema.Type<T[K]>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExtractResolverKeys<T extends readonly any[]> = T[number] extends infer U
  ? U extends Effect.Effect<ResolverResult<infer K>, any, any>
    ? K
    : never
  : never;

export type PrefixStr<P> = P extends string ? P : "";

export type AnyEnv = Readonly<Record<string, unknown>>;

export type MergeEnvs<T extends readonly AnyEnv[]> = T extends readonly [
  infer First extends AnyEnv,
  ...infer Rest extends readonly AnyEnv[],
]
  ? First & MergeEnvs<Rest>
  : {};

export type KnownKeys<T> = keyof {
  [K in keyof T as string extends K ? never : K]: T[K];
};

export type EnvResult<
  TExtends extends readonly AnyEnv[],
  TServer extends SchemaDict,
  TClient extends SchemaDict,
  TShared extends SchemaDict,
> = Readonly<
  Omit<MergeEnvs<TExtends>, KnownKeys<TServer> | KnownKeys<TClient> | KnownKeys<TShared>> &
    InferEnv<TServer & TClient & TShared>
>;

export type EnvResultAutoRedacted<
  TExtends extends readonly AnyEnv[],
  TServer extends SchemaDict,
  TClient extends SchemaDict,
  TShared extends SchemaDict,
  ResolverKeys extends string,
  Prefix extends string = "",
> = Readonly<
  Omit<MergeEnvs<TExtends>, KnownKeys<TServer> | KnownKeys<TClient> | KnownKeys<TShared>> &
    InferEnvAutoRedacted<TServer & TClient & TShared, ResolverKeys, Prefix>
>;

export type { PrefixMap };

export interface EnvOptions<
  TServer extends SchemaDict,
  TClient extends SchemaDict,
  TShared extends SchemaDict,
  TExtends extends readonly AnyEnv[] = readonly [],
> {
  server?: TServer;
  client?: TClient;
  shared?: TShared;
  extends?: TExtends;
  prefix?: string | PrefixMap;
  runtimeEnv?: Record<string, string | undefined>;
  isServer?: boolean;
  emptyStringAsUndefined?: boolean;
  onValidationError?: (errors: string[]) => void;
}

export interface InternalEnvOptions<
  TServer extends SchemaDict,
  TClient extends SchemaDict,
  TShared extends SchemaDict,
  TExtends extends readonly AnyEnv[] = readonly [],
> extends EnvOptions<TServer, TClient, TShared, TExtends> {
  _autoRedactKeys?: Set<string>;
}

export type ResolverEffects = readonly Effect.Effect<ResolverResult<any>, ResolverError>[];
