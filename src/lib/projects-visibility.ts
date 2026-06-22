import type { ProjectDoc, SessionUser } from "@/lib/types";

export function canViewProjectDetail(
  project: Pick<ProjectDoc, "ownerUid" | "status" | "locales">,
  user: Pick<SessionUser, "uid" | "isAdmin"> | null,
  locale?: string,
): boolean {
  void locale;
  if (user && (user.isAdmin || user.uid === project.ownerUid)) return true;
  return project.status === "approved";
}
