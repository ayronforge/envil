export interface PrefixMap {
  server?: string;
  client?: string;
  shared?: string;
}

export function resolvePrefixMap(prefix: string | PrefixMap | undefined): Required<PrefixMap> {
  if (typeof prefix === "string" || prefix === undefined) {
    const value = prefix ?? "";
    return { server: value, client: value, shared: value };
  }

  return {
    server: prefix.server ?? "",
    client: prefix.client ?? "",
    shared: prefix.shared ?? "",
  };
}
