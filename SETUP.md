# JTPA-Main セットアップ

Firebase プロジェクト `jtpa-main` を前提とした初期セットアップ手順。

## 1. Firebase コンソール側で有効化するもの

- **Authentication** → Sign-in method で **Google** を有効化
- **Firestore Database** を `us-central` あたりで作成 (本番モード)
- **Storage** を作成
- **Extensions** → "Trigger Email" (Stream Firestore to Email) をインストール
  - 配信プロバイダ: Resend / SendGrid どちらでも可
  - Collection を `mail` に設定 (このリポの実装と一致)
  - From address はドメイン認証済みの送信元を指定

## 2. ローカル開発

```bash
# 依存インストール (npm)
npm install

# Firebase Web SDK 設定をコピー
cp .env.example .env.local
# Firebase Console → Project Settings → Web app → SDK setup and config から
# 各 NEXT_PUBLIC_FIREBASE_* を埋める

# セッション署名用シークレット
openssl rand -base64 32 # 出力を SESSION_COOKIE_SECRET に設定

# 管理者通知の宛先 (カンマ区切り) — 必要なら .env.local に追加
# ADMIN_NOTIFICATION_EMAILS=uwyudai@gmail.com,jin@example.com

# Firebase Admin の認証情報 (ローカルのみ)
# Firebase Console → Project Settings → Service accounts → "Generate new private key"
# でダウンロードしたJSONを ./secrets/service-account.json として保存
export GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/secrets/service-account.json"

# 開発サーバー起動
npm run dev
```

## 3. ルール・インデックスのデプロイ

```bash
# 初回のみ
npm install -g firebase-tools
firebase login

# ルールとインデックスを push
firebase deploy --only firestore:rules,firestore:indexes,storage:rules
```

## 4. 管理者を作る (Custom Claim を付与)

ログインしたいGoogleアカウントで一度サインインしてから:

```bash
# サービスアカウントJSONを使う場合
GOOGLE_APPLICATION_CREDENTIALS=./secrets/service-account.json \
NEXT_PUBLIC_FIREBASE_PROJECT_ID=jtpa-main \
npm run set-admin -- uwyudai@gmail.com

# 解除するとき
npm run set-admin -- uwyudai@gmail.com -- --revoke
```

権限反映には一度ログアウト→再ログインが必要。

## 5. Firebase App Hosting へのデプロイ

```bash
# Firebase Console → App Hosting → Backend を作成、GitHub リポジトリを連携
# ブランチ: main / リージョン: us-central1 推奨
```

App Hosting にデプロイすると `apphosting.yaml` を読み込んで自動ビルド。
本番では Secret Manager で機微情報を管理:

```bash
firebase apphosting:secrets:set SESSION_COOKIE_SECRET
firebase apphosting:secrets:grantaccess SESSION_COOKIE_SECRET
```

`NEXT_PUBLIC_FIREBASE_*` は `apphosting.yaml` の `env` に直接書いてOK
(クライアントに露出する値なので秘密ではない)。

### Rules を GitHub Actions で自動 deploy する

`.github/workflows/deploy-rules.yml` が `firestore.rules` / `firestore.indexes.json` /
`storage.rules` / `firebase.json` のいずれかが main に push されたタイミングで自動 deploy します。
セットアップに必要なもの:

1. **GCP Service Account を作成** (Console → IAM → Service Accounts)
   - 名前例: `gh-actions-rules-deployer`
   - 付与する Role:
     - `Firebase Rules Admin` (`roles/firebaserules.admin`)
     - `Cloud Datastore Index Admin` (`roles/datastore.indexAdmin`)
     - `Firebase Hosting Admin` (`roles/firebasehosting.admin`) ※将来 Hosting も deploy するなら
2. **キーを発行**: 該当 SA → Keys → Add Key → JSON
3. **GitHub Secret に登録**: repo Settings → Secrets and variables → Actions → New repository secret
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: ダウンロードしたJSONの中身を丸ごとペースト
4. ワークフローを手動キックして動作確認: Actions → "Deploy Firestore & Storage Rules" → Run workflow

## 6. データ構造

| Collection | 説明 |
|---|---|
| `users/{uid}` | ユーザープロファイル (Googleログイン時に自動作成) |
| `events/{eventId}` | イベント。`status: draft/published/past/cancelled` |
| `events/{eventId}/rsvps/{uid}` | 参加登録 |
| `events/{eventId}/presentations/{id}` | 発表資料 (Phase 2) |
| `projects/{projectId}` | ショーケース投稿。`status: pending/approved/rejected/archived` |
| `mail/{id}` | Trigger Email extension が読むキュー |

## 7. 何が動いて、何が未実装か

実装済み:
- Googleログイン (Firebase ID Token → セッションCookie)
- イベント作成・編集・削除 (admin)
- 公開イベント一覧 / 詳細
- RSVP (一般 / 発表者) + 任意のアンケート項目
- ショーケース投稿フロー + 承認制 + 編集後の自動 pending 化
- 管理ダッシュボード (承認待ち、イベント、参加者一覧)
- メール通知の枠組み (新規投稿時/承認・却下時)

未実装 (今後追加候補):
- 発表資料の Storage アップロードUI (`presentations/` のルールは設定済み)
- 一斉メール送信のUI (関数 `enqueueEventBlast` は実装済み)
- 当日リマインダー (Cloud Functions v2 `onSchedule` で実装予定)
- カバー画像・スクリーンショットの実アップロード (Storage 経由)
- メンバー間のプロフィールページ
