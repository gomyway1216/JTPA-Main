import Link from "next/link";

export const metadata = { title: "ヘルプ・使い方" };

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">ヘルプ・使い方</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          JTPAサイトの機能と使い方をまとめました。質問があれば{" "}
          <Link href="/qa/new" className="text-blue-600 hover:underline">
            Q&amp;Aに投稿
          </Link>{" "}
          してください。
        </p>
      </header>

      <nav className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-2 font-medium">目次</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          <li><a href="#signin" className="text-blue-600 hover:underline">アカウント (ログイン)</a></li>
          <li><a href="#events" className="text-blue-600 hover:underline">イベントに参加する</a></li>
          <li><a href="#presenter" className="text-blue-600 hover:underline">発表者として登壇する</a></li>
          <li><a href="#showcase" className="text-blue-600 hover:underline">ショーケースに投稿する</a></li>
          <li><a href="#blog" className="text-blue-600 hover:underline">ブログ記事を書く</a></li>
          <li><a href="#qa" className="text-blue-600 hover:underline">Q&amp;Aで質問・回答する</a></li>
          <li><a href="#guide" className="text-blue-600 hover:underline">ガイドを読む</a></li>
          <li><a href="#comments" className="text-blue-600 hover:underline">コメント・いいね</a></li>
          <li><a href="#profile" className="text-blue-600 hover:underline">プロフィール公開設定</a></li>
          <li><a href="#mypage" className="text-blue-600 hover:underline">マイページ</a></li>
        </ul>
      </nav>

      <Section id="signin" title="アカウント (ログイン)">
        <p>
          右上の「ログイン」から <strong>Google アカウント</strong>でサインイン
          できます。メールアドレス・パスワードによる登録はありません。
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>初回ログイン時にプロフィール (氏名・アイコン・メール) が自動作成されます。</li>
          <li>イベントRSVP、プロジェクト/記事/Q&amp;Aの投稿、コメント・いいねにはログインが必要です。</li>
          <li>ログアウトしたい時は画面右上の自分の名前を選び、「サインアウト」をクリック。</li>
        </ul>
      </Section>

      <Section id="events" title="イベントに参加する">
        <Step n={1} title="イベントを探す">
          <Link href="/events" className="text-blue-600 hover:underline">/events</Link>{" "}
          に今後開催予定のイベントが並んでいます。下に過去のイベントもあります。
        </Step>
        <Step n={2} title="詳細ページで RSVP">
          イベント詳細を開き、「参加する」ボタンを押します。
          一般参加と発表者の役割が選べます。所属やイベントごとの質問項目
          (任意/必須) があれば入力してください。
        </Step>
        <Step n={3} title="参加状況の確認・キャンセル">
          <Link href="/my/rsvps" className="text-blue-600 hover:underline">/my/rsvps</Link>{" "}
          で自分の参加履歴と今後のイベントを一覧できます。同じ画面から
          キャンセルも可能です。
        </Step>
        <Callout>
          イベントによっては「メンバー限定」(ログイン必須) や定員 (満員時はウェイトリスト) が設定されています。
          ウェイトリストに登録された場合、誰かがキャンセルすると自動的に繰り上がります。
        </Callout>
      </Section>

      <Section id="presenter" title="発表者として登壇する">
        <Step n={1} title="役割を「発表者」にしてRSVP">
          イベント詳細ページの RSVP フォームで「発表者として参加」を選択。
          発表タイトル・概要を入力します。
        </Step>
        <Step n={2} title="スライドや動画リンクをアップロード">
          RSVP 後に表示される「発表資料」セクションから、PDFスライドや
          YouTube などの外部リンクを登録できます。1人で複数の発表登録も可能です。
        </Step>
        <Step n={3} title="後から差し替え">
          同じセクションから差し替え・追加が可能です。アップロードしたファイルは
          イベント詳細ページから一般参加者も閲覧できます。
        </Step>
      </Section>

      <Section id="showcase" title="ショーケースに投稿する">
        <p>
          自作のAIプロジェクト・サービス・ツールを{" "}
          <Link href="/showcase" className="text-blue-600 hover:underline">ショーケース</Link>{" "}
          で紹介できます。
        </p>
        <Step n={1} title="新規投稿">
          <Link href="/projects/new" className="text-blue-600 hover:underline">/projects/new</Link>{" "}
          を開いてフォームに入力。最低限 <strong>タイトル・説明・アプリURL</strong>{" "}
          が必須で、サムネイル画像・スクリーンショット (最大8枚)・タグ・
          リポジトリURL・デモ動画URLは任意です。
        </Step>
        <Step n={2} title="管理者の承認待ち">
          投稿は <code>承認待ち (pending)</code> の状態で保存されます。
          管理者の承認後、ショーケース一覧に掲載されます。
        </Step>
        <Step n={3} title="編集">
          <Link href="/my/projects" className="text-blue-600 hover:underline">/my/projects</Link>{" "}
          で自分の投稿を編集できます。編集すると再度承認待ち状態に戻ります。
        </Step>
      </Section>

      <Section id="blog" title="ブログ記事を書く">
        <p>
          コミュニティ向けのブログ記事を投稿できます。AI関連の体験記、
          チュートリアル、考察などを共有してください。
        </p>
        <Step n={1} title="新規記事">
          <Link href="/blog/new" className="text-blue-600 hover:underline">/blog/new</Link>{" "}
          で執筆。Markdown 記法 (表・コードブロック・タスクリスト) が
          使えます。カバー画像・タグも設定可能。
        </Step>
        <Step n={2} title="下書き保存 or 審査に出す">
          下書き (<code>draft</code>) として保存して後で続きを書く、または
          審査待ち (<code>pending</code>) に進めて管理者の確認を依頼。
        </Step>
        <Step n={3} title="公開">
          管理者の承認後、<Link href="/blog" className="text-blue-600 hover:underline">/blog</Link>{" "}
          に掲載されます。
        </Step>
        <Step n={4} title="編集・再公開">
          <Link href="/my/posts" className="text-blue-600 hover:underline">/my/posts</Link>{" "}
          で自分の記事を管理。公開済みの記事を編集して再審査に出すこともできます。
          (公開日 <code>publishedAt</code> は初回公開時のまま維持されます)
        </Step>
      </Section>

      <Section id="qa" title="Q&amp;Aで質問・回答する">
        <p>
          短い質問・Tips・トラブルの共有用の場所です。<strong>承認なしで即時公開</strong>される点が
          ブログとの違いです。
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><Link href="/qa" className="text-blue-600 hover:underline">/qa</Link> で最新の質問一覧</li>
          <li><Link href="/qa/new" className="text-blue-600 hover:underline">/qa/new</Link> で新規投稿 (Markdown OK)</li>
          <li>回答はコメント機能でやり取り (返信 = 「Re: @ユーザー」表記)</li>
          <li>自分の投稿は <Link href="/my/qa" className="text-blue-600 hover:underline">/my/qa</Link> から編集可能</li>
        </ul>
      </Section>

      <Section id="guide" title="ガイドを読む">
        <p>
          <Link href="/guide" className="text-blue-600 hover:underline">/guide</Link>{" "}
          には JTPA が公式にキュレーションした AI ツールのセットアップガイド・
          解説記事が並んでいます。コミュニティ投稿のブログ/Q&amp;Aと違い、
          内容は管理者・エディタが管理します。
        </p>
      </Section>

      <Section id="comments" title="コメント・いいね">
        <p>
          ブログ・ガイド・Q&amp;A・ショーケースの各詳細ページにコメント欄と
          いいねボタンがあります。
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>コメント</strong>: 2000文字まで。Markdownは使えません (プレーンテキストのみ)。</li>
          <li><strong>返信</strong>: コメントの「返信」ボタンで「Re: @ユーザー」付きの返信が書けます。ネストは1段までで、見た目はフラット表示。</li>
          <li><strong>編集・削除</strong>: 自分のコメントは編集・削除可能。削除は本文を消す「ソフトデリート」(ユーザー名と削除済み表示は残ります)。</li>
          <li><strong>いいね</strong>: 投稿全体にも、個別コメントにもいいねできます。何度でも切り替え可能。</li>
          <li><strong>もらったいいね</strong>:{" "}
            <Link href="/my/likes" className="text-blue-600 hover:underline">/my/likes</Link>{" "}
            で自分のコメントに付いたいいねを横断的に見られます。
          </li>
        </ul>
      </Section>

      <Section id="profile" title="プロフィール公開設定">
        <p>
          <Link href="/my/profile" className="text-blue-600 hover:underline">/my/profile</Link>{" "}
          で公開プロフィールの内容と公開範囲を設定できます。
        </p>
        <Table headers={["項目", "デフォルト", "公開先"]}>
          <Row cells={["氏名・アイコン", "公開", <span key="a">Googleアカウントの値。コメント・投稿に常に表示</span>]} />
          <Row cells={["所属 (affiliation)", "非公開", <span key="b">公開ONで <code>/u/[uid]</code> に表示</span>]} />
          <Row cells={["自己紹介 (bio)", "非公開", <span key="c">同上。改行はそのまま反映</span>]} />
          <Row cells={["メールアドレス", "—", <span key="d"><strong>絶対に</strong>公開されません</span>]} />
        </Table>
        <p className="text-sm text-zinc-500">
          コメント欄の氏名やアイコンをクリックすると <code>/u/[ユーザーID]</code> の
          公開プロフィールページが開きます。所属・自己紹介を公開設定にしている人は
          ここで読めます。
        </p>
      </Section>

      <Section id="mypage" title="マイページ">
        <p>
          右上の自分の名前から <Link href="/my" className="text-blue-600 hover:underline">/my</Link>{" "}
          に行くと、自分の投稿や受け取ったいいねが一覧できます。
        </p>
        <Table headers={["メニュー", "内容"]}>
          <Row cells={[<Link key="r" href="/my/rsvps" className="text-blue-600 hover:underline">参加履歴</Link>, "イベントRSVPの一覧、キャンセル"]} />
          <Row cells={[<Link key="p" href="/my/projects" className="text-blue-600 hover:underline">自分の投稿</Link>, "ショーケースに投稿したプロジェクト"]} />
          <Row cells={[<Link key="b" href="/my/posts" className="text-blue-600 hover:underline">自分の記事</Link>, "ブログ記事 (下書き含む)"]} />
          <Row cells={[<Link key="q" href="/my/qa" className="text-blue-600 hover:underline">自分のQ&amp;A</Link>, "投稿した質問・回答"]} />
          <Row cells={[<Link key="l" href="/my/likes" className="text-blue-600 hover:underline">もらったいいね</Link>, "自分のコメントに付いたいいね一覧"]} />
          <Row cells={[<Link key="pr" href="/my/profile" className="text-blue-600 hover:underline">アカウント設定</Link>, "プロフィール・公開設定・メール通知"]} />
        </Table>
      </Section>

      <footer className="border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800">
        <p>
          このページに書かれていない使い方・不具合報告は{" "}
          <Link href="/qa/new" className="text-blue-600 hover:underline">Q&amp;Aに投稿</Link>{" "}
          するか、コミュニティの Slack/Google Group までお寄せください。
        </p>
      </footer>
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
