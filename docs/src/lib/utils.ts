import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getSimpleIcon({ icon, color }: { icon: string; color: string }) {
  const normalizedColor = color.replace("#", "");
  return `https://cdn.simpleicons.org/${icon}/${normalizedColor}`;
}
