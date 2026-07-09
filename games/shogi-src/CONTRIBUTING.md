# Contributing to MOMO Shogi

## GPL 分離規律（必読・不変・恒久固定）

本リポジトリは MOMO Shogi（アプリ B・MIT）の実装であり、以下を厳守します：

1. **GPL コードを絶対に含めない**
   - 依存追加時は必ず SPDX ライセンスを確認
   - GPL / AGPL / LGPL 系ライセンスの依存は CI で自動ブロック（`npm run check:licenses`）
2. **外部エンジン（YaneuraOu.wasm 等）のデバッグ実験は本リポで行わない**
   - 別途 private リポジトリを用意して実験
   - 実験知見の還元は「インターフェース設計の改善提案」のみ（具体的な GPL エンジン依存の最適化は含めない）
3. **アプリ A（MOMO Shogi Solo）関連コードは本リポに置かない**
   - アプリ A は別リポジトリ（GPL-3.0）で開発

## モジュール規律

`features/*` を `core/*` から直接 import してはならない：

- **Discriminated union**：モディファイア設定・ゲームメッセージ等の union 型は `core/` 側に定義。各 case のハンドラは `features/*` 側で `registerXxxHandler()`
- **Plugin registry**：`features/*` は起動時に `registry.register('quantum', quantumPlugin)` の形で自己登録。`core/` は `registry.get(name)` で解決し、未登録 name は no-op（縮退）

`src/main-a.tsx` は `features/*` を一切 import しない → tree-shaking で完全除外される。

## CI 検査

`.github/workflows/shogi-ci.yml` に定義。以下がすべて緑にならないと PR はマージ不可：

| 検査 | コマンド | 内容 |
|---|---|---|
| typecheck | `npm run typecheck` | TypeScript 型チェック |
| test | `npm run test` | Vitest テスト |
| build | `npm run build` | Vite で両エントリ (B と A) のビルド |
| check:licenses | `npm run check:licenses` | SPDX 依存性検査（GPL 系混入時 CI レッド） |
| check:a-forbidden | `npm run check:a-forbidden` | A ビルド禁止識別子検査（features/* 由来の文字列が A の依存グラフに漏れていないか） |

ローカルでは `npm run ci` で全部一括実行できます。

## PR レビュー観点

- [ ] 新規依存追加時に SPDX ライセンスを確認済み
- [ ] `features/*` を `core/*` から直接 import していない（discriminated union + plugin registry 経由）
- [ ] `main-a.tsx` ビルドが通ることを確認済み（`npm run ci` が緑）
- [ ] 該当 Phase の DoD を満たす（Phase 定義は開発ワークスペースの kickoff 資料 §2 参照）
- [ ] 設計仕様書に不整合を導入していない（発見した場合は下記「仕様不備」参照）

## 仕様不備を発見したとき

実装中に仕様の不備・不整合が発見された場合：

1. **勝手に仕様変更しない**：実装で回避策を取らず、仕様書側を修正する
2. 該当仕様ファイル・章番号・不整合の内容・提案する変更案を Issue または PR コメントで報告
3. 仕様策定側で修正 → pull → 実装再開

軽微な誤字・タイポ・明らかな整合性違反は修正提案可（修正後の仕様ファイル差分を PR に含めてユーザ確認）。

## 新しい features を追加するときの check:a-forbidden 更新

新しい `features/xxx` を追加する場合は、`scripts/check-a-forbidden.mjs` の `FORBIDDEN` 配列にその feature 固有の識別子文字列を追加してください：

```js
const FORBIDDEN = [
  { feature: 'cat-lang', strings: ['i18n:cat', 'にゃんこ語', 'にゃにゃ将棋', 'ようこそにゃ'] },
  // 新規追加例:
  { feature: 'quantum', strings: ['quantum:collapse', 'QuantumState', ...] },
];
```

識別子は「A ビルド成果物に絶対に現れてはならない、その feature 固有の文字列」を選びます。例：plugin registry のキー、feature 固有の型名やクラス名、翻訳データ内の固有語など。
