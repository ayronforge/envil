export class EnvValidationError extends Error {
	readonly _tag = "EnvValidationError" as const;
	readonly errors: ReadonlyArray<string>;
	constructor(errors: ReadonlyArray<string>) {
		super(`Invalid environment variables:\n${errors.join("\n")}`);
		this.name = "EnvValidationError";
		this.errors = errors;
	}
}

export class ClientAccessError extends Error {
	readonly _tag = "ClientAccessError" as const;
	readonly variableName: string;
	constructor(variableName: string) {
		super(`Attempted to access server-side env var "${variableName}" on client`);
		this.name = "ClientAccessError";
		this.variableName = variableName;
	}
}
