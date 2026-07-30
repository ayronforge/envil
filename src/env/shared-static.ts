import { Redacted } from "effect";

const invalidSharedStaticValue = Symbol("@ayronforge/envil/invalid-shared-static-value");

function isStaticScalar(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** Returns whether a value is recursively safe public data for a shared fragment. */
export function isSharedStaticValue(
  value: unknown,
  ancestors: ReadonlySet<object> = new Set(),
): boolean {
  if (isStaticScalar(value)) {
    return true;
  }
  if (typeof value !== "object" || value === null || Redacted.isRedacted(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  if (ancestors.has(value)) {
    return false;
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !isSharedStaticValue(descriptor.value, nextAncestors)
    ) {
      return false;
    }
  }
  return true;
}

function snapshotValidatedSharedValue(value: unknown): unknown {
  if (isStaticScalar(value)) {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    const snapshot: unknown[] = [];
    snapshot.length = value.length;
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        continue;
      }
      Object.defineProperty(snapshot, key, {
        ...descriptor,
        value: snapshotValidatedSharedValue(descriptor.value),
      });
    }
    return Object.freeze(snapshot);
  }

  // SAFETY: isSharedStaticValue accepts only plain objects with Object.prototype or null.
  const snapshot = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      continue;
    }
    Object.defineProperty(snapshot, key, {
      ...descriptor,
      value: snapshotValidatedSharedValue(descriptor.value),
    });
  }
  return Object.freeze(snapshot);
}

/** Snapshots valid shared data and replaces invalid data for later typed validation. */
export function snapshotSharedStaticValue(value: unknown): unknown {
  return isSharedStaticValue(value)
    ? snapshotValidatedSharedValue(value)
    : invalidSharedStaticValue;
}
