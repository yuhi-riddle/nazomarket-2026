# 実装計画: 共同リストのメンバー・担当者・人ごとの予算

設計: `docs/design-shared-members.md`

機能ごとに「失敗するテストを用意 → 実装 → テスト・型・ビルド → コミット」で進め、最後にまとめて画面を確認する。

## 1. サーバー（設計 2〜4）

- `tests/shared-worker.test.ts` にテストを足す
  - `add-member` / `rename-member` / `remove-member` / `set-member-budget` / `set-owner` の適用と revision
  - 名前（空・21文字・制御文字・重複）、21人目、存在しないメンバーID・アイテムIDの拒否
  - `remove-member` で担当が未定に戻る
  - `add` の `ownerId`（存在しないIDは拒否）
  - 状態直下の `budgetYen` と `set-budget` の拒否
  - SQLite に書いて読み直したときの一致（メンバーの並び順を含む）
- `shared-worker/src/domain.ts` と `worker.ts` を実装する

## 2. クライアントの同期（設計 5〜5.1・7）

- テスト
  - `src/shared/types` の検証: 新しい状態と操作を受け、旧形式を拒否する
  - `bridge.test.ts`: 写した結果に `members` / `ownerByProductId` が入り、送信待ちのメンバー操作が当たる。`add` に自分の ID が入る。コピー時は全部自分の担当
  - `client.test.ts`: 送信待ちの列の保存キーが新しい版になり、古い版の列は読まずに消す
  - 自分の保存（部屋IDごと）と、状態から自分が消えたときの解除
  - `store.test.ts`: 共同モードの `shared` の受け渡し、`budget` を変えても共有操作にならず元に戻る、抜けたら `shared` を捨てる
- `src/shared/types.ts`・`bridge.ts`・`client.ts`・`src/store.ts` を実装する。ポーリングで revision と送信待ちが同じなら store に当てない

## 3. 計算（設計 6）

- テスト
  - メンバーごとの担当の合計・残り・超過と、未定の件数・金額、全体の合計
  - `rankForCatalog` が、好みを読むアイテムと予算から引くアイテムを分けて受け取り、二重に引かない
- `src/logic` に集計関数を足し、`insights.ts` の `rankForCatalog` の引数を分ける。呼び出し側（`catalogView.ts`）は、個人リストでは全体、共同リストでは自分の担当分を渡す

## 4. 画面（設計 6・7.1）

- `sharedListView.ts`: 「あなたは？」の欄（既存メンバーから選ぶ・名前を入れて登録）。名前が全員に見える旨の注記
- `cartView.ts`: 共同リストのときはメンバー表（`<table>`、予算の入力、残りと超過）、未定と全体の合計。各行の担当欄。行と担当欄は使い回し、値だけ書き換える
- `budgetMeter.ts`: 自分の担当の合計と自分の予算。自分が未選択なら全体の合計だけ
- 書き込みが止まっているあいだは、メンバー表と担当欄を無効にする

## 5. 仕上げ

- 全テスト・型・ビルド
- headless（390px・1280px）で、ローカルの Worker に対し次を確かめる
  - メンバーの登録と自分の選択
  - 担当の変更、人ごとの予算と超過の表示、未定の集計
  - 読み上げのラベル、横スクロールなし、コンソールエラーなし
- アクセシビリティの確認
- PR 前の Sol レビュー
