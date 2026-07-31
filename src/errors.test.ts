import { describe, expect, test } from "bun:test";

import { EnvConfigurationError, EnvValidationError, type EnvValidationIssue } from "./errors.ts";

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
    expect(error.message).toContain(
      '"DATABASE_PASSWORD" is missing. Set it before starting the application.',
    );
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
      'Environment setup failed:\n- "PORT" has an invalid value. Expected a whole number from 1 to 65535.\nUpdate the listed variables and try again.',
    );
  });
});

test("EnvConfigurationError is tagged without arbitrary cause data", () => {
  const error = new EnvConfigurationError("Invalid environment configuration");
  expect(error._tag).toBe("EnvConfigurationError");
  expect(error).not.toHaveProperty("cause");
});
