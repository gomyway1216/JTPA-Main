import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "管理者ヘルプ" };

export default async function AdminHelpPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/admin/help");
  // Editors can read this page too — most of it concerns roles they touch
  // (guides, About when admins ask them to draft copy) and the rest helps
  // them understand the boundary between editor and admin permissions.

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">管理者ヘルプ</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          JTPAサイトの管理機能の使い方まとめです。技術的な詳細
          (Firestore のコレクション構造、デプロイ手順) は
          リポジトリの{" "}
          <a
            href="https://github.com/gomyway1216/JTPA-Main/tree/main/docs"
            target="_blank"
            rel="noreferrer noopener"
            className="text-blue-600 hover:underline"
          >
            docs/
          </a>{" "}
          を参照してください。
        </p>
      </header>

      <nav className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-2 font-medium">目次</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          <li><a href="#roles" className="text-blue-600 hover:underline">権限 (admin / editor)</a></li>
          <li><a href="#events" className="text-blue-600 hover:underline">イベント運営</a></li>
          <li><a href="#attendees" className="text-blue-600 hover:underline">参加者の確認とCSV出力</a></li>
          <li><a href="#projects" className="text-blue-600 hover:underline">ショーケース承認</a></li>
          <li><a href="#posts" className="text-blue-600 hover:underline">ブログ記事の審査</a></li>
          <li><a href="#guides" className="text-blue-600 hover:underline">ガイド (editor 可)</a></li>
          <li><a href="#about" className="text-blue-600 hover:underline">「JTPAとは」の編集</a></li>
          <li><a href="#users" className="text-blue-600 hover:underline">ユーザーと権限付与</a></li>
          <li><a href="#deploy" className="text-blue-600 hover:underline">デプロイ確認</a></li>
        </ul>
      </nav>

      <Section id="roles" title="権限の仕組み">
        <p>
          ログインユーザーには <code>admin</code> / <code>editor</code> の
          いずれかまたは両方の権限が付与されます。これらは Firebase Auth の
          Custom Claim として保存され、ログインしなおさないと反映されません。
        </p>
        <Table headers={["権限", "できること"]}>
          <Row cells={["admin", "全機能 (イベント・プロジェクト・記事・参加者・ガイド・About・ユーザー権限管理)"]} />
          <Row cells={["editor", "ガイドの作成・編集・公開・削除のみ"]} />
          <Row cells={["(なし)", "一般メンバーと同じ: RSVP・投稿・コメント・いいね"]} />
        </Table>
        <Callout>
          editor は admin の部分集合です。editor が <code>/admin</code> 配下の
          管理画面を直接開いた場合は <code>/admin/guides</code> に
          リダイレクトされます (例外: ガイド管理画面のみ閲覧可)。
        </Callout>
      </Section>

      <Section id="events" title="イベント運営">
        <Step n={1} title="下書き作成">
          <Link href="/admin/events/new" className="text-blue-600 hover:underline">
            /admin/events/new
          </Link>{" "}
          で新規作成、または{" "}
          <Link href="/admin/events" className="text-blue-600 hover:underline">
            /admin/events
          </Link>{" "}
          の既存イベント行から「複製」をクリックすると過去イベントを
          雛形に新しい下書きを作れます (日付は今日+7日、サブコレクションの
          RSVP/発表資料はコピーされません)。
        </Step>
        <Step n={2} title="アンケート項目を設定">
          任意で <code>key + label + 種類 + 対象</code> のペアを追加。
          対象は「全員」または「発表者のみ」を選べます。発表者のみの設問は
          発表者として RSVP したユーザーにだけ表示されます。
        </Step>
        <Step n={3} title="公開設定">
          公開 / メンバー限定を選択。メンバー限定にすると未ログインの訪問者
          からは <code>/events</code> 一覧に表示されなくなります。
        </Step>
        <Step n={4} title="ステータスを「公開」に">
          状態を <code>draft</code> から <code>published</code> に切り替えると
          公開イベント一覧に出ます。
        </Step>
        <Step n={5} title="発表者のアップロード受付">
          発表者が <code>/events/[slug]</code> の発表者セクションから
          スライドや動画リンクを登録します。発表者は1イベントにつき複数件
          登録できます。
        </Step>
        <Step n={6} title="イベント後の整理">
          イベント終了日時を過ぎると自動的に「過去」扱いになります (RSVP
          フォームは非表示、<code>/events</code> の「過去のイベント」へ移動)。
          管理画面の表示も「過去」にしたい場合はステータスを <code>past</code>{" "}
          に変更してください。
        </Step>
      </Section>

      <Section id="attendees" title="参加者の確認とCSV出力">
        <p>
          <Link href="/admin/attendees" className="text-blue-600 hover:underline">
            /admin/attendees?eventId=...
          </Link>{" "}
          (またはイベント選択ドロップダウンから) で、参加者一覧と
          アンケート回答を確認できます。
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>メアドをコピー</strong>: 確定参加者のメールアドレスをカンマ区切りでクリップボードに。Gmail の BCC 欄に貼り付けると個別宛先に展開されます。</li>
          <li><strong>CSV ダウンロード</strong>: UTF-8 BOM 付き CSV。Excel でそのまま開けます。列は <code>displayName, affiliation, email, role, status, presentationTitle, presentationAbstract, survey_&lt;key&gt;...</code></li>
          <li><strong>フィルタ</strong>: デフォルトは「確定参加者のみ」。キャンセル / ウェイトリストも見たいときは「全て」に。</li>
          <li><strong>詳細</strong>: 各行の「詳細」を開くとアンケート回答を確認できます。</li>
        </ul>
        <Callout>
          ~500人を超える一斉メールは Gmail Web の上限に引っかかります。
          JTPA の既存 Google Group (約2000人) を使うか、issue #15 で予定している
          Trigger Email + Cloud Functions の実装を待ってください。
        </Callout>
      </Section>

      <Section id="projects" title="ショーケース承認">
        <Step n={1} title="承認待ち一覧">
          <Link href="/admin/projects" className="text-blue-600 hover:underline">
            /admin/projects
          </Link>{" "}
          に未承認のプロジェクトが上に表示されます。
        </Step>
        <Step n={2} title="内容確認">
          「アプリを開く」リンクで実物を確認。投稿者・タグ・スクリーンショットも見られます。
        </Step>
        <Step n={3} title="承認 または 却下">
          必要なら却下コメントを記入。承認すると即座に{" "}
          <Link href="/showcase" className="text-blue-600 hover:underline">/showcase</Link>{" "}
          に掲載されます。
        </Step>
        <p className="text-sm text-zinc-500">
          投稿者は <code>/my/projects</code> から自分の投稿を編集できます。
          編集すると <code>status</code> が自動的に <code>pending</code> に戻り、
          再審査が必要になります。
        </p>
      </Section>

      <Section id="posts" title="ブログ記事の審査">
        <p>
          <Link href="/admin/posts" className="text-blue-600 hover:underline">/admin/posts</Link>{" "}
          の構成: 審査待ち / 公開中 / 下書き / 却下 の4セクション。
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>カバー画像プレビュー・抜粋・タグが表示されます。</li>
          <li>「プレビュー」で公開と同じ詳細ページを確認、「内容を編集」で誤字脱字を管理者が直接修正可能。</li>
          <li>承認すると即時公開、<code>publishedAt</code> はこのときだけセット (再公開時は維持)。</li>
          <li>却下時のコメントは投稿者に通知されます (Trigger Email 拡張が有効化されたら送信、現状はキューに溜まるだけ)。</li>
        </ul>
      </Section>

      <Section id="guides" title="ガイド (editor 可)">
        <p>
          <Link href="/admin/guides" className="text-blue-600 hover:underline">/admin/guides</Link>{" "}
          で AI ツールの解説などキュレーションされた記事を管理します。
          ここは <strong>editor 権限のユーザーも編集可能</strong>な唯一の管理画面です。
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><code>order</code> フィールドで <code>/guide</code> での表示順を制御 (小さい順)</li>
          <li>下書き状態で保存して後で公開可能</li>
          <li>Markdown は GFM (表・コードブロック・タスクリスト) 対応、コードはシンタックスハイライト</li>
        </ul>
      </Section>

      <Section id="about" title="「JTPAとは」の編集">
        <p>
          <Link href="/admin/about" className="text-blue-600 hover:underline">/admin/about</Link>{" "}
          で <code>/about</code> ページのタイトルと本文 (Markdown) を編集できます。
          まだ保存していないときはコード内のデフォルト文言が表示されます。
        </p>
        <p className="text-sm text-zinc-500">
          見出しは自動的に1段階下げて (H1 → H2 …) 出力されるので、
          本文の <code>#</code> はそのまま使って大丈夫です。
        </p>
      </Section>

      <Section id="users" title="ユーザーと権限付与">
        <p>
          <Link href="/admin/users" className="text-blue-600 hover:underline">/admin/users</Link>{" "}
          で全ユーザーの一覧と最終ログイン日時、現在の権限を確認できます。
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>editor / admin の付与・剥奪が行えます。</li>
          <li>自分自身からの admin 剥奪、最後の admin の剥奪は安全のため拒否されます。</li>
          <li>権限変更はユーザーが <strong>再ログインしてから</strong> 反映されます (セッションCookieに乗ってからクライアントに伝播するため)。</li>
          <li>一度もログインしていないユーザーは一覧に出ません — 事前付与はできません。</li>
        </ul>
        <Callout>
          UI が動かないなど緊急時の CLI フォールバックは{" "}
          <a
            href="https://github.com/gomyway1216/JTPA-Main/blob/main/docs/admin.md#granting-roles-cli-fallback"
            target="_blank"
            rel="noreferrer noopener"
            className="text-blue-600 hover:underline"
          >
            docs/admin.md
          </a>{" "}
          の「Granting roles (CLI fallback)」セクションを参照。
        </Callout>
      </Section>

      <Section id="deploy" title="デプロイ確認">
        <p>
          <code>main</code> ブランチへの push で Firebase App Hosting が自動的に
          ビルド&デプロイします (約2〜3分)。
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            進行状況:{" "}
            <a
              href="https://console.firebase.google.com/u/0/project/jtpa-main/apphosting/backends/jtpa-main/locations/us-central1/rollouts"
              target="_blank"
              rel="noreferrer noopener"
              className="text-blue-600 hover:underline"
            >
              App Hosting Rollouts
            </a>
          </li>
          <li>
            エラーログ (本番):{" "}
            <a
              href="https://console.cloud.google.com/logs/query;query=resource.type%3D%22cloud_run_revision%22%20resource.labels.service_name%3D%22jtpa-main%22?project=jtpa-main"
              target="_blank"
              rel="noreferrer noopener"
              className="text-blue-600 hover:underline"
            >
              Cloud Run Logs
            </a>
          </li>
          <li>本番でエラーが出たら直前のリリースに「Roll back」可能 (Cloud Run の旧イメージが残っているため即時)。</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3 scroll-mt-20">
      <h2 className="text-xl font-semibold border-b border-zinc-200 pb-1 dark:border-zinc-800">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {children}
      </div>
    </section>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
        {n}
      </span>
      <div className="space-y-1">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
        <div className="text-zinc-600 dark:text-zinc-400">{children}</div>
      </div>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border-l-4 border-amber-400 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-200">
      {children}
    </div>
  );
}

function Table({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-zinc-500">
        <tr>
          {headers.map((h) => (
            <th key={h} className="py-2 pr-4">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {children}
      </tbody>
    </table>
  );
}

function Row({ cells }: { cells: React.ReactNode[] }) {
  return (
    <tr>
      {cells.map((c, i) => (
        <td key={i} className="py-2 pr-4 align-top">
          {c}
        </td>
      ))}
    </tr>
  );
}
