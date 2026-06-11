import "server-only";

import * as z from "zod";

// Minimal structural slice of a Firestore snapshot — just what the
// validator touches. Both Admin SDK classes (`QueryDocumentSnapshot` from
// queries, `DocumentSnapshot` from direct `.doc(id).get()` reads) satisfy
// it, and so do the hand-rolled snapshot stubs in __tests__/lib/data
// (which don't build a `ref`, hence it's optional with an `id` fallback).
export interface SnapLike {
  id: string;
  ref?: { path: string };
  data(): unknown;
}

/**
 * Warn-only validation at the Firestore read boundary.
 *
 * Replaces the blind `snap.data() as T` casts in src/lib/data: the doc body
 * is checked against a lenient Zod schema (see src/lib/data/schemas.ts) so
 * schema drift / malformed docs surface in the server logs instead of as
 * confusing downstream rendering errors.
 *
 * Contract: this must NEVER change behavior or throw.
 *   - valid doc   → the parsed data (identical shape; loose objects keep
 *                   unknown keys, so nothing is stripped)
 *   - invalid doc → ONE structured console.error, then the raw data exactly
 *                   as the old cast would have returned it
 */
export function fromSnap<T>(
  snap: SnapLike,
  schema: z.ZodType,
  label: string,
): T {
  const data = snap.data();
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error("[from-snap] Firestore doc failed validation (warn-only):", {
      label,
      doc: snap.ref?.path ?? snap.id,
      issues: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    });
    return data as T;
  }
  return result.data as T;
}
