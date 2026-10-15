import {
  createSocialCard,
  socialCardAlt,
  socialCardContentType,
  socialCardSize,
} from "@/lib/social-card";

export const alt = socialCardAlt;
export const size = socialCardSize;
export const contentType = socialCardContentType;

export default function TwitterImage() {
  return createSocialCard();
}
