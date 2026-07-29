import { Pipeable } from "effect";

import { buildEnvironmentEffect } from "./env/runtime.ts";
import type {
  AnyAppEnv,
  AnyEnvFragment,
  AppEnv,
  CreateEnvClientEntries,
  CreateEnvServerEntries,
  EnvFragment,
  EnvValues,
  ExtendedClientEntries,
  ExtendedServerEntries,
  HasRuntimeVariables,
  RuntimeEnv,
  ValidClientValues,
  ValidSharedValues,
} from "./types.ts";

interface FragmentOptions<
  Prefix extends string | undefined,
  Runtime extends RuntimeEnv | undefined,
> {
  readonly prefix?: Prefix;
  readonly runtimeEnv?: Runtime;
  readonly emptyStringAsUndefined?: boolean;
}

type UnprefixedFragmentOptions<Runtime extends RuntimeEnv | undefined> = Omit<
  FragmentOptions<undefined, Runtime>,
  "prefix"
> & {
  readonly prefix?: never;
};

type EnvPlan = ReadonlyArray<AnyEnvFragment>;

const fragments = new WeakSet<object>();
const plans = new WeakMap<object, EnvPlan>();

function makeFragment<
  const Target extends "server" | "client" | "shared",
  const Values extends EnvValues,
  const Prefix extends string | undefined,
  const Runtime extends RuntimeEnv | undefined,
>(
  target: Target,
  values: Values,
  options: FragmentOptions<Prefix, Runtime> | undefined,
): EnvFragment<Target, Values, Prefix, Runtime> {
  const fragment = Object.freeze({
    target,
    values: Object.freeze({ ...values }),
    prefix: options?.prefix,
    runtimeEnv: options?.runtimeEnv,
    emptyStringAsUndefined: options?.emptyStringAsUndefined,
  });
  fragments.add(fragment);

  // SAFETY: The private WeakSet authenticates this immutable fragment. The
  // unique-symbol field is phantom metadata for target-aware inference.
  return fragment as EnvFragment<Target, Values, Prefix, Runtime>;
}

function isEnvFragment(value: unknown): value is AnyEnvFragment {
  return typeof value === "object" && value !== null && fragments.has(value);
}

function planOf(appEnv: AnyAppEnv): EnvPlan {
  const plan = plans.get(appEnv);
  if (plan === undefined) {
    throw new TypeError("Only environments created by createEnv can be extended.");
  }
  return plan;
}

function makeAppEnv(plan: EnvPlan): AnyAppEnv {
  const appEnv = {
    server: buildEnvironmentEffect("server", plan),
    client: buildEnvironmentEffect("client", plan),
    pipe() {
      return Pipeable.pipeArguments(this, arguments);
    },
  };
  plans.set(appEnv, plan);

  // SAFETY: Both Effects are derived from this exact immutable plan. AppEnv's
  // brand and contract carrier are phantom fields used only for inference.
  return Object.freeze(appEnv) as unknown as AnyAppEnv;
}

/** Defines server-only schemas and values. */
export function server<const Values extends EnvValues>(
  values: Values,
): EnvFragment<"server", Values, undefined, undefined>;
export function server<
  const Values extends EnvValues,
  const Runtime extends RuntimeEnv | undefined,
>(
  values: Values,
  options: UnprefixedFragmentOptions<Runtime>,
): EnvFragment<"server", Values, undefined, Runtime>;
export function server<
  const Values extends EnvValues,
  const Prefix extends string,
  const Runtime extends RuntimeEnv | undefined,
>(
  values: Values,
  options: FragmentOptions<Prefix, Runtime> & { readonly prefix: Prefix },
): EnvFragment<"server", Values, Prefix, Runtime>;
export function server(
  values: EnvValues,
  options?: FragmentOptions<string | undefined, RuntimeEnv | undefined>,
): AnyEnvFragment {
  return makeFragment("server", values, options);
}

/** Defines public client schemas and values. Schema-backed entries require runtimeEnv. */
export function client<const Values extends EnvValues>(
  values: Values &
    ValidClientValues<Values> &
    (HasRuntimeVariables<Values> extends true ? never : unknown),
): EnvFragment<"client", Values, undefined, undefined>;
export function client<
  const Values extends EnvValues,
  const Runtime extends RuntimeEnv | undefined,
>(
  values: Values & ValidClientValues<Values>,
  options: UnprefixedFragmentOptions<Runtime> &
    (HasRuntimeVariables<Values> extends true
      ? { readonly runtimeEnv: Exclude<Runtime, undefined> }
      : unknown),
): EnvFragment<"client", Values, undefined, Runtime>;
export function client<
  const Values extends EnvValues,
  const Prefix extends string,
  const Runtime extends RuntimeEnv | undefined,
>(
  values: Values & ValidClientValues<Values>,
  options: FragmentOptions<Prefix, Runtime> & {
    readonly prefix: Prefix;
  } & (HasRuntimeVariables<Values> extends true
      ? { readonly runtimeEnv: Exclude<Runtime, undefined> }
      : unknown),
): EnvFragment<"client", Values, Prefix, Runtime>;
export function client(
  values: EnvValues,
  options?: FragmentOptions<string | undefined, RuntimeEnv | undefined>,
): AnyEnvFragment {
  return makeFragment("client", values, options);
}

/** Defines static public values available in both runtime contexts. */
export function shared<const Values extends EnvValues>(
  values: Values & ValidSharedValues<Values>,
): EnvFragment<"shared", Values, undefined, undefined> {
  return makeFragment("shared", values, undefined);
}

/**
 * Creates an environment from target-aware fragments.
 *
 * Existing AppEnv values compose only through extendEnv so one extension path
 * owns ordering and last-wins semantics.
 */
export function createEnv<const Fragments extends readonly AnyEnvFragment[]>(
  ...input: Fragments
): AppEnv<CreateEnvServerEntries<Fragments>, CreateEnvClientEntries<Fragments>> {
  const plan: AnyEnvFragment[] = [];
  for (const candidate of input as readonly unknown[]) {
    if (candidate === undefined) {
      continue;
    }
    if (!isEnvFragment(candidate)) {
      throw new TypeError("createEnv accepts fragments created by server, client, and shared.");
    }
    plan.push(candidate);
  }

  // SAFETY: The fold types apply the same left-to-right fragment order stored
  // in the immutable runtime plan.
  return makeAppEnv(Object.freeze(plan)) as unknown as AppEnv<
    CreateEnvServerEntries<Fragments>,
    CreateEnvClientEntries<Fragments>
  >;
}

/**
 * Extends an AppEnv with environments or fragments from left to right.
 *
 * When a key appears more than once in one runtime context, the last complete
 * definition wins.
 */
export function extendEnv<const Inputs extends readonly (AnyAppEnv | AnyEnvFragment)[]>(
  ...inputs: Inputs
): <Base extends AnyAppEnv>(
  base: Base,
) => AppEnv<ExtendedServerEntries<Base, Inputs>, ExtendedClientEntries<Base, Inputs>> {
  return <Base extends AnyAppEnv>(
    base: Base,
  ): AppEnv<ExtendedServerEntries<Base, Inputs>, ExtendedClientEntries<Base, Inputs>> => {
    const plan = [...planOf(base)];
    for (const input of inputs) {
      if (isEnvFragment(input)) {
        plan.push(input);
        continue;
      }
      plan.push(...planOf(input));
    }

    // SAFETY: Runtime plans are concatenated in the same order as the type-level
    // extension fold, including complete last-wins replacement.
    return makeAppEnv(Object.freeze(plan)) as unknown as AppEnv<
      ExtendedServerEntries<Base, Inputs>,
      ExtendedClientEntries<Base, Inputs>
    >;
  };
}
