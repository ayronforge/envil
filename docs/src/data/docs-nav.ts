export interface NavItem {
  title: string;
  slug: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const docsNav: NavSection[] = [
  {
    title: "Getting Started",
    items: [
      { title: "Introduction", slug: "" },
      { title: "Quickstart", slug: "getting-started" },
      { title: "Core Concepts", slug: "core-concepts" },
    ],
  },
  {
    title: "Schemas",
    items: [
      { title: "Built-in Schemas", slug: "schemas" },
      { title: "Schema Helpers", slug: "schema-helpers" },
    ],
  },
  {
    title: "Configuration",
    items: [
      { title: "Framework Presets", slug: "framework-presets" },
      { title: "Environment Composition", slug: "environment-composition" },
      { title: "Error Handling", slug: "error-handling" },
    ],
  },
  {
    title: "Resolvers",
    items: [
      { title: "Overview", slug: "resolvers" },
      { title: "AWS Secrets Manager", slug: "resolvers/aws" },
      { title: "GCP Secret Manager", slug: "resolvers/gcp" },
      { title: "Azure Key Vault", slug: "resolvers/azure" },
      { title: "1Password", slug: "resolvers/onepassword" },
    ],
  },
  {
    title: "Reference",
    items: [{ title: "API Reference", slug: "api-reference" }],
  },
];

export interface FlatNavItem extends NavItem {
  section: string;
}

export function getFlatNavItems(): FlatNavItem[] {
  return docsNav.flatMap((section) =>
    section.items.map((item) => ({ ...item, section: section.title })),
  );
}

export function getPrevNext(currentSlug: string) {
  const flat = getFlatNavItems();
  const index = flat.findIndex((item) => item.slug === currentSlug);
  return {
    prev: index > 0 ? flat[index - 1] : null,
    next: index < flat.length - 1 ? flat[index + 1] : null,
  };
}

export function getBreadcrumbs(currentSlug: string) {
  const flat = getFlatNavItems();
  const item = flat.find((i) => i.slug === currentSlug);
  if (!item) return [{ title: "Docs", slug: "" }];
  const crumbs: { title: string; slug: string }[] = [{ title: "Docs", slug: "" }];
  if (item.section !== "Getting Started" || item.slug !== "") {
    crumbs.push({ title: item.section, slug: "" });
  }
  if (item.slug !== "") {
    crumbs.push({ title: item.title, slug: item.slug });
  }
  return crumbs;
}
