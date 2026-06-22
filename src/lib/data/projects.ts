import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { isContentLocale } from "@/lib/content-localization";
import { fromSnap, type SnapLike } from "@/lib/data/from-snap";
import { ProjectDocSchema } from "@/lib/data/schemas";
import { plainify } from "@/lib/data/serialize";
import type { ProjectDoc, ProjectStatus } from "@/lib/types";

function toDoc(doc: SnapLike): ProjectDoc {
  const data = fromSnap<Omit<ProjectDoc, "id">>(
    doc,
    ProjectDocSchema,
    "projects",
  );
  return plainify({ ...data, id: doc.id });
}

export async function listProjects(opts: {
  status?: ProjectStatus;
  limit?: number;
  locale?: string;
} = {}): Promise<ProjectDoc[]> {
  const { status = "approved", limit = 50, locale } = opts;
  let query = adminDb()
    .collection("projects")
    .where("status", "==", status);
  if (isContentLocale(locale)) {
    query = query.where("locales", "array-contains", locale);
  }
  const snap = await query
    .orderBy("submittedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(toDoc);
}

export async function listMyProjects(uid: string): Promise<ProjectDoc[]> {
  const snap = await adminDb()
    .collection("projects")
    .where("ownerUid", "==", uid)
    .orderBy("updatedAt", "desc")
    .get();
  return snap.docs.map(toDoc);
}

export async function getProjectBySlug(
  slug: string,
): Promise<ProjectDoc | null> {
  const snap = await adminDb()
    .collection("projects")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return toDoc(snap.docs[0]);
}

export async function getProjectById(id: string): Promise<ProjectDoc | null> {
  const snap = await adminDb().collection("projects").doc(id).get();
  if (!snap.exists) return null;
  return toDoc(snap);
}
