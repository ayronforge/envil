import { getSimpleIcon } from "@/lib/utils";

type SocialIconProps = {
  className?: string;
} & Parameters<typeof getSimpleIcon>[0];

export function SocialIcon({ icon, color, className }: SocialIconProps) {
  const srcImg = getSimpleIcon({ icon, color });
  return <img alt={icon} className={className} src={srcImg} />;
}
