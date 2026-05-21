import "server-only";

/**
 * JSON-roundtrip a Firestore document so it can cross the Server→Client
 * Component boundary. Without this, Admin SDK `Timestamp` instances (and
 * other class instances) are rejected by React with
 * "Only plain objects... can be passed to Client Components".
 *
 * After serialization, Timestamps become `{ _seconds, _nanoseconds }`,
 * which `toDate()` in `@/lib/utils` already handles.
 */
export function plainify<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}
