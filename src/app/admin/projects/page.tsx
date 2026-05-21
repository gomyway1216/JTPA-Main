import { ProjectReviewCard } from "@/app/admin/projects/_components/ProjectReviewCard";
import { listProjects } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

export default async function AdminProjectsPage() {
  const [pending, approved, rejected] = await Promise.all([
    listProjects({ status: "pending", limit: 50 }).catch(() => []),
    listProjects({ status: "approved", limit: 50 }).catch(() => []),
    listProjects({ status: "rejected", limit: 20 }).catch(() => []),
  ]);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold">
          承認待ち ({pending.length})
        </h1>
        <div className="mt-4 space-y-3">
          {pending.length === 0 ? (
            <p className="text-sm text-zinc-500">承認待ちはありません。</p>
          ) : (
            pending.map((p) => <ProjectReviewCard key={p.id} project={p} />)
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">公開中 ({approved.length})</h2>
        <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {approved.map((p) => (
            <li key={p.id} className="py-2 text-sm flex justify-between gap-3">
              <span>{p.title}</span>
              <span className="text-zinc-500">{p.ownerName}</span>
            </li>
          ))}
        </ul>
      </section>

      {rejected.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">却下済み ({rejected.length})</h2>
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {rejected.map((p) => (
              <li key={p.id} className="py-2 text-sm flex justify-between gap-3">
                <span>{p.title}</span>
                <span className="text-zinc-500">{p.ownerName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
