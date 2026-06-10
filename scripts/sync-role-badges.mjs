#!/usr/bin/env node
/**
 * Backfill the denormalized `roleBadge` field on every users/{uid} doc
 * to match the current Firebase Auth custom claim.
 *
 * Normally `signInWithIdToken` self-heals this on every login — so an
 * admin who signs out and back in once gets their badge written
 * automatically. This script is the one-shot backfill for the moment
 * the PR introducing `roleBadge` deploys: existing accounts with a
 * live session cookie that pre-dates the deploy haven't re-bootstrapped
 * yet, so their public AuthorBadge surface renders without a role
 * pill until they re-login. Running this once fixes everyone at once.
 *
 * Safe to re-run: idempotent. Reads the current claim, computes the
 * highest badge (admin > editor > contributor), and either writes that
 * value to the user doc or deletes the `roleBadge` field if the user
 * has no managed claims. A user with no profile doc yet is skipped
 * (the doc will get bootstrapped the next time they sign in).
 *
 * Usage:
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID=jtpa-main \
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     node scripts/sync-role-badges.mjs           # apply changes
 *
 *   ... node scripts/sync-role-badges.mjs --dry-run   # print only
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account
 * JSON for the Firebase project, OR the FIREBASE_SERVICE_ACCOUNT env
 * var containing the JSON inline. Same as the other one-off scripts.
 */

import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import { initAdmin } from "./_lib/firebase-init.mjs";

// Reject anything that isn't exactly --dry-run: a typo'd flag (--dryrun,
// --dry_run, ...) must not silently fall through to a real production-wide
// mutation.
const args = process.argv.slice(2);
const unknownArgs = args.filter((a) => a !== "--dry-run");
if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
  console.error("Usage: node scripts/sync-role-badges.mjs [--dry-run]");
  process.exit(1);
}
const dryRun = args.includes("--dry-run");

initAdmin();
const auth = getAuth();
const db = getFirestore();

// Map a user's claim object to the badge we'd write — same hierarchy
// the runtime uses (`signInWithIdToken` + `setUserRole`). Returns null
// for a plain user with no managed claims.
function badgeFor(claims) {
  if (claims?.admin === true) return "admin";
  if (claims?.editor === true) return "editor";
  if (claims?.contributor === true) return "contributor";
  return null;
}

async function main() {
  let pageToken;
  let scanned = 0;
  let written = 0;
  let cleared = 0;
  let skippedNoDoc = 0;
  let skippedSame = 0;

  do {
    // Walk Auth users in pages of 1000 (the SDK cap). Per page we do:
    //   - 1 Auth listUsers call (network: 1)
    //   - 1 Firestore `getAll` covering every user doc in the page
    //     (network: 1, regardless of page size)
    //   - 1 Firestore `bulkWriter` queue covering every needed update
    //     (network: handled internally, throttled + batched)
    // i.e. ~3 RPCs per 1000 users instead of the 2001 the original
    // sequential loop incurred. Per PR #92 + #93 Gemini + Copilot
    // review: the loop comment used to claim "batched across the
    // page" but the read AND the write were both sequential.
    const page = await auth.listUsers(1000, pageToken);
    if (page.users.length === 0) {
      pageToken = page.pageToken;
      continue;
    }

    const refs = page.users.map((u) => db.collection("users").doc(u.uid));
    const snaps = await db.getAll(...refs);
    // `getAll` returns snaps in the same order as the refs; build a
    // uid → snap map so the per-user pairing stays correct even if
    // we ever reorder things in the future.
    const snapByUid = new Map(snaps.map((s) => [s.id, s]));

    // `bulkWriter` queues every write and flushes them in throttled
    // batches under the hood (default ~500/s with built-in retries on
    // contention). We `await writer.close()` after the page so we
    // never start the next page until this one's writes are durable.
    const writer = dryRun ? null : db.bulkWriter();

    for (const u of page.users) {
      scanned++;
      const claims = u.customClaims ?? {};
      const desired = badgeFor(claims);

      const snap = snapByUid.get(u.uid);
      if (!snap || !snap.exists) {
        // User has never signed in via the app, so no profile doc to
        // mirror onto. The bootstrap will create one on first sign-in.
        skippedNoDoc++;
        continue;
      }

      const existing = snap.get("roleBadge") ?? null;
      if (existing === desired) {
        skippedSame++;
        continue;
      }

      const label = `${u.email ?? u.uid}: ${existing ?? "(none)"} → ${desired ?? "(none)"}`;
      if (dryRun) {
        console.log(`would update — ${label}`);
        continue;
      }

      if (desired === null) {
        writer.update(snap.ref, { roleBadge: FieldValue.delete() });
        cleared++;
      } else {
        writer.update(snap.ref, { roleBadge: desired });
        written++;
      }
      console.log(`updated — ${label}`);
    }

    if (writer) await writer.close();
    pageToken = page.pageToken;
  } while (pageToken);

  console.log(
    `\n${dryRun ? "[dry-run] " : ""}Scanned ${scanned} Auth users. ` +
      `Wrote ${written}, cleared ${cleared}, ` +
      `skipped (no profile doc) ${skippedNoDoc}, ` +
      `skipped (already up-to-date) ${skippedSame}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
