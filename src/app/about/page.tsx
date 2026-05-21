export const metadata = { title: "JTPAとは" };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-6">
      <h1 className="text-3xl font-bold">JTPAとは</h1>
      <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
        JTPA (Japanese Technology Professionals Association) は、Bay Area
        を中心に活動する日本人テックプロフェッショナルのコミュニティです。
        AI・機械学習を中心とした勉強会、ネットワーキングイベント、メンバーの作ったプロジェクトの紹介などを行っています。
      </p>
      <h2 className="text-xl font-semibold pt-4">活動内容</h2>
      <ul className="list-disc list-inside text-zinc-700 dark:text-zinc-300 space-y-1">
        <li>定期的なオフライン/オンラインの勉強会</li>
        <li>発表者を募集してのライトニングトーク</li>
        <li>メンバーが開発したAIプロダクトのショーケース</li>
      </ul>
    </div>
  );
}
