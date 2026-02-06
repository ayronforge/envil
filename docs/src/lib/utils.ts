import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getSimpleIcon({ icon, color }: { icon: string; color: "white" | "black" }) {
  return `https://cdn.simpleicons.org/${icon}/${color}`;
}

async function tryUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

const deviconUrl = (slug: string, variant: string) =>
  `https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/${slug}/${slug}-${variant}.svg`;

export async function getIcon(slug: string, color: "white" | "black" = "black"): Promise<string> {
  const candidates = [
    `https://cdn.simpleicons.org/${slug}/${color}`,
    ...(color === "white"
      ? [deviconUrl(slug, "plain-white"), deviconUrl(slug, "original-white")]
      : []),
    deviconUrl(slug, "plain"),
    deviconUrl(slug, "original"),
    deviconUrl(slug, "plain-wordmark"),
    deviconUrl(slug, "original-wordmark"),
  ];

  for (const url of candidates) {
    const result = await tryUrl(url);
    if (result) return result;
  }

  return candidates[0];
}
