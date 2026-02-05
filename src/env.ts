import { Either, ParseResult, Redacted, Schema } from "effect";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = Schema.Schema<any, any, never>;
type SchemaDict = Record<string, AnySchema>;
type UnwrapRedacted<T> = T extends Redacted.Redacted<infer A> ? A : T;
type InferEnv<T extends SchemaDict> = { [K in keyof T]: UnwrapRedacted<Schema.Schema.Type<T[K]>> };

interface PrefixMap {
  server?: string;
  client?: string;
  shared?: string;
}

interface EnvOptions<
  TServer extends SchemaDict,
  TClient extends SchemaDict,
  TShared extends SchemaDict,
> {
  server?: TServer;
  client?: TClient;
  shared?: TShared;
  prefix?: string | PrefixMap;
  runtimeEnv?: Record<string, string | undefined>;
  isServer?: boolean;
  onValidationError?: (errors: string[]) => void;
}

export function createEnv<
  TServer extends SchemaDict = Record<string, never>,
  TClient extends SchemaDict = Record<string, never>,
  TShared extends SchemaDict = Record<string, never>,
>(opts: EnvOptions<TServer, TClient, TShared>): Readonly<InferEnv<TServer & TClient & TShared>> {
  const runtimeEnv = opts.runtimeEnv ?? process.env;
  const isServer = opts.isServer ?? typeof window === "undefined";

  const server = opts.server ?? ({} as TServer);
  const client = opts.client ?? ({} as TClient);
  const shared = opts.shared ?? ({} as TShared);

  const prefixMap: Required<PrefixMap> =
    typeof opts.prefix === "string" || opts.prefix === undefined
      ? { server: opts.prefix ?? "", client: opts.prefix ?? "", shared: opts.prefix ?? "" }
      : {
          server: opts.prefix.server ?? "",
          client: opts.prefix.client ?? "",
          shared: opts.prefix.shared ?? "",
        };

  const schema = isServer ? { ...server, ...client, ...shared } : { ...client, ...shared };

  const result: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [key, validator] of Object.entries(schema)) {
    const category = key in client ? "client" : key in shared ? "shared" : "server";
    const envKey = `${prefixMap[category]}${key}`;
    const value = runtimeEnv[envKey];
    const parsed = Schema.decodeUnknownEither(validator)(value);

    if (Either.isLeft(parsed)) {
      const detail = ParseResult.TreeFormatter.formatErrorSync(parsed.left);
      errors.push(`${envKey}: ${detail}`);
    } else {
      result[key] = parsed.right;
    }
  }

  if (errors.length > 0) {
    if (opts.onValidationError) {
      opts.onValidationError(errors);
    }
    throw new Error(`Invalid environment variables:\n${errors.join("\n")}`);
  }

  return new Proxy(result, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (!isServer && prop in server && !(prop in client) && !(prop in shared)) {
        throw new Error(`Attempted to access server-side env var "${prop}" on client`);
      }
      const value = Reflect.get(target, prop);
      return Redacted.isRedacted(value) ? Redacted.value(value) : value;
    },
  }) as Readonly<InferEnv<TServer & TClient & TShared>>;
}
