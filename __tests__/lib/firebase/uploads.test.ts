import { beforeEach, describe, expect, it, vi } from "vitest";

// uploads.ts is "use client" and pulls in firebase/storage. The
// publicDownloadUrl helper is pure — it only reads ref.storage._host /
// _protocol / ref.bucket / ref.fullPath — but loading the module also
// evaluates ./client which initializes a Firebase app. Stub the modules
// it transitively imports so the test stays hermetic (no Firebase init,
// no network) and we can exercise the URL builder against a hand-rolled
// StorageReference stub.
vi.mock("firebase/storage", () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
}));

vi.mock("@/lib/firebase/client", () => ({
  clientStorage: {},
}));

import { ref, uploadBytes, type StorageReference } from "firebase/storage";

import {
  GUIDE_IMAGE_ACCEPT,
  GUIDE_IMAGE_LABEL,
  GUIDE_IMAGE_TYPES,
  MAX_AVATAR_IMAGE_BYTES,
  MAX_GUIDE_IMAGE_BYTES,
  publicDownloadUrl,
  uploadUserAvatar,
} from "@/lib/firebase/uploads";

function makeRef(opts: {
  bucket: string;
  fullPath: string;
  host?: string;
  protocol?: string;
}): StorageReference {
  return {
    bucket: opts.bucket,
    fullPath: opts.fullPath,
    storage: {
      _host: opts.host,
      _protocol: opts.protocol,
    },
  } as unknown as StorageReference;
}

describe("publicDownloadUrl", () => {
  it("builds a token-less ?alt=media URL from the SDK-internal host", () => {
    const url = publicDownloadUrl(
      makeRef({
        bucket: "demo-bucket",
        fullPath: "guides/abc/123-image.png",
        host: "firebasestorage.googleapis.com",
        protocol: "https",
      }),
    );
    expect(url).toBe(
      "https://firebasestorage.googleapis.com/v0/b/demo-bucket/o/guides%2Fabc%2F123-image.png?alt=media",
    );
  });

  it("falls back to the production host when the SDK didn't populate _host", () => {
    // E.g. minimal stub or older SDK version that doesn't expose _host.
    const url = publicDownloadUrl(
      makeRef({ bucket: "demo-bucket", fullPath: "a/b" }),
    );
    expect(url).toBe(
      "https://firebasestorage.googleapis.com/v0/b/demo-bucket/o/a%2Fb?alt=media",
    );
  });

  it("honours emulator host+protocol when set on the storage instance", () => {
    // connectStorageEmulator(...) sets _host = "127.0.0.1:9199" and
    // _protocol = "http". The helper has to follow that so emulator
    // tests resolve correctly.
    const url = publicDownloadUrl(
      makeRef({
        bucket: "demo-bucket",
        fullPath: "guides/x.png",
        host: "127.0.0.1:9199",
        protocol: "http",
      }),
    );
    expect(url).toBe(
      "http://127.0.0.1:9199/v0/b/demo-bucket/o/guides%2Fx.png?alt=media",
    );
  });

  it("URL-encodes forward slashes and special characters in the path", () => {
    const url = publicDownloadUrl(
      makeRef({
        bucket: "b",
        fullPath: "qa/Q1/uid/2024 file name?.png",
      }),
    );
    // Spaces, '?', and '/' must all be percent-encoded so the resulting URL
    // is unambiguous.
    expect(url).toContain("qa%2FQ1%2Fuid%2F2024%20file%20name%3F.png");
  });

  it("never appends a token query parameter", () => {
    // Whole point of this helper vs getDownloadURL(): no &token=<UUID>.
    const url = publicDownloadUrl(
      makeRef({ bucket: "b", fullPath: "x" }),
    );
    expect(url).not.toContain("token");
  });
});

describe("guide image allowlist", () => {
  it("includes raster formats only — never image/svg+xml", () => {
    // Storage rules and the form-side check both refuse SVG (active
    // markup risk). The allowlist must stay raster-only.
    expect(GUIDE_IMAGE_TYPES).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]);
    expect(GUIDE_IMAGE_TYPES).not.toContain("image/svg+xml");
  });

  it("derives GUIDE_IMAGE_ACCEPT from the allowlist (no drift)", () => {
    // The <input accept="..."> attribute and the runtime validator share
    // one source of truth; if the join ever drifts the picker will let
    // the user choose a file that the validator then rejects.
    expect(GUIDE_IMAGE_ACCEPT).toBe(GUIDE_IMAGE_TYPES.join(","));
  });

  it("caps uploads at 5 MiB", () => {
    expect(MAX_GUIDE_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });

  it("ships a human-readable label that matches the allowlist", () => {
    expect(GUIDE_IMAGE_LABEL).toBe("PNG / JPEG / WebP / GIF");
  });
});

describe("uploadUserAvatar", () => {
  // The function only inspects file.name / file.type / file.size, so a
  // plain object stands in for a real File (constructing one with a
  // controlled byte size isn't ergonomic in the test env).
  const file = (
    over: Partial<{ name: string; type: string; size: number }> = {},
  ): File =>
    ({
      name: over.name ?? "pic.png",
      type: over.type ?? "image/png",
      size: over.size ?? 1234,
    }) as unknown as File;
  const messages = {
    missingGuideId: () => "missing guide",
    missingQaId: () => "missing qa",
    missingUserId: () => "missing user",
    unsupportedType: (types: string) => `type ${types}`,
    tooLarge: (size: number) => `large ${size}`,
  };

  beforeEach(() => {
    vi.mocked(uploadBytes).mockReset();
    vi.mocked(uploadBytes).mockResolvedValue({} as never);
    vi.mocked(ref).mockReset();
    // Echo the generated path back through a ref stub whose internal
    // fields publicDownloadUrl reads, so the test can assert on the path.
    vi.mocked(ref).mockImplementation((_storage, path) =>
      makeRef({
        bucket: "demo-bucket",
        fullPath: String(path ?? ""),
        host: "firebasestorage.googleapis.com",
        protocol: "https",
      }),
    );
  });

  it("caps the avatar at 2 MiB (matches storage.rules maxSize(2))", () => {
    expect(MAX_AVATAR_IMAGE_BYTES).toBe(2 * 1024 * 1024);
  });

  it("rejects a missing uid before touching Storage", async () => {
    await expect(uploadUserAvatar("", file(), messages)).rejects.toThrow();
    expect(uploadBytes).not.toHaveBeenCalled();
  });

  it("rejects non-raster types such as SVG", async () => {
    await expect(
      uploadUserAvatar("u1", file({ type: "image/svg+xml" }), messages),
    ).rejects.toThrow();
    expect(uploadBytes).not.toHaveBeenCalled();
  });

  it("rejects files larger than 2 MiB", async () => {
    await expect(
      uploadUserAvatar(
        "u1",
        file({ size: MAX_AVATAR_IMAGE_BYTES + 1 }),
        messages,
      ),
    ).rejects.toThrow();
    expect(uploadBytes).not.toHaveBeenCalled();
  });

  it("uploads under users/{uid}/avatar-… and returns the {path, url} pair", async () => {
    const result = await uploadUserAvatar(
      "u1",
      file({ name: "me.png" }),
      messages,
    );
    expect(result.path).toMatch(/^users\/u1\/avatar-\d+-me\.png$/);
    expect(result.url).toContain(
      `/o/${encodeURIComponent(result.path)}?alt=media`,
    );
    expect(uploadBytes).toHaveBeenCalledOnce();
  });

  it("scopes the path to the uid (one user can't target another's folder)", async () => {
    const a = await uploadUserAvatar("alice", file(), messages);
    const b = await uploadUserAvatar("bob", file(), messages);
    expect(a.path.startsWith("users/alice/")).toBe(true);
    expect(b.path.startsWith("users/bob/")).toBe(true);
  });
});
