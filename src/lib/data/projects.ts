import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { ProjectDoc, ProjectStatus } from "@/lib/types";

function fromSnap(doc: FirebaseFirestore.QueryDocumentSnapshot): ProjectDoc {
  const data = doc.data() as Omit<ProjectDoc, "id">;
  return plainify({ ...data, id: doc.id });
}

export async function listProjects(opts: {
  status?: ProjectStatus;
  limit?: number;
} = {}): Promise<ProjectDoc[]> {
  const { status = "approved", limit = 50 } = opts;
  const snap = await adminDb()
    .collection("projects")
    .where("status", "==", status)
    .orderBy("submittedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(fromSnap);
}

export async function listMyProjects(uid: string): Promise<ProjectDoc[]> {
  const snap = await adminDb()
    .collection("projects")
    .where("ownerUid", "==", uid)
    .orderBy("updatedAt", "desc")
    .get();
  return snap.docs.map(fromSnap);
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
  return fromSnap(snap.docs[0]);
}

export async function getProjectById(id: string): Promise<ProjectDoc | null> {
  const snap = await adminDb().collection("projects").doc(id).get();
  if (!snap.exists) return null;
  return plainify({
    ...(snap.data() as Omit<ProjectDoc, "id">),
    id: snap.id,
  });
}
