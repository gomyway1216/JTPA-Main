#!/usr/bin/env node
/**
 * Seed a handful of starter Guides so /guide isn't empty on a fresh deploy
 * (and so editors can see what good content looks like to crib from).
 *
 * Idempotent: each entry has a deterministic slug; if a guide with that
 * slug already exists in Firestore, it's left alone. Re-running the
 * script after editing the content here does NOT update existing docs —
 * use the admin UI for edits. Delete the doc first if you want to
 * re-seed from scratch.
 *
 * Usage:
 *   node scripts/seed-guides.mjs
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account
 * JSON for the Firebase project, OR the FIREBASE_SERVICE_ACCOUNT env var
 * containing the JSON inline (same as the set-admin / set-editor scripts).
 */

import { Timestamp, getFirestore } from "firebase-admin/firestore";

import { initAdmin } from "./_lib/firebase-init.mjs";

const SEED_AUTHOR = {
  uid: "seed",
  displayName: "JTPA",
  email: null,
};

const GUIDES = [
  {
    slug: "what-is-claude-code",
    title: "Claude Code とは",
    tags: ["Claude Code", "入門"],
    order: 10,
    body: `
Claude Code は Anthropic が提供する、ターミナル上で動作する AI コーディングアシスタントです。Claude モデルを使ってコードを読み・書き・編集・実行できます。

## 主な特徴

- **ターミナルから直接使える**: \`claude\` コマンド一つで起動。VS Code などの IDE と連携してインラインで使うことも可能です。
- **複数ファイルにまたがる編集**: 「この機能を別ファイルに切り出して」のような指示で、関連するファイルを横断的に編集できます。
- **ツール利用**: ファイル操作・Git・コマンド実行・Web 検索などのツールを必要に応じて自律的に呼び出します。

## 始め方

1. \`npm install -g @anthropic-ai/claude-code\` でインストール
2. ターミナルで \`claude\` を実行
3. 初回起動時に Claude.ai アカウントでのログインか、API キーの設定を行う

## どんな時に便利？

- 既存コードの調査・理解
- バグの原因究明と修正
- 新機能の足場作り
- テストやドキュメントの自動生成

## 料金

Claude.ai の Pro / Max プランに含まれています。API キー経由で使う場合は、Anthropic API の従量課金が発生します。
`.trim(),
  },
  {
    slug: "what-is-api-key",
    title: "API キーとは",
    tags: ["API", "入門"],
    order: 20,
    body: `
API キーは、外部サービスの API にアクセスするための「鍵」となる文字列です。Claude や OpenAI のような AI サービスを、自分のプログラムから直接呼び出す場合に必要になります。

## なぜ必要？

- **本人確認**: API キーで「誰のアカウントからのリクエストか」をサービス側が判別します。
- **課金・利用量制限**: 使った分はそのキーの持ち主に課金されます。
- **権限スコープ**: 一部のサービスでは、キーごとに読み取り専用などの権限を細かく設定できます。

## 取得方法（Anthropic API の例）

1. [console.anthropic.com](https://console.anthropic.com) にログイン
2. **API Keys** メニューから "Create Key" を選択
3. キー名を付けて作成 → 表示された文字列をその場でコピー

> 作成直後の一度しか全文が表示されません。コピーし忘れた場合はキーを作り直す必要があります。

## 取り扱いの注意

- **公開リポジトリにコミットしない**: 漏れたキーは即座に無効化（rotate）してください。
- **環境変数に入れる**: \`.env.local\` などにまとめ、\`.gitignore\` で除外するのが基本。
- **チームで共有しない**: メンバーごとに別キーを発行すると、漏洩時の影響範囲を絞れます。
`.trim(),
  },
  {
    slug: "chatgpt-vs-claude",
    title: "ChatGPT と Claude の使い分け",
    tags: ["ChatGPT", "Claude", "比較"],
    order: 30,
    body: `
どちらも汎用的な対話 AI ですが、得意分野や周辺ツールに違いがあります。両方を試して用途に合うほうを選ぶのが現実的です。

## ざっくり比較

| 観点 | ChatGPT (OpenAI) | Claude (Anthropic) |
| --- | --- | --- |
| 長文の取り扱い | 標準で十分長い | 200K トークン超の長文に強い |
| コード生成 | プラグイン・GPTs が豊富 | Claude Code との統合が強力 |
| 画像生成・解析 | DALL·E 連携・画像入力対応 | 画像入力対応（生成は別サービス） |
| 音声 | 音声会話・読み上げ対応 | テキスト中心 |

## 用途別の目安

- **コーディングを丸ごと任せたい** → Claude (特に Claude Code)
- **長いドキュメントを要約・分析したい** → Claude
- **画像を生成したい / 音声で会話したい** → ChatGPT
- **アイデア出し・ブレインストーミング** → どちらも得意

## 併用する人も多い

「コード作業は Claude、雑談・画像生成は ChatGPT」のように使い分けるのは普通です。サブスクリプションを 2 つ持つのが惜しい場合は、まず無料枠で両方触ってから決めるのがおすすめ。
`.trim(),
  },
  {
    slug: "prompt-writing-tips",
    title: "プロンプトを書くときのコツ",
    tags: ["プロンプト", "入門"],
    order: 40,
    body: `
AI に期待した回答を引き出すには、いくつかの基本があります。難しいテクニックよりも、伝え方を整えるだけで結果が大きく変わります。

## 1. 「誰に」「何を」「どんな形で」を明示する

たとえば「これ要約して」ではなく:

> 「以下の技術記事を、エンジニア向けに 3 行で要約して」

のように、読者・目的・出力形式を一緒に伝えます。

## 2. 例を見せる (Few-shot)

期待する出力の見本を 1〜2 個含めると、フォーマットが安定します。コードのリファクタなら、Before / After を 1 ペア示すだけで精度が変わります。

## 3. 段階的に詰める

最初から完璧なプロンプトを書こうとせず、まず短く投げて、結果を見て追加で指示を重ねるほうが速いことが多いです。

## 4. 制約を入れる

- 「日本語で」「200 字以内で」「箇条書きで」「コードブロックなしで」など
- やってほしくないことを書く: 「謝罪は不要」「前置きは省略して」

## 5. 役割を与える

> 「あなたは経験豊富な税理士です。質問に対し、根拠となる法令も添えて回答してください。」

専門家の役割を指定すると、回答の粒度や視点が変わります。
`.trim(),
  },
];

initAdmin();

const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

let created = 0;
let skipped = 0;

for (const g of GUIDES) {
  const existing = await db
    .collection("guides")
    .where("slug", "==", g.slug)
    .limit(1)
    .get();
  if (!existing.empty) {
    console.log(`- skip: "${g.slug}" already exists`);
    skipped++;
    continue;
  }
  const now = Timestamp.now();
  await db.collection("guides").add({
    slug: g.slug,
    title: g.title,
    body: g.body,
    tags: g.tags,
    status: "published",
    order: g.order ?? 100,
    createdAt: now,
    updatedAt: now,
    createdBy: SEED_AUTHOR,
    updatedBy: SEED_AUTHOR,
  });
  console.log(`+ created: "${g.slug}" — ${g.title}`);
  created++;
}

console.log(`\nDone. ${created} created, ${skipped} skipped.`);
// Firestore's gRPC client keeps connections open after the work is done,
// which leaves the Node event loop active and stops the process from
// exiting on its own. An explicit exit avoids the "script just hangs"
// experience.
process.exit(0);
