import { describe, expect, it, vi } from "vitest";

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

import type { StorageReference } from "firebase/storage";

import {
  GUIDE_IMAGE_ACCEPT,
  GUIDE_IMAGE_LABEL,
  GUIDE_IMAGE_TYPES,
  MAX_GUIDE_IMAGE_BYTES,
  publicDownloadUrl,
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
