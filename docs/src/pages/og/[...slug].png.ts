import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { generateOgImage } from "@/lib/og-image";
import { site } from "@/data/content";

export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getCollection("docs");

  return [
    // Landing page
    {
      params: { slug: "home" },
      props: {
        title: "Type-safe env vars for apps and agents",
        description: site.description,
        isLanding: true,
      },
    },
    // Docs pages
    ...docs.map((entry) => ({
      params: { slug: entry.id === "index" ? "docs" : `docs/${entry.id}` },
      props: {
        title: entry.data.title,
        description: entry.data.description,
        isLanding: false,
      },
    })),
  ];
};

export const GET: APIRoute = async ({ props }) => {
  const { title, description, isLanding } = props as {
    title: string;
    description: string;
    isLanding: boolean;
  };

  const png = await generateOgImage(title, description, isLanding);

  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
