import { Effect } from "effect";

/** Successful typed result. */
export interface ResultSuccess<Value> {
  readonly success: true;
  readonly data: Value;
}

/** Failed typed result. */
export interface ResultFailure<Error> {
  readonly success: false;
  readonly error: Error;
}

/** Discriminated result produced by `asResult`. */
export type Result<Value, Error> = ResultSuccess<Value> | ResultFailure<Error>;

/**
 * Converts only an Effect's typed error channel into a discriminated result.
 *
 * Defects and interruptions remain outside the result value.
 */
export function asResult<Value, Error, Requirements>(): (
  effect: Effect.Effect<Value, Error, Requirements>,
) => Effect.Effect<Result<Value, Error>, never, Requirements> {
  return Effect.match({
    onFailure: (error) => ({ success: false, error }) as const,
    onSuccess: (data) => ({ success: true, data }) as const,
  });
}
