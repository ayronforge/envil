import { Redacted } from "effect";

/** Marks shared data that failed snapshot validation. */
export const INVALID_SHARED_STATIC_VALUE = Symbol("@ayronforge/envil/invalid-shared-static-value");

function isStaticScalar(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** Copies and freezes recursively static public data in one pass. */
export function snapshotSharedStaticValue(
  value: unknown,
  ancestors: ReadonlySet<object> = new Set(),
): unknown {
  if (isStaticScalar(value)) {
    return value;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Redacted.isRedacted(value) ||
    ancestors.has(value)
  ) {
    return INVALID_SHARED_STATIC_VALUE;
  }

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    return INVALID_SHARED_STATIC_VALUE;
  }

  const nextAncestors = new Set(ancestors).add(value);
  const properties: Array<readonly [string, unknown]> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (isArray && key === "length") {
      continue;
    }
    if (typeof key !== "string") {
      return INVALID_SHARED_STATIC_VALUE;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      return INVALID_SHARED_STATIC_VALUE;
    }
    const property = snapshotSharedStaticValue(descriptor.value, nextAncestors);
    if (property === INVALID_SHARED_STATIC_VALUE) {
      return INVALID_SHARED_STATIC_VALUE;
    }
    properties.push([key, property]);
  }

  if (!isArray) {
    return Object.freeze(Object.fromEntries(properties));
  }

  const snapshot: unknown[] = [];
  snapshot.length = value.length;
  for (const [key, item] of properties) {
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: item,
      writable: true,
    });
  }
  return Object.freeze(snapshot);
}
