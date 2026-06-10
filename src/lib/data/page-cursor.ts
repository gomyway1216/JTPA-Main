import "server-only";

import { Timestamp } from "firebase-admin/firestore";

// Opaque pagination cursor shared by the cursor-paged list queries
// (comments, admin feedback). A cursor encodes the (createdAt, doc id)
// pair of the last document on a page; the next page resumes with
// `startAfter(createdAt, id)` against a query ordered by `createdAt`
// with `FieldPath.documentId()` as an explicit tiebreak — so the cursor
// stays total-ordered even if two docs share a createdAt.
//
// The encoding is base64url(JSON). That keeps the value URL- and
// RSC-boundary-safe and opaque to clients, while staying trivially
// debuggable server-side. Decoding is defensive: cursors arrive from
// the client (a Server Action argument or a `?cursor=` query param),
// so any malformed or tampered value yields `null` instead of a throw,
// and callers treat `null` as "start from the first page."

// Bounds enforced by the Firestore SDK's Timestamp constructor. A
// crafted cursor outside them would make `new Timestamp()` throw, so
// validate before constructing.
const MIN_SECONDS = -62_135_596_800;
const MAX_SECONDS = 253_402_300_799;
const MAX_NANOSECONDS = 999_999_999;

// Accepts every shape a Firestore `createdAt` can reach us in: a live
// Admin SDK Timestamp, a `plainify`d one (`_seconds`/`_nanoseconds`),
// the client-SDK-style POJO, or a Date. Returns null for anything else
// (e.g. a legacy doc missing the field) — callers then simply stop
// offering a next page rather than emitting a broken cursor.
function timestampParts(
  value: unknown,
): { seconds: number; nanoseconds: number } | null {
  if (value instanceof Timestamp) {
    return { seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof Date) {
    const ts = Timestamp.fromDate(value);
    return { seconds: ts.seconds, nanoseconds: ts.nanoseconds };
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const seconds = obj.seconds ?? obj._seconds;
    const nanoseconds = obj.nanoseconds ?? obj._nanoseconds;
    if (typeof seconds === "number" && typeof nanoseconds === "number") {
      return { seconds, nanoseconds };
    }
  }
  return null;
}

function isValidParts(seconds: number, nanoseconds: number): boolean {
  return (
    Number.isInteger(seconds) &&
    seconds >= MIN_SECONDS &&
    seconds <= MAX_SECONDS &&
    Number.isInteger(nanoseconds) &&
    nanoseconds >= 0 &&
    nanoseconds <= MAX_NANOSECONDS
  );
}

export function encodePageCursor(createdAt: unknown, id: string): string | null {
  const parts = timestampParts(createdAt);
  // Doc ids can't contain "/" (that would be a path), so refuse to
  // encode one — decode rejects it anyway.
  if (!parts || !id || id.includes("/")) return null;
  if (!isValidParts(parts.seconds, parts.nanoseconds)) return null;
  const payload = JSON.stringify([parts.seconds, parts.nanoseconds, id]);
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodePageCursor(
  cursor: string,
): { createdAt: Timestamp; id: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) return null;
  const [seconds, nanoseconds, id] = parsed as unknown[];
  if (typeof seconds !== "number" || typeof nanoseconds !== "number") {
    return null;
  }
  if (!isValidParts(seconds, nanoseconds)) return null;
  if (typeof id !== "string" || id.length === 0 || id.includes("/")) {
    return null;
  }
  return { createdAt: new Timestamp(seconds, nanoseconds), id };
}

/**
 * Shared "did we overfetch?" page slicer. Callers query `pageSize + 1`
 * docs; the extra doc only proves another page exists and is dropped
 * from the returned slice. `nextCursor` points at the last *returned*
 * doc, or is null when this page reached the end of the collection.
 */
export function slicePage(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  pageSize: number,
): {
  pageDocs: FirebaseFirestore.QueryDocumentSnapshot[];
  nextCursor: string | null;
} {
  const pageDocs = docs.slice(0, pageSize);
  const last = pageDocs[pageDocs.length - 1];
  const nextCursor =
    docs.length > pageSize && last
      ? encodePageCursor(
          (last.data() as { createdAt?: unknown }).createdAt,
          last.id,
        )
      : null;
  return { pageDocs, nextCursor };
}
