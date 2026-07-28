import { describe, expect, test } from "bun:test";

import {
  ClientAccessError,
  EnvConfigurationError,
  EnvValidationError,
  type EnvValidationIssue,
} from "./errors.ts";

describe("EnvValidationError", () => {
  test("freezes structured issues and omits rejected values", () => {
    const secret = "do-not-expose";
    const issues: EnvValidationIssue[] = [
      {
        _tag: "MissingVariable",
        key: "DATABASE_PASSWORD",
        schemaIdentifier: "RequiredString",
        sensitive: true,
      },
      {
        _tag: "InvalidVariable",
        key: "PORT",
        schemaIdentifier: "Port",
        sensitive: false,
      },
    ];

    const error = new EnvValidationError(issues);

    expect(error.issues).toEqual(issues);
    expect(Object.isFrozen(error.issues)).toBe(true);
    expect(Object.isFrozen(error.issues[0])).toBe(true);
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error.issues)).not.toContain(secret);
  });

  test("formats only sanitized structural metadata", () => {
    const error = new EnvValidationError([
      {
        _tag: "InvalidVariable",
        key: "PORT",
        schemaIdentifier: "Port",
        sensitive: false,
      },
    ]);

    expect(error.message).toBe(
      "Invalid environment variables:\nPORT: Expected Port (actual value omitted)",
    );
  });
});

test("ClientAccessError identifies the blocked logical key", () => {
  expect(new ClientAccessError("SECRET").variableName).toBe("SECRET");
});

test("EnvConfigurationError is tagged without arbitrary cause data", () => {
  const error = new EnvConfigurationError("Invalid environment configuration");
  expect(error._tag).toBe("EnvConfigurationError");
  expect(error).not.toHaveProperty("cause");
});
