"use server";

import { createHash } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireAdmin } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import { inputError } from "@/lib/i18n/action-errors";

const EmailSchema = z.string().trim().toLowerCase().email().max(320);
const LocaleSchema = z.enum(["ja", "en"]);

const SubscribeSchema = z.object({
  email: EmailSchema,
  locale: LocaleSchema,
  consent: z.literal(true),
  // Hidden honeypot. Real visitors never fill this field; bots commonly do.
  website: z.string().max(0),
});

const AdminAddSchema = z.object({
  email: EmailSchema,
  locale: LocaleSchema,
});

const RemoveSchema = z.object({
  subscriberId: z.string().regex(/^[a-f0-9]{64}$/),
});

export type SubscribeMailingListInput = {
  email: string;
  locale: "ja" | "en";
  consent: boolean;
  website: string;
};
export type AddMailingListSubscriberInput = z.input<typeof AdminAddSchema>;
export type MailingListActionResult =
  | { ok: true }
  | { ok: false; error: string };

function subscriberId(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

function revalidateMailingListAdmin(): void {
  revalidatePath("/ja/admin/mailing-list");
  revalidatePath("/en/admin/mailing-list");
}

async function validationError(error: z.ZodError): Promise<MailingListActionResult> {
  return { ok: false, error: await inputError(error.issues) };
}

async function upsertSubscriber(
  email: string,
  locale: "ja" | "en",
  source: "public" | "admin",
): Promise<void> {
  const now = Timestamp.now();
  await adminDb()
    .collection("mailingListSubscribers")
    .doc(subscriberId(email))
    .set(
      {
        email,
        locale,
        source,
        consentVersion: 1,
        subscribedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
}

export async function subscribeToMailingList(
  input: SubscribeMailingListInput,
): Promise<MailingListActionResult> {
  const parsed = SubscribeSchema.safeParse(input);
  if (!parsed.success) {
    // Silently accept honeypot submissions so bots cannot tune around it.
    if (typeof input.website === "string" && input.website.length > 0) {
      return { ok: true };
    }
    return validationError(parsed.error);
  }

  await upsertSubscriber(parsed.data.email, parsed.data.locale, "public");
  revalidateMailingListAdmin();
  return { ok: true };
}

export async function addMailingListSubscriber(
  input: AddMailingListSubscriberInput,
): Promise<MailingListActionResult> {
  await requireAdmin();
  const parsed = AdminAddSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  await upsertSubscriber(parsed.data.email, parsed.data.locale, "admin");
  revalidateMailingListAdmin();
  return { ok: true };
}

export async function removeMailingListSubscriber(input: {
  subscriberId: string;
}): Promise<MailingListActionResult> {
  await requireAdmin();
  const parsed = RemoveSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  await adminDb()
    .collection("mailingListSubscribers")
    .doc(parsed.data.subscriberId)
    .delete();
  revalidateMailingListAdmin();
  return { ok: true };
}
