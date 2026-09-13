import "server-only";

import { fromSnap } from "@/lib/data/from-snap";
import { MailingListSubscriberSchema } from "@/lib/data/schemas";
import { plainify } from "@/lib/data/serialize";
import { adminDb } from "@/lib/firebase/admin";
import type { MailingListSubscriber } from "@/lib/types";

export async function listMailingListSubscribers(
  limit = 5000,
): Promise<MailingListSubscriber[]> {
  const snap = await adminDb()
    .collection("mailingListSubscribers")
    .orderBy("subscribedAt", "desc")
    .limit(limit)
    .get();

  return snap.docs.map((doc) =>
    plainify({
      ...fromSnap<Omit<MailingListSubscriber, "id">>(
        doc,
        MailingListSubscriberSchema,
        "mailingListSubscribers",
      ),
      id: doc.id,
    }),
  );
}
