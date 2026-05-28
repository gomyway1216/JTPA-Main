import { toDate } from "@/lib/utils";
import type { TsLike } from "@/lib/types";

// How early before `startAt` a check-in QR is accepted. Lets early arrivals
// scan during setup without the door always erroring out.
export const CHECKIN_EARLY_MS = 4 * 60 * 60 * 1000; // 4 hours

// How late after `endAt` a check-in QR is still accepted. Buffers the case
// where the receptionist forgot to flag someone, or the event ran long.
export const CHECKIN_LATE_MS = 6 * 60 * 60 * 1000; // 6 hours

export type CheckInWindowReason =
  | "ok"
  | "too_early"
  | "too_late"
  | "missing_dates";

export function checkInWindowState(
  event: { startAt: TsLike; endAt: TsLike },
  now: Date = new Date(),
): CheckInWindowReason {
  const start = toDate(event.startAt);
  const end = toDate(event.endAt);
  if (!start || !end) return "missing_dates";
  const t = now.getTime();
  if (t < start.getTime() - CHECKIN_EARLY_MS) return "too_early";
  if (t > end.getTime() + CHECKIN_LATE_MS) return "too_late";
  return "ok";
}

// Length picks a balance: short enough to fit in a low-density QR code,
// long enough that brute-forcing the URL is infeasible in the day window.
// ~96 bits of entropy.
const TOKEN_LEN = 16;
const TOKEN_ALPHABET =
  "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCheckInTokenString(): string {
  // Node has Web Crypto on globalThis since v19; the Admin SDK runs on
  // Node 20+ in this project, so this is safe.
  const bytes = new Uint8Array(TOKEN_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < TOKEN_LEN; i++) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return out;
}
