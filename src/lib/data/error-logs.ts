import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

// Cap the free-text fields so a pathological error (huge message / deep
// stack) can't bloat the doc toward Firestore's 1 MB limit.
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

// Next routes its own control-flow signals — redirect(), notFound(), and
// HTTP-error fallbacks — through onRequestError as thrown "errors". They
// aren't failures, so we must not log them (otherwise every redirect/404
// spams the table). They carry a `NEXT_`-prefixed digest.
export function isControlFlowDigest(digest: string | undefined | null): boolean {
  if (!digest) return false;
  return (
    digest.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || // notFound() / forbidden() / unauthorized()
    digest === "NEXT_NOT_FOUND"
  );
}

type RequestInfo = { path?: string; method?: string };
type ContextInfo = {
  routePath?: string;
  routeType?: string;
  renderSource?: string;
};

// Persist a server error to the `errorLogs` collection. Best-effort: this
// runs inside Next's onRequestError hook, so it must NEVER throw — a failed
// write would mask the original error. The `digest` stored as `requestId`
// is exactly what the user sees on the error page, so a reported id can be
// looked up here. `error` is typed `unknown` because Next's hook makes no
// guarantee it's a real Error (it may be reshaped during RSC rendering).
export async function recordServerError(
  error: unknown,
  // `request`/`context` are nullable: Next doesn't guarantee them in every
  // path that reaches onRequestError (build-time generation, init-time
  // failures), and a nullish access here would throw inside the try and
  // drop the log entirely. Per PR #113 Gemini review.
  request?: RequestInfo | null,
  context?: ContextInfo | null,
): Promise<void> {
  const e = (typeof error === "object" && error !== null ? error : {}) as {
    digest?: unknown;
    name?: unknown;
    message?: unknown;
    stack?: unknown;
  };
  const digest = typeof e.digest === "string" ? e.digest : undefined;
  if (isControlFlowDigest(digest)) return;
  const message =
    typeof e.message === "string" ? e.message : String(error ?? "");
  try {
    await adminDb()
      .collection("errorLogs")
      .add({
        requestId: digest ?? null,
        name: typeof e.name === "string" ? e.name : "Error",
        message: message.slice(0, MAX_MESSAGE),
        stack: typeof e.stack === "string" ? e.stack.slice(0, MAX_STACK) : "",
        path: request?.path ?? "",
        method: request?.method ?? "",
        routePath: context?.routePath ?? "",
        routeType: context?.routeType ?? "",
        renderSource: context?.renderSource ?? null,
        runtime: process.env.NEXT_RUNTIME ?? "nodejs",
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (logErr) {
    // Swallow — the error hook is the worst place to throw.
    console.error("Failed to persist error log:", logErr);
  }
}
