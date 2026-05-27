import { GuideListClient } from "@/app/guide/_components/GuideListClient";
import { listGuides } from "@/lib/data/guides";

export const dynamic = "force-dynamic";
export const metadata = { title: "ガイド" };

export default async function GuideIndexPage() {
  // Intentionally not catching — see the admin list rationale: a missing
  // composite index here surfaces a fix-this link in the error, swallowing
  // it would hide the easiest debug signal.
  const guides = await listGuides({
    statuses: ["published"],
    limit: 200,
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">ガイド</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          AI ツールのセットアップから使いこなしまで、JTPA がまとめた手引き集です。
        </p>
      </header>
      <GuideListClient guides={guides} />
    </div>
  );
}
