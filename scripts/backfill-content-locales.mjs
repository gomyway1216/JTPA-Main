#!/usr/bin/env node
/**
 * Backfill `locales: ["ja", "en"]` onto legacy posts/projects so public
 * locale-filtered list queries can use Firestore's native `array-contains`
 * filter without losing pre-existing content.
 *
 * Safe to re-run: docs that already have at least one supported locale keep
 * that selection, with invalid/duplicate entries normalized away. Missing,
 * empty, or fully-invalid arrays are written as both locales to preserve the
 * pre-localization "visible everywhere" behavior.
 *
 * Usage:
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID=jtpa-main \
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *     node scripts/backfill-content-locales.mjs           # apply changes
 *
 *   ... node scripts/backfill-content-locales.mjs --dry-run   # print only
 */

import { getFirestore } from "firebase-admin/firestore";

import { initAdmin } from "./_lib/firebase-init.mjs";

const CONTENT_LOCALES = ["ja", "en"];
const DEFAULT_BACKFILL_LOCALES = [...CONTENT_LOCALES];

const args = process.argv.slice(2);
const unknownArgs = args.filter((a) => a !== "--dry-run");
if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
  console.error("Usage: node scripts/backfill-content-locales.mjs [--dry-run]");
  process.exit(1);
}
const dryRun = args.includes("--dry-run");

initAdmin();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

function normalizeLocales(value) {
  if (!Array.isArray(value)) return [];
  const next = [];
  for (const locale of value) {
    if (!CONTENT_LOCALES.includes(locale) || next.includes(locale)) continue;
    next.push(locale);
  }
  return next;
}

function sameLocales(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

async function backfillCollection(collectionName) {
  const writer = dryRun ? null : db.bulkWriter();
  const snap = await db.collection(collectionName).get();
  let scanned = 0;
  let changed = 0;
  let unchanged = 0;

  for (const doc of snap.docs) {
    scanned++;
    const current = doc.get("locales");
    const normalized = normalizeLocales(current);
    const next =
      normalized.length > 0 ? normalized : DEFAULT_BACKFILL_LOCALES;

    if (Array.isArray(current) && sameLocales(current, next)) {
      unchanged++;
      continue;
    }

    changed++;
    const label = `${collectionName}/${doc.id}: ${JSON.stringify(
      current ?? null,
    )} -> ${JSON.stringify(next)}`;
    if (dryRun) {
      console.log(`would update ${label}`);
    } else {
      writer.update(doc.ref, { locales: next });
      console.log(`queued ${label}`);
    }
  }

  if (writer) await writer.close();
  console.log(
    `${collectionName}: scanned ${scanned}, ` +
      `${dryRun ? "would update" : "updated"} ${changed}, ` +
      `unchanged ${unchanged}.`,
  );
  return { scanned, changed, unchanged };
}

const totals = { scanned: 0, changed: 0, unchanged: 0 };
for (const collectionName of ["posts", "projects"]) {
  const result = await backfillCollection(collectionName);
  totals.scanned += result.scanned;
  totals.changed += result.changed;
  totals.unchanged += result.unchanged;
}

console.log(
  `\n${dryRun ? "[dry-run] " : ""}Done. Scanned ${totals.scanned}. ` +
    `${dryRun ? "Would update" : "Updated"} ${totals.changed}. ` +
    `Unchanged ${totals.unchanged}.`,
);
