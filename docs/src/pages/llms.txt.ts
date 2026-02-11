import type { APIRoute } from "astro";

import { docsNav } from "@/data/docs-nav";

const BASE = "/envil";
const SITE = "https://ayronforge.com";

export const GET: APIRoute = () => {
  const lines: string[] = [
    "# @ayronforge/envil",
    "",
    "> Type-safe environment variables powered by Effect Schema. Validate, transform, and manage env vars with full TypeScript inference.",
    "",
    `Full docs: ${SITE}${BASE}/llms-full.txt`,
    "",
  ];

  for (const section of docsNav) {
    lines.push(`## ${section.title}`, "");

    for (const item of section.items) {
      const path = item.slug ? `docs/${item.slug}` : "docs";
      lines.push(`- [${item.title}](${SITE}${BASE}/${path})`);
    }

    lines.push("");
  }

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
