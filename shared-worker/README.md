# 共同買い物リスト Worker

GitHub Pages から使う、共有ルーム用の最小APIです。Workerが部屋ごとのSQLite Durable Objectへ要求を送り、状態の読取と操作を処理します。Workerの状態保存にはSQLite Durable Objectの同期トランザクションを使います。Cloudflareの仕様は[SQLiteストレージAPI](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)を参照してください。

## ローカルで試す

追加パッケージはありません。既存のNode.js 24以上と依存関係で、純粋ロジック、入力検証、CORS、ルーム作成のテストと型検査を実行できます。

```bash
npm test -- tests/shared-worker.test.ts
npm run typecheck
```

Workerをローカル起動するには、別途用意したWrangler CLIを使います。リポジトリへの依存追加やCloudflareサービス作成は必要ありません。

```bash
wrangler dev --config shared-worker/wrangler.jsonc
```

既定の許可元はViteの `http://localhost:5173`、WorkerのローカルURLは通常 `http://localhost:8787` です。Pagesから使うときは、`ALLOWED_ORIGINS` をPagesの**オリジンだけ**に置き換えます。複数ある場合は `https://site.example,https://preview.example` のようにカンマで区切ります。`*` は使えません。

設定にはSQLiteクラスの初回移行 `v1` が入っています。SQLite Durable Objectの設定は[Cloudflareの開始ガイド](https://developers.cloudflare.com/durable-objects/get-started/)も参照してください。このリポジトリではローカル起動・リモート作成・デプロイは実行していません。

## ブラウザ側の契約

### 共有リンクと認証

1. `POST /api/rooms` を本文なしで呼びます。`201` で `{ roomId, roomKey, state }` が返ります。`roomId` は部屋の識別子、`roomKey` は256ビットの秘密鍵です。
2. 共有リンクは `https://<Pagesのホスト>/?room=<roomId>#<roomKey>` の形にします。鍵はURLフラグメントに置きます。ブラウザはフラグメントをHTTPリクエストやRefererに送りません。
3. 開いた側は `room` クエリとフラグメントを読み、`roomKey` をタブの `sessionStorage` に保存してから `history.replaceState` でフラグメントを消します。クエリ、APIパス、ログには鍵を入れません。鍵は同一オリジン上のJavaScriptから読めるため、リンクは参加者だけに共有してください。
4. 状態取得と操作では `Authorization: Bearer <roomKey>` を付けます。Cookie認証は使いません。

Workerは鍵そのものをSQLiteに保存せず、SHA-256検証値だけを保存します。認証済みの状態レスポンスと作成レスポンスは `Cache-Control: no-store` です。

### API

| 要求 | 用途 | 成功時 |
|---|---|---|
| `POST /api/rooms` | ルーム作成（本文なし） | `201 { roomId, roomKey, state }` |
| `GET /api/rooms/{roomId}` | 最新状態の取得・ポーリング | `200 SharedListState` |
| `POST /api/rooms/{roomId}/operations` | 1操作を原子的に適用 | `200 SharedListState` |

状態の形:

```json
{
  "revision": 4,
  "budgetYen": 5000,
  "items": [
    { "id": "item-1", "productId": "catalog-id", "name": "商品名", "priceYen": 1200, "quantity": 2, "purchased": false }
  ]
}
```

操作要求は `{ "baseRevision": 4, "operation": { ... } }` です。対応する操作:

```json
{ "type": "add", "item": { "id": "item-1", "productId": "catalog-id", "name": "商品名", "priceYen": 1200, "quantity": 1 } }
{ "type": "remove", "itemId": "item-1" }
{ "type": "set-quantity", "itemId": "item-1", "quantity": 2 }
{ "type": "set-purchased", "itemId": "item-1", "purchased": true }
{ "type": "set-budget", "budgetYen": 5000 }
```

`productId`、価格、予算は `null` を指定できます。数量は1〜999、金額は0〜1,000,000,000円、商品名は空でない100文字以内、IDは英数字・`_`・`-` の1〜64文字です。1ルームの上限は500商品、操作本文は8 KiBです。余分なフィールドや上限外の値は拒否します。

各成功操作でリビジョンが1増えます。古い `baseRevision` は `409 { "error": "revision_conflict", "currentRevision": n }` になります。クライアントは最新状態をGETし、操作を再適用するか利用者に選んでもらってください。スナップショット全体を上書きするAPIはありません。複数タブからの操作は1件ずつ送り、競合時に古い状態をそのまま再送しないでください。

主なエラーは `400`（不正入力）、`401`（鍵なし・鍵違い）、`404`（商品またはルームなし）、`409`（競合・ID重複）、`413`（本文超過）、`415`（JSON以外）、`422`（商品数上限）です。

### CORSと権限

ブラウザのOriginは `ALLOWED_ORIGINS` と完全一致したものだけ許可します。未知のOriginや追加ヘッダーは拒否し、許可するヘッダーは `Authorization` と `Content-Type` です。Originチェックはブラウザ制御であり、認証の代わりにはなりません。Originを送らないクライアントも、ルーム鍵がなければ読み書きできません。

## 制限

- ルーム作成は匿名です。作成レート制限、鍵の失効・交換、ルーム削除、期限切れはありません。公開前にCloudflare側で作成レート制限を加えてください。
- 参加者は同じ鍵を共有します。鍵を知る人は全項目と予算を読み書きできます。
- リビジョン競合の自動マージ、変更履歴、長期ポーリング/WebSocketはありません。クライアントがGETでポーリングします。
- この範囲では既存画面との接続はしていません。画面側はこの契約に沿って共有ルームを読み書きします。
