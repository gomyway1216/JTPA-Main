import "server-only";

import { unstable_cache } from "next/cache";
import { adminDb } from "@/lib/firebase/admin";
import { EVENTS_TAG, GUIDES_TAG, POSTS_TAG, PROJECTS_TAG } from "@/lib/data/cache-tags";
import { fromSnap } from "@/lib/data/from-snap";
import { EventDocSchema, GuideDocSchema, PostDocSchema, ProjectDocSchema } from "@/lib/data/schemas";
import { buildSearchDocuments } from "@/lib/site-search";
import type { EventDoc, GuideDoc, PostDoc, ProjectDoc } from "@/lib/types";

// The small public corpus stays on the server. Unlike listing pages, search
// must include older items too, so these queries have no listing-page limit.
// Status-only queries use Firestore's existing single-field indexes.
async function loadSearchDocuments(locale: string) {
  const db = adminDb();
  const [posts, guides, projects, events] = await Promise.all([
    db.collection("posts").where("status", "==", "published").get(),
    db.collection("guides").where("status", "==", "published").get(),
    db.collection("projects").where("status", "==", "approved").get(),
    db.collection("events").where("status", "in", ["published", "past"]).get(),
  ]);
  return buildSearchDocuments({
    posts: posts.docs.map((s) => fromSnap<PostDoc>(s, PostDocSchema, "posts")),
    guides: guides.docs.map((s) => fromSnap<GuideDoc>(s, GuideDocSchema, "guides")),
    projects: projects.docs.map((s) => fromSnap<ProjectDoc>(s, ProjectDocSchema, "projects")),
    events: events.docs.map((s) => fromSnap<EventDoc>(s, EventDocSchema, "events")),
  }, locale);
}

// Follow the existing cache model: publishing/editing invalidates these tags,
// and the TTL refreshes other Cloud Run instances. Do not cache each query.
export const getSearchDocuments = unstable_cache(loadSearchDocuments, ["site-search-v1"], {
  tags: [POSTS_TAG, GUIDES_TAG, PROJECTS_TAG, EVENTS_TAG],
  revalidate: 60,
});
