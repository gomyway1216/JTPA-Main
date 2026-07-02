import { describe, expect, it } from "vitest";

import {
  isMaintainerProfileParam,
  isMaintainerUid,
  MAINTAINER_LINKS,
  MAINTAINER_PROFILE_PATH,
  MAINTAINER_PROFILE_SLUG,
  MAINTAINER_UID,
  maintainerLinksWithPinnedUrls,
  publicProfilePathForUid,
  resolvePublicProfileUid,
} from "@/lib/maintainer";

describe("maintainer identity helpers", () => {
  it("recognizes the canonical maintainer uid and slug", () => {
    expect(isMaintainerUid(MAINTAINER_UID)).toBe(true);
    expect(isMaintainerProfileParam(MAINTAINER_UID)).toBe(true);
    expect(isMaintainerProfileParam(MAINTAINER_PROFILE_SLUG)).toBe(true);
    expect(isMaintainerProfileParam("someone-else")).toBe(false);
  });

  it("resolves the public maintainer slug to the stable Firebase uid", () => {
    expect(resolvePublicProfileUid(MAINTAINER_PROFILE_SLUG)).toBe(
      MAINTAINER_UID,
    );
    expect(resolvePublicProfileUid("regular-user")).toBe("regular-user");
  });

  it("returns the canonical profile path for the maintainer only", () => {
    expect(publicProfilePathForUid(MAINTAINER_UID)).toBe(
      MAINTAINER_PROFILE_PATH,
    );
    expect(publicProfilePathForUid("regular-user")).toBe("/u/regular-user");
  });

  it("pins maintainer links over incomplete profile links", () => {
    expect(
      maintainerLinksWithPinnedUrls({ github: "https://old.example" }),
    ).toEqual(MAINTAINER_LINKS);
  });
});
