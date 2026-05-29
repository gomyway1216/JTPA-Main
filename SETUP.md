# JTPA-Main セットアップ (日本語版)

Firebase プロジェクト `jtpa-main` を前提とした初期セットアップ手順。詳細な英語版は [`docs/setup.md`](docs/setup.md) を参照してください。

## 1. Firebase コンソール側で有効化するもの

- **Authentication** → Sign-in method で **Google** と **Anonymous** を有効化
  (Anonymous はイベント当日のウォークイン来場者の QR チェックインで使用)
- **Firestore Database** を `us-west1` で作成 (本番モード)
- **Storage** を作成
- **Extensions** → "Trigger Email" (Stream Firestore to Email) — 設定済み:
  - Extension: `firebase/firestore-send-email@0.2.9`
  - SMTP: Resend (`smtps://resend@smtp.resend.com:465`、 API key は Cloud Secret Manager)
  - Collection: `mail`
  - Default FROM: `JTPA <noreply@bayarea-ai.com>` ([bayarea-ai.com](https://bayarea-ai.com) は Resend で verify 済み)
  - 配信ログ: [resend.com/logs](https://resend.com/logs) (誰に届いたか、 bounce 状況など)

## 2. ローカル開発

```bash
# 依存インストール
npm install

# Firebase Web SDK 設定をコピー
cp .env.example .env.local
# Firebase Console → プロジェクト設定 → マイアプリ → Web → SDK の設定 から
# 各 NEXT_PUBLIC_FIREBASE_* を埋める

# Firebase Admin の認証情報 (ローカル) — ADC を推奨
gcloud auth application-default login

# 開発サーバー起動
npm run dev
```

`gcloud` の代わりにサービスアカウント JSON を使いたい場合は
`FIREBASE_SERVICE_ACCOUNT` に JSON 文字列を入れて `.env.local` に追加。
ただし通常は ADC で十分です (詳細: [`docs/setup.md`](docs/setup.md))。

セッション Cookie は Firebase Auth が署名するため、別途のシークレットは不要です。

## 3. ルール・インデックスのデプロイ

`main` に push されると GitHub Actions が自動 deploy するので、通常は手動操作は不要。
手元から手動で push する場合のみ:

```bash
# 初回のみ
npm install -g firebase-tools
firebase login
firebase use jtpa-main

# ルールとインデックスを push (Firestore + Storage の rules + indexes をまとめて)
firebase deploy --only firestore,storage
```

## 4. 管理者・エディタを作る (Custom Claim を付与)

対象アカウントで一度サインインしてから:

```bash
# admin 付与 / 解除
npm run set-admin -- uwyudai@gmail.com
npm run set-admin -- uwyudai@gmail.com -- --revoke

# editor 付与 / 解除 (ガイド執筆者向け、admin 未満の権限)
npm run set-editor -- editor@example.com
npm run set-editor -- editor@example.com -- --revoke
```

権限反映には一度ログアウト→再ログインが必要。
admin がいる場合は `/admin/users` の UI からロール付与・剥奪もできるので、
CLI は最初の bootstrap だけで OK。

## 5. Firebase App Hosting へのデプロイ

Backend は作成済み (`jtpa-main`)。GitHub `main` への push で自動デプロイ。
環境変数は App Hosting Console UI で管理 (詳細: [`docs/deployment.md`](docs/deployment.md))。

### Rules を GitHub Actions で自動 deploy

`.github/workflows/deploy-rules.yml` が以下のいずれかが `main` に push された時に発火:
`firestore.rules`, `firestore.indexes.json`, `storage.rules`, `firebase.json`, `.github/workflows/deploy-rules.yml`。

サービスアカウント `gh-actions-rules-deployer@jtpa-main.iam.gserviceaccount.com` の JSON キーが
`FIREBASE_SERVICE_ACCOUNT` の GitHub Secret に登録済み (Role 詳細: [`docs/deployment.md`](docs/deployment.md))。

## 6. 機能・データ構造

主要機能とそれぞれが書き込むコレクションは [`docs/features.md`](docs/features.md) と
[`docs/data-model.md`](docs/data-model.md) を参照。
ユーザー向けの使い方ガイドはアプリ内 [/help](src/app/help/page.tsx) に常駐 (日本語)。

## 7. ドキュメントの場所

- [`README.md`](README.md) — リポジトリ概要 + クイックスタート
- [`docs/setup.md`](docs/setup.md) — ローカル開発の詳細手順 (英語、より詳しい)
- [`docs/architecture.md`](docs/architecture.md) — Next.js + Firebase の構成、認可レイヤー、アップロードフロー
- [`docs/data-model.md`](docs/data-model.md) — Firestore コレクションと rules
- [`docs/features.md`](docs/features.md) — 機能一覧と URL / データ / 権限のマッピング
- [`docs/admin.md`](docs/admin.md) — 管理者運用 (ロール、レビュー、イベント管理、チェックイン、エクスポート)
- [`docs/deployment.md`](docs/deployment.md) — App Hosting、Rules CI、環境変数
