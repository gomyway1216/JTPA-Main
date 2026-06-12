import type { ProjectDoc, SessionUser } from "@/lib/types";

export function canViewProjectDetail(
  project: Pick<ProjectDoc, "ownerUid" | "status">,
  user: Pick<SessionUser, "uid" | "isAdmin"> | null,
): boolean {
  if (project.status === "approved") return true;
  return !!user && (user.isAdmin || user.uid === project.ownerUid);
}
