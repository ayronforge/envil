import type { Schema } from "effect";

import type { AnyConfiguredResolver, ConfiguredResolverReference } from "./resolvers/types.ts";

declare const SOURCED_VARIABLE_TYPE: unique symbol;

/** Reads one variable from an explicitly named runtime environment entry. */
export interface EnvVariableSource<Name extends string> {
  readonly _tag: "env";
  readonly name: Name;
}

/** Reads one variable through a configured resolver. */
export interface ResolverVariableSource<Resolver extends AnyConfiguredResolver, Reference> {
  readonly _tag: "resolver";
  readonly resolver: Resolver;
  readonly reference: Reference;
}

/** Runtime source metadata attached to a terminal variable definition. */
export type VariableSource =
  | EnvVariableSource<string>
  | ResolverVariableSource<AnyConfiguredResolver, unknown>;

/**
 * A schema paired with its only runtime source.
 *
 * Source combinators return this terminal definition instead of another
 * schema, so later schema combinators cannot erase the source contract.
 */
export interface SourcedVariable<SchemaValue extends Schema.Top, Source extends VariableSource> {
  readonly schema: SchemaValue;
  readonly source: Source;
  readonly [SOURCED_VARIABLE_TYPE]: {
    readonly schema: SchemaValue;
    readonly source: Source;
  };
}

/** Any terminal sourced variable after its public generics are erased. */
export type AnySourcedVariable = SourcedVariable<Schema.Top, VariableSource>;

const sourcedVariables = new WeakSet<object>();

function makeSourcedVariable<SchemaValue extends Schema.Top, Source extends VariableSource>(
  schema: SchemaValue,
  source: Source,
): SourcedVariable<SchemaValue, Source> {
  const variable = Object.freeze({
    schema,
    source: Object.freeze(source),
  });
  sourcedVariables.add(variable);

  // SAFETY: The private WeakSet authenticates every runtime value created here.
  // The unique-symbol field is phantom metadata for static source inference.
  return variable as SourcedVariable<SchemaValue, Source>;
}

/** Returns whether a value is a terminal definition created by a source combinator. */
export function isSourcedVariable(value: unknown): value is AnySourcedVariable {
  return typeof value === "object" && value !== null && sourcedVariables.has(value);
}

/** Overrides the runtime environment entry used by one schema. */
export function fromEnv<const Name extends string>(
  name: Name,
): <SchemaValue extends Schema.Top>(
  schema: SchemaValue,
) => SourcedVariable<SchemaValue, EnvVariableSource<Name>> {
  return <SchemaValue extends Schema.Top>(schema: SchemaValue) =>
    makeSourcedVariable(schema, {
      _tag: "env",
      name,
    });
}

/** Reads one schema through a configured resolver when the server Effect runs. */
export function fromResolver<
  Resolver extends AnyConfiguredResolver,
  const Reference extends ConfiguredResolverReference<Resolver>,
>(
  resolver: Resolver,
  reference: Reference,
): <SchemaValue extends Schema.Top>(
  schema: SchemaValue,
) => SourcedVariable<SchemaValue, ResolverVariableSource<Resolver, Reference>> {
  return <SchemaValue extends Schema.Top>(schema: SchemaValue) =>
    makeSourcedVariable(schema, {
      _tag: "resolver",
      resolver,
      reference,
    });
}
