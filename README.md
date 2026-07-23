This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.

## SEO分析ダッシュボード（/seo）

GA4・Google Search Console・Microsoft Clarity のデータを S3 に蓄積して表示するダッシュボードです。

### 仕組み

- **同期**: 「データ同期」ボタン（`POST /api/seo/sync`）または Vercel Cron（`/api/cron/seo-sync`、毎日 20:00 UTC = JST 翌朝5:00）が GA4/GSC の過去28日分を再取得して upsert し、Clarity の直近3日スナップショットを保存します
- **Clarity のAPI制限**: Data Export API は**1プロジェクトあたり1日10リクエストまで**。1回の同期でサマリ＋ページ別＋参照元＋ブラウザ別の計4リクエストを使うため、手動同期は1日2回程度に留めてください（cronで1回は自動消費）。上限超過時はサマリのみ保存されます
- **保存先（S3）**: `seo-metrics/ga4-daily.json` / `seo-metrics/gsc-daily.json` / `seo-metrics/clarity-snapshots.json` / `seo-metrics/sync-meta.json`
- **表示**: `GET /api/seo/metrics?range=7d|28d|90d` が KPI・時系列・テーブルを集計して返します

### 必要な環境変数（Vercel に設定）

| 変数名 | 内容 |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google サービスアカウントの JSON キー（1行の JSON 文字列） |
| `GA4_PROPERTY_ID` | GA4 プロパティ ID（数字のみ。例: `123456789`） |
| `GSC_PROPERTY_URL` | Search Console プロパティ（例: `https://nihon-teikei.co.jp/` または `sc-domain:nihon-teikei.co.jp`） |
| `CLARITY_API_TOKEN` | Clarity Data Export API トークン |
| `CLARITY_PROJECT_ID` | Clarity プロジェクト ID（ダッシュボード URL 用） |

### セットアップ手順

1. **サービスアカウント**: Google Cloud でサービスアカウントを作成し、JSON キーを発行。
   「Google Analytics Data API」「Search Console API」を有効化する
2. **GA4**: GA4 プロパティの「プロパティのアクセス管理」でサービスアカウントのメールアドレスを「閲覧者」として追加
3. **GSC**: Search Console の「設定 → ユーザーと権限」で同メールアドレスを「制限付き」以上で追加
4. **Clarity**: 対象プロジェクトの「Settings → Data Export」で API トークンを発行
5. **疎通確認**（ローカル、`.env.local` に上記変数を設定してから）:

```bash
node scripts/test-seo-api-connection.mjs   # GA4 + GSC
node scripts/test-clarity-api.mjs          # Clarity
```

6. デプロイ後、`/seo` を開いて「データ同期」を実行（初回はデータなしのため過去90日分を取得）

※ NIS（`C:\Users\goto_\NIS\web`）と同一サイトを計測する場合は、NIS の Vercel 環境変数の値をそのままコピーできます（NIS 側は `NIS_DEFAULT_GA4_PROPERTY_ID` / `NIS_DEFAULT_GSC_PROPERTY_URL` / `NIS_DEFAULT_CLARITY_PROJECT_ID` という変数名）。

## ホワイトペーパー管理（/whitepaper）

ホワイトペーパーをダウンロードしたユーザーを DynamoDB から読み取り、検索・絞り込み・詳細確認・CSV出力する管理ページです。ページ内の「フォローアップ パイプライン」では、担当者・次回アクション・メモ・商談進捗をS3に保存し、カードのドラッグ＆ドロップでステージを更新できます。

DL履歴の削除はパイプラインの詳細画面から行えます。削除するとDynamoDBの該当DL履歴とS3のパイプライン情報を完全に削除し、取り消せません。

ページ内の「資料紹介記事を作成」では、公開サイトの `/whitepaper/` に掲載している資料だけを、`data-for-nas` バケットの `Whitepapers/` から一覧表示します。S3に存在するだけで未公開のPDFは表示・生成対象になりません。資料名・概要・対象キーワード・既存の資料DLページURLを設定すると、PDF本文を抽出してClaude BedrockがCTA付きの紹介記事を生成し、NASの記事エディタへ下書きとして渡します。CTAはPDF直リンクではなく資料DLページへ誘導するため、DynamoDBのDL計測とフォローアップパイプラインを維持できます。

PDF本文の抽出結果は同じバケットの `whitepaper-content/extracted/`、資料設定は `whitepaper-content/catalog.json` に保存します。PDFを選択して直接本文を読むため、この機能専用のEmbedding作成は不要です。

IAMには `data-for-nas` バケットに対する `s3:ListBucket` と、`Whitepapers/*`・`whitepaper-content/*` に対する `s3:GetObject` / `s3:PutObject` が必要です。記事生成には従来どおりBedrockの `bedrock:InvokeModel` 権限も使用します。

### 接続先

- テーブル: `nts-whitepaper-leads`
- パーティションキー: `email`
- ソートキー: `downloaded_at`
- リージョン: `ap-northeast-1`（`AWS_REGION` で変更可能）
- PDFバケット: `data-for-nas`（`WHITEPAPER_S3_BUCKET_NAME` で変更可能）
- PDFプレフィックス: `Whitepapers/`

### Vercel 環境変数

| 変数名 | 内容 |
| --- | --- |
| `DYNAMODB_WHITEPAPER_LEADS_TABLE` | テーブル名。未設定時は `nts-whitepaper-leads` |
| `WHITEPAPER_S3_BUCKET_NAME` | PDF・資料設定のS3バケット。未設定時は `data-for-nas` |
| `AWS_REGION` | DynamoDB のリージョン（例: `ap-northeast-1`） |
| `AWS_ACCESS_KEY_ID` | 対象テーブルを読み取れるIAMアクセスキー |
| `AWS_SECRET_ACCESS_KEY` | 上記アクセスキーのシークレット |

既存のAWS認証情報を利用できますが、IAMには対象テーブル限定で次の権限だけを付与してください。`dynamodb:DeleteItem` はパイプライン画面の明示的な完全削除にのみ使用します。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:Scan",
        "dynamodb:DescribeTable",
        "dynamodb:DeleteItem"
      ],
      "Resource": "arn:aws:dynamodb:ap-northeast-1:YOUR_ACCOUNT_ID:table/nts-whitepaper-leads"
    }
  ]
}
```

### DL通知メール

ホワイトペーパーがダウンロードされると、DL処理を担う Lambda 関数 `nts-whitepaper-download`（`nts-whitepaper-leads` への書き込みを行っている本体）が、Amazon SES 経由で管理者へ通知メールを送信します。DynamoDB書き込み成功後にメール送信を試み、送信に失敗してもDL自体（署名付きURLの発行）は失敗させません。

- 送信元: `SENDER_EMAIL`（環境変数、SESで検証済みのアドレスを指定。現在は `info@nihon-teikei.com`）
- 送信先: `NOTIFY_EMAILS`（環境変数、カンマ区切りで複数指定可。現在は `shimizu_tomoki@cellmuller.com,ono@nihon-teikei.com`）
- SESリージョン: `SES_REGION`（環境変数、現在は `us-east-1`）
- 本文: 資料名・氏名・会社名・メール・電話番号・検討状況・DL日時・utmパラメータ

SESがサンドボックスモードの場合、送信先アドレスも事前に検証（受信者がAWSからの確認メールのリンクをクリック）する必要があります。本番運用でサンドボックス解除（Production access）を申請すれば、未検証アドレスにも送信できます。
