# 実装計画: 見た目の刷新（濃紺と金・押したときの手応え・GET! 演出）

設計: `docs/design-game-style-ui.md`

機能ごとに「失敗するテストを用意 → 実装 → テスト・型・ビルド → コミット」で進め、最後にまとめて画面を確認する。

## 1. 純粋関数のテスト（設計 3・6）

- `src/logic/difficultyTier.test.ts`: 1〜5 はそのまま、0・6・小数・null・undefined は `unknown`
- `src/logic/mapBooths.test.ts` に `boothListStatus` のテストを足す: 未購入ありは `todo`、全部購入済みは `clear`、リストに無いブース・その日に売っていないアイテムだけのブースは状態なし、`todo` の未購入点数（数量込み）

## 2. 配色・書体・文言・カード・ゲージ・押したときの動き・GET!（設計 1〜5・7）

- `styles.css` の `:root` を新しいトークンに置き換え、ダークの上書きを整理（経路の金色は基本ルールへ）。直書きの色を置き換える
- `index.html`: `theme-color`、DotGothic16 の読み込み
- 画面の「商品」を「アイテム」に（表示文言と aria-label）
- `difficultyTier` を実装し、`productCard.ts` で `data-difficulty` を付け、CSS で枠
- 予算ゲージの見た目、`floatGain`
- 押したときの動き（主ボタン・カード・行）
- `src/ui/gameFx.ts`（`celebrateGet`・`floatGain`、使い回す要素、タイマー、aria-live）。`cartView.ts` と `productCard.ts` の購入チェックから呼ぶ。購入済みの印と「GETした数」

## 3. マップ（設計 6）

- `boothListStatus` を実装し、`venueMap.ts` の paintKey に状態を含めて `data-list-status` を付ける
- 倍率に合わせたバッジ（全体表示は点、拡大時は数字）
- 選んだブースのパネルの並び（リストのアイテム → ほかのアイテム）
- 「地図で場所を見る」（アイテム詳細・アイテムリストの行 → マップタブでそのブースを選んだ状態、地図をスクロール）
- 最初の表示範囲を予定のあるブースに合わせる（タブを開いたときだけ）

## 4. 仕上げ

- 全テスト・型チェック・ビルド
- visual-qa（PC 幅・スマホ幅、動きを減らす設定、性能の基準）、accessibility
- PR 前のレビュー（Sol）、PR 作成
