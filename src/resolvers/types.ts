import { Data } from "effect";

export type ResolverResult<K extends string = string> = Record<K, string | undefined>;

export class ResolverError extends Data.TaggedError("ResolverError")<{
  readonly resolver: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
