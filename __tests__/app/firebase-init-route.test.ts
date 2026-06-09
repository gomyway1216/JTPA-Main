import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/firebase/init/route";
import { firebaseConfig } from "@/lib/firebase/config";

describe("/__/firebase/init.json", () => {
  it("serves Firebase web config for same-site auth helpers", async () => {
    const response = GET();

    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=3600, s-maxage=3600",
    );
    await expect(response.json()).resolves.toEqual({
      apiKey: firebaseConfig.apiKey,
      authDomain: firebaseConfig.authDomain,
      databaseURL: "",
      projectId: firebaseConfig.projectId,
      storageBucket: firebaseConfig.storageBucket,
      messagingSenderId: firebaseConfig.messagingSenderId,
      appId: firebaseConfig.appId,
    });
  });
});
