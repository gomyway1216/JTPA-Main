// Security-rules tests for storage.rules. These run against the Storage
// emulator and are excluded from plain `npm test` — run them via
// `npm run test:rules` (firebase emulators:exec + vitest.rules.config.mts).
import {
  assertFails,
  assertSucceeds,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteObject, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import {
  ADMIN,
  ALICE,
  BOB,
  createRulesTestEnv,
  EDITOR,
  storageOf,
} from "./helpers";

let testEnv: RulesTestEnvironment;

const alice = () => testEnv.authenticatedContext(ALICE);
const bob = () => testEnv.authenticatedContext(BOB);
const admin = () => testEnv.authenticatedContext(ADMIN, { admin: true });
const editor = () => testEnv.authenticatedContext(EDITOR, { editor: true });

// The rules validate `request.resource.contentType` (metadata), so tiny
// placeholder bytes are enough for every type/ownership check.
const SMALL_FILE = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function upload(
  ctx: RulesTestContext,
  path: string,
  contentType: string,
  bytes: Uint8Array = SMALL_FILE,
) {
  return uploadBytes(ref(storageOf(ctx), path), bytes, { contentType });
}

beforeAll(async () => {
  testEnv = await createRulesTestEnv();
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

afterAll(async () => {
  // `testEnv` is undefined if `createRulesTestEnv()` threw in beforeAll;
  // guard so cleanup doesn't mask the real initialization error.
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe("users (avatars)", () => {
  it("owner can upload a small raster image to their own folder", async () => {
    await assertSucceeds(
      upload(alice(), `users/${ALICE}/avatar.png`, "image/png"),
    );
  });

  it("rejects SVG (not in the raster whitelist) and files at the 2MB cap", async () => {
    await assertFails(
      upload(alice(), `users/${ALICE}/avatar.svg`, "image/svg+xml"),
    );
    // maxSize(2) is a strict `<`, so exactly 2MiB must be rejected.
    await assertFails(
      upload(
        alice(),
        `users/${ALICE}/huge.png`,
        "image/png",
        new Uint8Array(2 * 1024 * 1024),
      ),
    );
  });

  it("nobody can write into another user's folder — not even admin", async () => {
    await assertFails(upload(bob(), `users/${ALICE}/avatar.png`, "image/png"));
    // The users/ rule deliberately has no isAdmin() branch.
    await assertFails(
      upload(admin(), `users/${ALICE}/avatar.png`, "image/png"),
    );
  });

  it("owner can delete own upload (delete is split from the image checks)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await upload(ctx, `users/${ALICE}/orphan.png`, "image/png");
    });
    await assertSucceeds(
      deleteObject(ref(storageOf(alice()), `users/${ALICE}/orphan.png`)),
    );
  });
});

describe("events (cover images)", () => {
  it("only admin can write, and only whitelisted image types", async () => {
    await assertSucceeds(upload(admin(), "events/evt1/cover.png", "image/png"));
    await assertFails(upload(alice(), "events/evt1/cover.png", "image/png"));
    await assertFails(
      upload(admin(), "events/evt1/cover.svg", "image/svg+xml"),
    );
  });
});

describe("projects (showcase assets)", () => {
  it("owner folder accepts images only; other users are locked out", async () => {
    await assertSucceeds(
      upload(alice(), `projects/${ALICE}/shot.webp`, "image/webp"),
    );
    await assertFails(
      upload(alice(), `projects/${ALICE}/readme.pdf`, "application/pdf"),
    );
    await assertFails(
      upload(bob(), `projects/${ALICE}/shot.png`, "image/png"),
    );
  });
});

describe("posts (blog cover + body images)", () => {
  it("author writes images to their own folder; admin writes any; others locked out", async () => {
    await assertSucceeds(
      upload(alice(), `posts/${ALICE}/cover.png`, "image/png"),
    );
    // Admin can write into anyone's post folder (unlike users/ avatars).
    await assertSucceeds(
      upload(admin(), `posts/${ALICE}/body.webp`, "image/webp"),
    );
    await assertFails(upload(bob(), `posts/${ALICE}/sneaky.png`, "image/png"));
  });

  it("non-image uploads are rejected and the 5MB cap is enforced", async () => {
    await assertFails(
      upload(alice(), `posts/${ALICE}/readme.pdf`, "application/pdf"),
    );
    await assertFails(
      upload(alice(), `posts/${ALICE}/logo.svg`, "image/svg+xml"),
    );
    // maxSize(5) is a strict `<`, so exactly 5MiB must be rejected.
    await assertFails(
      upload(
        alice(),
        `posts/${ALICE}/huge.png`,
        "image/png",
        new Uint8Array(5 * 1024 * 1024),
      ),
    );
  });

  it("owner can delete own upload (delete is split from the image checks)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await upload(ctx, `posts/${ALICE}/orphan.png`, "image/png");
    });
    await assertFails(
      deleteObject(ref(storageOf(bob()), `posts/${ALICE}/orphan.png`)),
    );
    await assertSucceeds(
      deleteObject(ref(storageOf(alice()), `posts/${ALICE}/orphan.png`)),
    );
  });
});

describe("presentations", () => {
  it("presenter can upload any file type to their own event folder", async () => {
    await assertSucceeds(
      upload(
        alice(),
        `presentations/evt1/${ALICE}/slides.pdf`,
        "application/pdf",
      ),
    );
    await assertFails(
      upload(bob(), `presentations/evt1/${ALICE}/slides.pdf`, "application/pdf"),
    );
    await assertSucceeds(
      upload(
        admin(),
        `presentations/evt1/${ALICE}/handout.pdf`,
        "application/pdf",
      ),
    );
  });
});

describe("guides (body images)", () => {
  it("uploader is confined to their own subfolder; editor can write anywhere", async () => {
    await assertSucceeds(
      upload(alice(), `guides/g1/${ALICE}/diagram.png`, "image/png"),
    );
    await assertFails(
      upload(alice(), `guides/g1/${BOB}/diagram.png`, "image/png"),
    );
    await assertSucceeds(
      upload(editor(), `guides/g1/${BOB}/fixed.png`, "image/png"),
    );
  });

  it("legacy flat path stays admin/editor-only", async () => {
    await assertFails(upload(alice(), "guides/g1/legacy.png", "image/png"));
    await assertSucceeds(upload(editor(), "guides/g1/legacy.png", "image/png"));
  });
});

describe("qa (body images)", () => {
  it("uploader is confined to their own subfolder", async () => {
    await assertSucceeds(
      upload(alice(), `qa/q1/${ALICE}/screen.png`, "image/png"),
    );
    await assertFails(upload(bob(), `qa/q1/${ALICE}/screen.png`, "image/png"));
  });
});
