import { Data } from "effect";

export type ResolverResult = Record<string, string | undefined>;

export class ResolverError extends Data.TaggedError("ResolverError")<{
  readonly resolver: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
