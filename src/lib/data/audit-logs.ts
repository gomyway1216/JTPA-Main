import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { plainify } from "@/lib/data/serialize";
import { adminDb } from "@/lib/firebase/admin";
import type { AuditLogDoc, SessionUser } from "@/lib/types";

type AuditTarget = {
  type: AuditLogDoc["targetType"];
  id: string;
  slug?: string | null;
  title?: string | null;
  status?: AuditLogDoc["targetStatus"];
  ownerUid?: string | null;
  ownerName?: string | null;
};

type RecordAuditLogInput = {
  action: AuditLogDoc["action"];
  result: AuditLogDoc["result"];
  actor: SessionUser;
  target: AuditTarget;
  metadata?: AuditLogDoc["metadata"];
};

export function buildAuditLogData({
  action,
  result,
  actor,
  target,
  metadata,
}: RecordAuditLogInput) {
  return {
    action,
    result,
    actorUid: actor.uid,
    actorName: actor.displayName ?? null,
    actorEmail: actor.email ?? null,
    actorIsAdmin: actor.isAdmin,
    targetType: target.type,
    targetId: target.id,
    targetSlug: target.slug ?? null,
    targetTitle: target.title ?? null,
    targetStatus: target.status ?? null,
    targetOwnerUid: target.ownerUid ?? null,
    targetOwnerName: target.ownerName ?? null,
    metadata: metadata ?? {},
    createdAt: FieldValue.serverTimestamp(),
  };
}

export async function recordAuditLog(
  input: RecordAuditLogInput,
): Promise<void> {
  try {
    await adminDb().collection("auditLogs").add(buildAuditLogData(input));
  } catch (err) {
    // Audit logging must not change the result of the user action. Server
    // errors still flow through instrumentation/errorLogs.
    console.error("Failed to persist audit log:", err);
  }
}

export async function listAuditLogs(max = 100): Promise<AuditLogDoc[]> {
  const snap = await adminDb()
    .collection("auditLogs")
    .orderBy("createdAt", "desc")
    .limit(max)
    .get();
  return snap.docs.map((doc) =>
    plainify({ ...(doc.data() as Omit<AuditLogDoc, "id">), id: doc.id }),
  );
}
