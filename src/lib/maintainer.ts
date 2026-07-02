import type { UserLinks } from "@/lib/types";

export const MAINTAINER_UID = "FQe7JWGETbTm9w9sAZgacemC1aC3";
export const MAINTAINER_NAME = "Yudai Yaguchi";
export const MAINTAINER_PROFILE_SLUG = "yudai-yaguchi";
export const MAINTAINER_PROFILE_PATH = `/u/${MAINTAINER_PROFILE_SLUG}`;

export const MAINTAINER_LINKS = {
  portfolio: "https://meetyudai.com/",
  github: "https://github.com/gomyway1216",
  linkedin: "https://www.linkedin.com/in/yudai-yaguchi",
} satisfies UserLinks;

export const MAINTAINER_SOURCE_CODE_URL =
  "https://github.com/gomyway1216/JTPA-Main";

export const MAINTAINER_SAME_AS = [
  MAINTAINER_LINKS.portfolio,
  MAINTAINER_LINKS.github,
  MAINTAINER_LINKS.linkedin,
];

export function isMaintainerUid(uid: string): boolean {
  return uid === MAINTAINER_UID;
}

export function isMaintainerProfileParam(value: string): boolean {
  return value === MAINTAINER_PROFILE_SLUG || isMaintainerUid(value);
}

export function resolvePublicProfileUid(value: string): string {
  return isMaintainerProfileParam(value) ? MAINTAINER_UID : value;
}

export function publicProfilePathForUid(uid: string): string {
  return isMaintainerUid(uid) ? MAINTAINER_PROFILE_PATH : `/u/${uid}`;
}

export function maintainerLinksWithFallback(links: UserLinks = {}): UserLinks {
  return {
    ...links,
    ...MAINTAINER_LINKS,
  };
}
