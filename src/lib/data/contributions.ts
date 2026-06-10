import "server-only";

import { adminDb } from "@/lib/firebase/admin";

// Per-content-type tallies of a user's PUBLICLY-visible contributions,
// rendered on /u/[uid] next to the event-attendance stat. Only content
// that is actually live to logged-out readers is counted — drafts,
// pending submissions, archived, and rejected items are NOT public and
// so are excluded (matching the visibility rules each listing query
// already enforces). `total` is the sum of the five type counts.
export interface ContributionCounts {
  posts: number;
  projects: number;
  qa: number;
  polls: number;
  guides: number;
  total: number;
}

// The five public-content collections and the (collection, authorField,
// publicStatus) tuple that defines "a published contribution by this
// user" for each. Kept as data so the count loop stays a single mapped
// `Promise.all` rather than five copy-pasted query blocks.
//
// NOTE the two per-collection quirks, verified against the type defs and
// the existing `listMy*` queries in this directory (NOT assumed uniform):
//   - `projects` keys authorship on `ownerUid`, every other collection
//     on `authorUid` (see ProjectDoc / `listMyProjects`).
//   - the polls collection id is `polls` (plural), matching `listPoll`.
// The public-visibility status is `approved` for projects (the showcase
// review queue) and `published` for the other four.
const CONTRIBUTION_SOURCES = [
  { key: "posts", collection: "posts", authorField: "authorUid", status: "published" },
  { key: "projects", collection: "projects", authorField: "ownerUid", status: "approved" },
  { key: "qa", collection: "qa", authorField: "authorUid", status: "published" },
  { key: "polls", collection: "polls", authorField: "authorUid", status: "published" },
  { key: "guides", collection: "guides", authorField: "authorUid", status: "published" },
] as const;

// Count one collection's published docs for a single author via a
// Firestore `count()` aggregation — same inexpensive read-time pattern as
// `countNewFeedback` (we never pull the docs themselves just to size the
// set). The two equality filters (`authorField ==`, `status ==`) are
// served by Firestore's single-field indexes (zigzag merge); no composite
// index is required. Any failure (aggregation unsupported on an old
// emulator, transient Firestore error) degrades to 0 so one bad query
// can't blank the whole profile — the page already renders 0 for a
// missing attendance count, and we keep that same defensive posture.
async function countPublishedFor(
  source: (typeof CONTRIBUTION_SOURCES)[number],
  uid: string,
): Promise<number> {
  try {
    const snap = await adminDb()
      .collection(source.collection)
      .where(source.authorField, "==", uid)
      .where("status", "==", source.status)
      .count()
      .get();
    return snap.data().count;
  } catch (err) {
    console.warn(
      `count() aggregation failed for ${source.collection}, treating as 0:`,
      err,
    );
    return 0;
  }
}

// Compute a user's published contribution counts at read time. Runs the
// five per-collection aggregations in parallel; each is independently
// guarded so a single failing collection yields 0 for that type rather
// than rejecting the whole call. Server-only: imported by the /u/[uid]
// server component.
export async function getPublicContributionCounts(
  uid: string,
): Promise<ContributionCounts> {
  const [posts, projects, qa, polls, guides] = await Promise.all(
    CONTRIBUTION_SOURCES.map((source) => countPublishedFor(source, uid)),
  );
  return {
    posts,
    projects,
    qa,
    polls,
    guides,
    total: posts + projects + qa + polls + guides,
  };
}
