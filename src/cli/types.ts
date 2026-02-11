export const BUCKETS = ["server", "client", "shared"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const SCHEMA_KINDS = [
  "requiredString",
  "boolean",
  "integer",
  "number",
  "port",
  "url",
  "postgresUrl",
  "redisUrl",
  "mongoUrl",
  "mysqlUrl",
  "commaSeparated",
  "commaSeparatedNumbers",
  "commaSeparatedUrls",
  "json",
  "stringEnum",
] as const;
export type SchemaKind = (typeof SCHEMA_KINDS)[number];

export const FRAMEWORKS = ["nextjs", "vite", "expo", "nuxt", "sveltekit", "astro"] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export interface PrefixConfig {
  readonly server: string;
  readonly client: string;
  readonly shared: string;
}

export interface ParsedDirectives {
  readonly type?: SchemaKind;
  readonly optional?: boolean;
  readonly hasDefault?: boolean;
  readonly redacted?: boolean;
  readonly bucket?: Bucket;
  readonly stringEnumValues?: readonly string[];
}

export interface DotenvAssignment {
  readonly key: string;
  readonly value: string;
  readonly line: number;
  readonly sectionBucket?: Bucket;
  readonly directives: ParsedDirectives;
}

export interface DotenvDocument {
  readonly entries: ReadonlyArray<DotenvAssignment>;
  readonly prefix?: Partial<PrefixConfig>;
}

export interface InferredVariable {
  readonly schemaKey: string;
  readonly runtimeKey: string;
  readonly bucket: Bucket;
  readonly kind: SchemaKind;
  readonly optional: boolean;
  readonly hasDefault: boolean;
  readonly defaultValue?: unknown;
  readonly redacted: boolean;
  readonly sourceLine: number;
  readonly stringEnumValues?: readonly string[];
}

export interface InferredModel {
  readonly prefix: PrefixConfig;
  readonly variables: ReadonlyArray<InferredVariable>;
  readonly runtimeEnv: Readonly<Record<string, string | undefined>>;
}

