import type { Platform } from "@/domain/social-listening/types";
import { facebookProvider } from "./facebook";
import { instagramProvider } from "./instagram";
import { linkedinProvider } from "./linkedin";
import { redditProvider } from "./reddit";
import type { SocialProvider } from "./types";
import { tiktokProvider } from "./tiktok";
import { xProvider } from "./x";
import { youtubeProvider } from "./youtube";

export const socialProviders = {
  tiktok: tiktokProvider,
  instagram: instagramProvider,
  youtube: youtubeProvider,
  reddit: redditProvider,
  x: xProvider,
  facebook: facebookProvider,
  linkedin: linkedinProvider,
} as const;

export function providerFor(platform: Platform): SocialProvider | null {
  if (platform === "other") return null;
  return socialProviders[platform];
}

export {
  facebookProvider,
  instagramProvider,
  linkedinProvider,
  redditProvider,
  tiktokProvider,
  xProvider,
  youtubeProvider,
};
