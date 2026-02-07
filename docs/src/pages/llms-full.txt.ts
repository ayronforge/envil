import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { docsNav } from "@/data/docs-nav";

function typeTableToMarkdown(match: string): string {
  const rows: { name: string; type: string; description: string }[] = [];
  const rowRe =
    /name:\s*"([^"\\]*(?:\\.[^"\\]*)*)"[^}]*?type:\s*"([^"\\]*(?:\\.[^"\\]*)*)"[^}]*?description:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  let m;
  while ((m = rowRe.exec(match)) !== null) {
    rows.push({
      name: m[1].replace(/\\"/g, '"'),
      type: m[2].replace(/\\"/g, '"'),
      description: m[3].replace(/\\"/g, '"'),
    });
  }
  if (rows.length === 0) return "";
  const lines = ["| Name | Type | Description |", "| --- | --- | --- |"];
  for (const row of rows) {
    lines.push(`| \`${row.name}\` | \`${row.type}\` | ${row.description} |`);
  }
  return lines.join("\n");
}

function stripMdx(raw: string): string {
  let content = raw.replace(/^---[\s\S]*?---\n*/, "");

  // Only strip top-level import lines (at start of file, not inside code blocks)
  content = content.replace(/^(\s*import\s+[^\n]*\n)+/, "");

  // Convert <TypeTable> to markdown tables
  content = content.replace(/<TypeTable\s+rows=\{\[[\s\S]*?\]\}\s*\/>/g, typeTableToMarkdown);

  // Convert <Callout> to blockquotes
  content = content.replace(/<Callout[^>]*>([\s\S]*?)<\/Callout>/g, (match, inner) => {
    const titleMatch = match.match(/title="([^"]*)"/);
    const lines = inner.trim().split("\n");
    if (titleMatch) lines.unshift(`**${titleMatch[1]}**`);
    return lines.map((l: string) => `> ${l.trimStart()}`).join("\n");
  });

  // Convert <Card> to list items
  content = content.replace(
    /<Card\s+title="([^"]*)"[^>]*>([\s\S]*?)<\/Card>/g,
    (_, title, inner) => `- **${title}**: ${inner.trim()}`,
  );

  // Convert Tabs to just the first tab's content (npm), stripping inner indentation
  content = content.replace(/<Tabs[^>]*>[\s\S]*?<\/Tabs>/g, (match) => {
    const firstDiv = match.match(/<div>([\s\S]*?)<\/div>/);
    if (!firstDiv) return "";
    return firstDiv[1]
      .split("\n")
      .map((l) => l.replace(/^ {4}/, ""))
      .join("\n")
      .trim();
  });

  // Strip CardGroup wrappers but keep inner content
  content = content.replace(/<\/?CardGroup[^>]*>/g, "");

  // Strip div tags but keep inner content
  content = content.replace(/<\/?div[^>]*>/g, "");

  // Remove remaining self-closing JSX tags
  content = content.replace(/<[A-Z]\w*[\s\S]*?\/>/g, "");

  // Remove remaining paired JSX component tags
  content = content.replace(/<[A-Z]\w*[^>]*>[\s\S]*?<\/[A-Z]\w*>/g, "");

  // Remove empty code blocks (left over from import-only blocks)
  content = content.replace(/^[ \t]*```\w*\n[ \t]*```$/gm, "");

  // Clean up excessive blank lines
  return content.replace(/\n{3,}/g, "\n\n").trim();
}

export const GET: APIRoute = async () => {
  const allDocs = await getCollection("docs");

  // Build a lookup by slug (entry id)
  const docsBySlug = new Map(allDocs.map((doc) => [doc.id, doc]));

  // Order docs according to docsNav
  const ordered: { title: string; section: string; id: string; body: string }[] = [];

  for (const section of docsNav) {
    for (const item of section.items) {
      // Map nav slug to content collection id
      const id = item.slug === "" ? "index" : item.slug;
      const resolvedIds = [id, `${id}/index`];
      const doc = resolvedIds.reduce<(typeof allDocs)[number] | undefined>(
        (found, candidate) => found ?? docsBySlug.get(candidate),
        undefined,
      );

      if (doc?.body) {
        ordered.push({
          title: item.title,
          section: section.title,
          id: doc.id,
          body: doc.body,
        });
      }
    }
  }

  const parts: string[] = [
    "# @ayronforge/better-env — Full Documentation",
    "",
    "> Type-safe environment variables powered by Effect Schema.",
    "",
  ];

  for (const doc of ordered) {
    parts.push(
      `${"=".repeat(60)}`,
      `## ${doc.section} — ${doc.title}`,
      `${"=".repeat(60)}`,
      "",
      stripMdx(doc.body),
      "",
    );
  }

  return new Response(parts.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
