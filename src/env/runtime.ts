import { Effect, Option, Redacted, Result, Schema } from "effect";

import {
  EnvironmentAccessError,
  EnvConfigurationError,
  EnvValidationError,
  type EnvValidationIssue,
} from "../errors.ts";
import type { AnyConfiguredResolver, ResolverResult } from "../resolvers/types.ts";
import { assertServerRuntime, type RuntimeTarget } from "../runtime-target.ts";
import { getSchemaIdentifier, isRedactedSchema } from "../schema-metadata.ts";
import type { AnyEnvFragment, AnySchema, RuntimeEnv } from "../types.ts";
import { isSourcedVariable, type VariableSource } from "../variable-source.ts";

import { isSharedStaticValue } from "./shared-static.ts";

const expoRuntimeEnvMarker = Symbol.for("@ayronforge/envil/expo-runtime-env");

interface VariablePlan {
  readonly _tag: "variable";
  readonly key: string;
  readonly runtimeKey: string | undefined;
  readonly schema: AnySchema;
  readonly source: VariableSource | undefined;
  readonly fragmentTarget: "server" | "client";
  readonly runtimeEnv: RuntimeEnv | undefined;
  readonly emptyStringAsUndefined: boolean | undefined;
}

interface StaticPlan {
  readonly _tag: "static";
  readonly key: string;
  readonly value: unknown;
}

type EnvironmentEntryPlan = VariablePlan | StaticPlan;

interface ResolverGroup {
  readonly resolver: AnyConfiguredResolver;
  readonly referencesByKey: Record<string, unknown>;
}

interface RuntimeConfiguredResolver extends AnyConfiguredResolver {
  readonly resolve: (
    referencesByKey: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<ResolverResult, unknown, unknown>;
}

function configurationFailure(message: string): EnvConfigurationError {
  return new EnvConfigurationError(message);
}

function splitVariableDefinition(definition: unknown):
  | {
      readonly schema: AnySchema;
      readonly source: VariableSource | undefined;
    }
  | undefined {
  if (isSourcedVariable(definition)) {
    return { schema: definition.schema, source: definition.source };
  }
  if (!Schema.isSchema(definition)) {
    return undefined;
  }

  // SAFETY: Public fragment contracts accept any Effect Schema. This runtime
  // branch authenticates the value as an Effect Schema after erasure.
  return { schema: definition as AnySchema, source: undefined };
}

function isStaticScalar(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function createVariablePlan(
  fragment: AnyEnvFragment,
  key: string,
  schema: AnySchema,
  source: VariableSource | undefined,
): VariablePlan {
  if (fragment.target === "client" && source?._tag === "resolver") {
    throw configurationFailure(
      `"${key}" uses fromResolver() in a client fragment. Move it to a server fragment.`,
    );
  }
  if (fragment.target === "client" && isRedactedSchema(schema)) {
    throw configurationFailure(
      `"${key}" is redacted in a client fragment, which is public. Move it to a server fragment.`,
    );
  }

  const runtimeKey =
    source?._tag === "resolver"
      ? undefined
      : source?._tag === "env"
        ? source.name
        : `${fragment.prefix ?? ""}${key}`;
  if (runtimeKey !== undefined && runtimeKey.length === 0) {
    throw configurationFailure(
      `"${key}" uses an empty environment variable name. Pass a name to fromEnv().`,
    );
  }

  return {
    _tag: "variable",
    key,
    runtimeKey,
    schema,
    source,
    fragmentTarget: fragment.target === "client" ? "client" : "server",
    runtimeEnv: fragment.runtimeEnv,
    emptyStringAsUndefined: fragment.emptyStringAsUndefined,
  };
}

function createEnvironmentPlans(
  target: RuntimeTarget,
  fragments: ReadonlyArray<AnyEnvFragment>,
): ReadonlyArray<EnvironmentEntryPlan> {
  const plans = new Map<string, EnvironmentEntryPlan>();

  for (const fragment of fragments) {
    if (target === "client" && fragment.target === "server") {
      continue;
    }

    for (const [key, definition] of Object.entries(fragment.values)) {
      if (fragment.target === "shared") {
        if (!isSharedStaticValue(definition)) {
          throw configurationFailure(
            `"${key}" is not recursively static public data. shared() accepts only scalar, array, and plain-object values without Effect values.`,
          );
        }
        plans.set(key, { _tag: "static", key, value: definition });
        continue;
      }

      const variable = splitVariableDefinition(definition);
      if (variable === undefined) {
        if (fragment.target === "client" && Redacted.isRedacted(definition)) {
          throw configurationFailure(
            `"${key}" is redacted in a client fragment, which is public. Move it to a server fragment.`,
          );
        }
        if (!isStaticScalar(definition)) {
          throw configurationFailure(
            `"${key}" is structured runtime data. Describe objects and arrays with an Effect Schema.`,
          );
        }
        plans.set(key, { _tag: "static", key, value: definition });
        continue;
      }

      plans.set(key, createVariablePlan(fragment, key, variable.schema, variable.source));
    }
  }

  const runtimeOwners = new Map<string, string>();
  for (const plan of plans.values()) {
    if (plan._tag === "static" || plan.runtimeKey === undefined) {
      continue;
    }
    const previous = runtimeOwners.get(plan.runtimeKey);
    if (previous !== undefined) {
      throw configurationFailure(
        `"${previous}" and "${plan.key}" both read "${plan.runtimeKey}" in the ${target} environment. Rename one property or map it with fromEnv().`,
      );
    }
    runtimeOwners.set(plan.runtimeKey, plan.key);
  }

  return [...plans.values()];
}

function groupResolverVariables(plans: ReadonlyArray<VariablePlan>): ReadonlyArray<ResolverGroup> {
  const groups = new Map<AnyConfiguredResolver, ResolverGroup>();

  for (const plan of plans) {
    if (plan.source?._tag !== "resolver") {
      continue;
    }
    const existing = groups.get(plan.source.resolver);
    if (existing === undefined) {
      groups.set(plan.source.resolver, {
        resolver: plan.source.resolver,
        referencesByKey: { [plan.key]: plan.source.reference },
      });
      continue;
    }
    existing.referencesByKey[plan.key] = plan.source.reference;
  }

  return [...groups.values()];
}

function runResolverGroup(
  group: ResolverGroup,
): Effect.Effect<readonly [ResolverGroup, ResolverResult], unknown, unknown> {
  return Effect.try({
    try: () => {
      const candidate: unknown = group.resolver;
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        typeof Reflect.get(candidate, "resolve") !== "function"
      ) {
        throw configurationFailure(
          `Resolver "${group.resolver.name}" is not configured correctly. Create it with configureResolver().`,
        );
      }

      // SAFETY: fromResolver constrains every stored reference to the
      // configured resolver's reference type. Grouping only changes the keys.
      return (candidate as RuntimeConfiguredResolver).resolve(group.referencesByKey);
    },
    catch: (failure: unknown) =>
      failure instanceof EnvConfigurationError
        ? failure
        : configurationFailure(
            `Resolver "${group.resolver.name}" could not be configured. Check its options and try again.`,
          ),
  }).pipe(
    Effect.flatMap((effect) => effect),
    Effect.map((result) => [group, result] as const),
  );
}

function collectResolvedValues(
  groups: ReadonlyArray<readonly [ResolverGroup, ResolverResult]>,
): ReadonlyMap<string, Option.Option<Redacted.Redacted<string>>> {
  const values = new Map<string, Option.Option<Redacted.Redacted<string>>>();

  for (const [group, result] of groups) {
    for (const key of Object.keys(group.referencesByKey)) {
      const value = result[key];
      if (value === undefined || !Option.isOption(value)) {
        throw configurationFailure(
          `Resolver "${group.resolver.name}" did not return "${key}". Check the resolver implementation and try again.`,
        );
      }
      values.set(key, value);
    }
  }

  return values;
}

function readNestedObjectValue(
  runtimeEnv: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  if (Object.hasOwn(runtimeEnv, key)) {
    return Reflect.get(runtimeEnv, key);
  }

  let current: unknown = runtimeEnv;
  for (const segment of key.split(".")) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = Reflect.get(current, segment);
  }
  return current;
}

function isRuntimeMap(runtimeEnv: RuntimeEnv): runtimeEnv is ReadonlyMap<string, unknown> {
  return (
    runtimeEnv instanceof Map ||
    ("get" in runtimeEnv &&
      typeof Reflect.get(runtimeEnv, "get") === "function" &&
      "has" in runtimeEnv &&
      typeof Reflect.get(runtimeEnv, "has") === "function")
  );
}

function readRuntimeValue(runtimeEnv: RuntimeEnv, key: string): unknown {
  return isRuntimeMap(runtimeEnv) ? runtimeEnv.get(key) : readNestedObjectValue(runtimeEnv, key);
}

function defaultServerRuntimeEnv(): RuntimeEnv {
  if (typeof process === "undefined") {
    throw configurationFailure(
      "No server runtime environment is available. Pass runtimeEnv to server().",
    );
  }
  return process.env;
}

function validateRuntimeEnv(runtimeEnv: unknown): asserts runtimeEnv is RuntimeEnv {
  if (
    runtimeEnv instanceof Map ||
    (typeof runtimeEnv === "object" && runtimeEnv !== null && !Array.isArray(runtimeEnv))
  ) {
    return;
  }

  throw configurationFailure(
    "runtimeEnv must be an environment object, parsed JSON object, or Map.",
  );
}

function runtimeEnvForPlan(plan: VariablePlan): RuntimeEnv {
  const runtimeEnv: unknown =
    plan.runtimeEnv ??
    (plan.fragmentTarget === "server"
      ? defaultServerRuntimeEnv()
      : (() => {
          throw configurationFailure(
            `The client variable "${plan.key}" needs runtimeEnv. Pass the client runtime object, such as import.meta.env.`,
          );
        })());
  if (
    typeof runtimeEnv === "object" &&
    runtimeEnv !== null &&
    Reflect.get(runtimeEnv, expoRuntimeEnvMarker) === true
  ) {
    throw configurationFailure(
      `The Expo client variable "${plan.key}" was not compiled. Add "@ayronforge/envil/plugins/expo" to babel.config.js.`,
    );
  }
  validateRuntimeEnv(runtimeEnv);
  return runtimeEnv;
}

function rawValue(
  plan: VariablePlan,
  resolvedValues: ReadonlyMap<string, Option.Option<Redacted.Redacted<string>>>,
): unknown {
  if (plan.source?._tag === "resolver") {
    const resolved = resolvedValues.get(plan.key);
    return resolved === undefined
      ? undefined
      : Option.match(resolved, {
          onNone: () => undefined,
          onSome: Redacted.value,
        });
  }

  const value =
    plan.runtimeKey === undefined
      ? undefined
      : readRuntimeValue(runtimeEnvForPlan(plan), plan.runtimeKey);
  return plan.emptyStringAsUndefined && value === "" ? undefined : value;
}

interface VariableInput {
  readonly plan: VariablePlan;
  readonly input: unknown;
}

function readVariableInputs(
  plans: ReadonlyArray<VariablePlan>,
  resolvedValues: ReadonlyMap<string, Option.Option<Redacted.Redacted<string>>>,
): ReadonlyArray<VariableInput> {
  return plans.map((plan) => ({
    plan,
    input: rawValue(plan, resolvedValues),
  }));
}

function decodeVariableInputs(
  inputs: ReadonlyArray<VariableInput>,
): Effect.Effect<ReadonlyMap<string, unknown>, EnvValidationError, unknown> {
  return Effect.forEach(inputs, ({ plan, input }) =>
    Schema.decodeUnknownEffect(plan.schema)(input).pipe(
      Effect.result,
      Effect.map((result) => ({ input, plan, result })),
    ),
  ).pipe(
    Effect.flatMap((results) => {
      const values = new Map<string, unknown>();
      const issues: EnvValidationIssue[] = [];

      for (const { input, plan, result } of results) {
        if (Result.isFailure(result)) {
          const schemaIdentifier = getSchemaIdentifier(plan.schema);
          issues.push({
            _tag: input === undefined ? "MissingVariable" : "InvalidVariable",
            key: plan.runtimeKey ?? plan.key,
            ...(schemaIdentifier === undefined ? {} : { schemaIdentifier }),
            sensitive: plan.source?._tag === "resolver" || isRedactedSchema(plan.schema),
          });
          continue;
        }

        const decoded =
          Redacted.isRedacted(result.success) && Redacted.value(result.success) === undefined
            ? undefined
            : result.success;
        values.set(
          plan.key,
          plan.source?._tag === "resolver" && decoded !== undefined && !Redacted.isRedacted(decoded)
            ? Redacted.make(decoded)
            : decoded,
        );
      }

      return issues.length > 0
        ? Effect.fail(new EnvValidationError(issues))
        : Effect.succeed(values);
    }),
  );
}

function createReadOnlyEnvironment(
  target: RuntimeTarget,
  plans: ReadonlyArray<EnvironmentEntryPlan>,
  parsedValues: ReadonlyMap<string, unknown>,
): Readonly<Record<string, unknown>> {
  const mutableValues: Record<string, unknown> = {};
  Object.setPrototypeOf(mutableValues, null);
  for (const plan of plans) {
    mutableValues[plan.key] = plan._tag === "static" ? plan.value : parsedValues.get(plan.key);
  }
  const values = Object.freeze(mutableValues);
  return new Proxy(values, {
    get(environment, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(environment, property, receiver);
      }
      if (Object.hasOwn(environment, property)) {
        return Reflect.get(environment, property, receiver);
      }
      if (property === "then" || property === "toJSON" || property === "__esModule") {
        return undefined;
      }
      throw new EnvironmentAccessError(target, property);
    },
    set(_environment, property) {
      throw new TypeError(
        `"${String(property)}" cannot be changed because environment values are read-only. Update its source and run the Effect again.`,
      );
    },
    deleteProperty(_environment, property) {
      throw new TypeError(
        `"${String(property)}" cannot be removed because environment values are read-only. Update the definition and run the Effect again.`,
      );
    },
    defineProperty(_environment, property) {
      throw new TypeError(
        `"${String(property)}" cannot be redefined because environment values are read-only. Update the definition and run the Effect again.`,
      );
    },
  });
}

/** Lazily resolves one target from an immutable environment fragment plan. */
export function buildEnvironmentEffect(
  target: RuntimeTarget,
  fragments: ReadonlyArray<AnyEnvFragment>,
): Effect.Effect<Readonly<Record<string, unknown>>, unknown, unknown> {
  return Effect.try({
    try: () => {
      if (target === "server") {
        assertServerRuntime();
      }
      const plans = createEnvironmentPlans(target, fragments);
      const variables = plans.filter((plan): plan is VariablePlan => plan._tag === "variable");
      return {
        plans,
        variables,
        resolverGroups: groupResolverVariables(variables),
      };
    },
    catch: (failure: unknown) =>
      failure instanceof EnvConfigurationError
        ? failure
        : configurationFailure(
            `Envil could not prepare the ${target} environment. Check its fragments and try again.`,
          ),
  }).pipe(
    Effect.flatMap(({ plans, variables, resolverGroups }) =>
      Effect.forEach(resolverGroups, runResolverGroup, {
        concurrency: "unbounded",
      }).pipe(
        Effect.flatMap((resolverResults) =>
          Effect.try({
            try: () => readVariableInputs(variables, collectResolvedValues(resolverResults)),
            catch: (failure: unknown) =>
              failure instanceof EnvConfigurationError
                ? failure
                : configurationFailure(
                    `Envil could not read the ${target} environment. Check its runtime sources and try again.`,
                  ),
          }),
        ),
        Effect.flatMap(decodeVariableInputs),
        Effect.map((parsedValues) => createReadOnlyEnvironment(target, plans, parsedValues)),
      ),
    ),
  );
}
