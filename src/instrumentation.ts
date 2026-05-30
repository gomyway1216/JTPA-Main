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
  const { recordServerError } = await import("@/lib/data/error-logs");
  await recordServerError(error, request, context);
};
