import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import { toDate } from "@/lib/utils";
import type { CommentParentType, TsLike } from "@/lib/types";

export type ReceivedRecordLike = {
  kind: "record";
  parentType: CommentParentType;
  parentId: string;
  title: string;
  slug: string;
  status: string | null;
  likeCount: number;
  createdAt?: TsLike;
  updatedAt?: TsLike;
};

type RecordLikeQuery = {
  collection: string;
  parentType: CommentParentType;
  ownerField: "authorUid" | "ownerUid";
};

const RECORD_LIKE_QUERIES: readonly RecordLikeQuery[] = [
  { collection: "posts", parentType: "post", ownerField: "authorUid" },
  { collection: "guides", parentType: "guide", ownerField: "authorUid" },
  { collection: "qa", parentType: "qa", ownerField: "authorUid" },
  { collection: "projects", parentType: "project", ownerField: "ownerUid" },
  { collection: "polls", parentType: "poll", ownerField: "authorUid" },
];

type SnapLike = {
  id: string;
  data(): unknown;
};

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function tsField(data: Record<string, unknown>, key: string): TsLike | undefined {
  const value = data[key];
  return value === undefined ? undefined : (value as TsLike);
}

function statusField(data: Record<string, unknown>): string | null {
  const value = data.status;
  return typeof value === "string" ? value : null;
}

function likedRecordFromSnap(
  doc: SnapLike,
  parentType: CommentParentType,
): ReceivedRecordLike | null {
  const data = doc.data() as Record<string, unknown>;
  const title = stringField(data, "title");
  const slug = stringField(data, "slug");
  const likeCount =
    typeof data.likeCount === "number" ? Math.max(0, data.likeCount) : 0;
  if (!title || !slug || likeCount === 0) return null;

  return plainify({
    kind: "record" as const,
    parentType,
    parentId: doc.id,
    title,
    slug,
    status: statusField(data),
    likeCount,
    createdAt: tsField(data, "createdAt"),
    updatedAt: tsField(data, "updatedAt"),
  });
}

function itemTime(item: ReceivedRecordLike): number {
  return toDate(item.updatedAt ?? item.createdAt)?.getTime() ?? 0;
}

function compareRecordLikes(a: ReceivedRecordLike, b: ReceivedRecordLike) {
  return b.likeCount - a.likeCount || itemTime(b) - itemTime(a);
}

async function listLikedRecordsForQuery(
  config: RecordLikeQuery,
  authorUid: string,
  limit: number,
): Promise<ReceivedRecordLike[]> {
  const snap = await adminDb()
    .collection(config.collection)
    .where(config.ownerField, "==", authorUid)
    .where("likeCount", ">", 0)
    .orderBy("likeCount", "desc")
    .limit(limit)
    .get();

  return snap.docs
    .map((doc) => likedRecordFromSnap(doc, config.parentType))
    .filter((item): item is ReceivedRecordLike => item !== null);
}

export async function listLikedRecordsByAuthor(
  authorUid: string,
  limitPerType = 50,
): Promise<ReceivedRecordLike[]> {
  const groups = await Promise.all(
    RECORD_LIKE_QUERIES.map((config) =>
      listLikedRecordsForQuery(config, authorUid, limitPerType).catch((err) => {
        console.error(
          `Failed to list liked records for ${config.collection}:`,
          err,
        );
        return [];
      }),
    ),
  );
  return groups.flat().sort(compareRecordLikes);
}
