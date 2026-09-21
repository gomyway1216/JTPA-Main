#!/usr/bin/env node
// One-off, reviewed editorial update. Dry-run by default; never changes authors,
// publication dates, images, event associations, or any unrelated post fields.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { FieldValue, getFirestore } from "firebase-admin/firestore";

import { initAdmin } from "./_lib/firebase-init.mjs";

function contentFields(content) {
  return [content?.title ?? null, content?.excerpt ?? null, content?.body ?? null];
}

export function reportContentHash(post) {
  return createHash("sha256")
    .update(JSON.stringify([
      contentFields(post),
      contentFields(post.localized?.ja),
      contentFields(post.localized?.en),
    ]))
    .digest("hex");
}

export function reportUpdate(post, edit) {
  if (post.slug !== edit.slug || post.status !== "published") {
    throw new Error(`Not the expected published report: ${edit.slug}`);
  }
  const current = [contentFields(post), contentFields(post.localized?.ja), contentFields(post.localized?.en)];
  const desired = [contentFields(edit.ja), contentFields(edit.ja), contentFields(edit.en)];
  if (JSON.stringify(current) === JSON.stringify(desired) &&
      post.locales?.includes("ja") && post.locales?.includes("en")) return null;
  if (reportContentHash(post) !== edit.expectedHash) {
    throw new Error(`Report changed since editorial review; refusing to overwrite: ${edit.slug}`);
  }
  return {
    title: edit.ja.title,
    excerpt: edit.ja.excerpt,
    body: edit.ja.body,
    "localized.ja": edit.ja,
    "localized.en": edit.en,
    locales: [...new Set([...(post.locales ?? []), "ja", "en"])],
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--apply", "--dry-run"].includes(arg)) || args.length > 1) {
    throw new Error("Usage: node scripts/update-event-report-seo.mjs [--dry-run|--apply]");
  }
  const projectId = initAdmin();
  if (projectId !== "jtpa-main") throw new Error("This editorial update is only for jtpa-main.");
  const apply = args.includes("--apply");
  const edits = JSON.parse(await readFile(new URL("./content/event-report-seo.json", import.meta.url), "utf8"));
  const db = getFirestore();
  const refs = await Promise.all(edits.map(async (edit) => {
    const found = await db.collection("posts").where("slug", "==", edit.slug).get();
    if (found.size !== 1) throw new Error(`Expected one report for ${edit.slug}, found ${found.size}`);
    return found.docs[0].ref;
  }));
  const results = await db.runTransaction(async (tx) => {
    const snapshots = await tx.getAll(...refs);
    // Validate every report before staging writes. The transaction also protects
    // an editor's concurrent changes between validation and commit.
    const updates = snapshots.map((snapshot, index) => reportUpdate(snapshot.data(), edits[index]));
    return updates.map((update, index) => {
      if (apply && update) tx.update(refs[index], { ...update, updatedAt: FieldValue.serverTimestamp() });
      return { slug: edits[index].slug, result: update ? (apply ? "updated" : "would update") : "already current" };
    });
  });
  console.log(JSON.stringify({ projectId, mode: apply ? "apply" : "dry-run", results }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
