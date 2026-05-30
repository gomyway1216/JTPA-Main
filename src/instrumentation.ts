import type { Instrumentation } from "next";

// Track server errors to the `errorLogs` Firestore collection so they're
// queryable after the fact, and correlate each with the `digest` Next shows
// the user as the request id (see error.tsx / global-error.tsx).
//
// The writer uses the Admin SDK (Node-only), so we no-op on the Edge
// runtime and lazy-import it — keeping firebase-admin out of any Edge
// bundle and off the cold-start path until an error actually fires.
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // The hook must be strictly best-effort: a failure here (e.g. the dynamic
  // import not resolving) must never bubble out and disturb Next's own
  // error handling. recordServerError already guards its write; this also
  // covers the import + any unexpected throw. Per PR #113 Copilot review.
  try {
    const { recordServerError } = await import("@/lib/data/error-logs");
    await recordServerError(error, request, context);
  } catch (hookErr) {
    console.error("onRequestError logging failed:", hookErr);
  }
};
