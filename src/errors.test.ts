import { describe, expect, test } from "bun:test";

import { ClientAccessError, EnvValidationError } from "./errors.ts";

describe("EnvValidationError", () => {
	test("is an instance of Error", () => {
		const err = new EnvValidationError(["VAR: missing"]);
		expect(err).toBeInstanceOf(Error);
	});

	test("has _tag 'EnvValidationError'", () => {
		const err = new EnvValidationError(["VAR: missing"]);
		expect(err._tag).toBe("EnvValidationError");
	});

	test("has name 'EnvValidationError'", () => {
		const err = new EnvValidationError(["VAR: missing"]);
		expect(err.name).toBe("EnvValidationError");
	});

	test("exposes structured errors array", () => {
		const errors = ["DB_URL: expected string", "PORT: expected number"];
		const err = new EnvValidationError(errors);
		expect(err.errors).toEqual(errors);
	});

	test("errors array is readonly", () => {
		const err = new EnvValidationError(["VAR: missing"]);
		expect(Array.isArray(err.errors)).toBe(true);
	});

	test("formats message with all errors", () => {
		const err = new EnvValidationError(["A: bad", "B: worse"]);
		expect(err.message).toBe("Invalid environment variables:\nA: bad\nB: worse");
	});

	test("formats message with single error", () => {
		const err = new EnvValidationError(["ONLY: issue"]);
		expect(err.message).toBe("Invalid environment variables:\nONLY: issue");
	});
});

describe("ClientAccessError", () => {
	test("is an instance of Error", () => {
		const err = new ClientAccessError("SECRET");
		expect(err).toBeInstanceOf(Error);
	});

	test("has _tag 'ClientAccessError'", () => {
		const err = new ClientAccessError("SECRET");
		expect(err._tag).toBe("ClientAccessError");
	});

	test("has name 'ClientAccessError'", () => {
		const err = new ClientAccessError("SECRET");
		expect(err.name).toBe("ClientAccessError");
	});

	test("exposes variableName", () => {
		const err = new ClientAccessError("DATABASE_URL");
		expect(err.variableName).toBe("DATABASE_URL");
	});

	test("formats message with variable name", () => {
		const err = new ClientAccessError("API_KEY");
		expect(err.message).toBe('Attempted to access server-side env var "API_KEY" on client');
	});
});
