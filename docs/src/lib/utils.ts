import { type ClassValue, clsx } from "clsx";
import { Effect } from "effect";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getSimpleIcon({ icon, color }: { icon: string; color: "white" | "black" }) {
  return `https://cdn.simpleicons.org/${icon}/${color}`;
}

const tryUrl = (url: string) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(url, { method: "HEAD" });
      if (!res.ok) throw new Error(`${res.status}`);
      return url;
    },
    catch: () => new Error(`Failed to fetch ${url}`),
  });

const deviconUrl = (slug: string, variant: string) =>
  `https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/${slug}/${slug}-${variant}.svg`;

export const getIcon = (slug: string, color: "white" | "black" = "black") =>
  tryUrl(`https://cdn.simpleicons.org/${slug}/${color}`).pipe(
    Effect.orElse(() => tryUrl(deviconUrl(slug, "plain"))),
    Effect.orElse(() => tryUrl(deviconUrl(slug, "original"))),
    Effect.orElse(() => tryUrl(deviconUrl(slug, "plain-wordmark"))),
    Effect.orElse(() => tryUrl(deviconUrl(slug, "original-wordmark"))),
  );
