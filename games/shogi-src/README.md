# MOMO Shogi

将棋バリアント（本将棋・はさみ将棋・チェス・軍人将棋・カスタムルール）を対人・対AI で対局できる Web アプリ。量子モード・トーラスモード・ルール作成 GUI を持つ。

- **Live**: https://qiqiroon.github.io/momo/games/shogi/
- **Source**: `games/shogi-src/`（本ディレクトリ）
- **Deploy target**: `games/shogi/`（ビルド成果物のみ）

## License

MOMO Shogi は **MIT License** の下で配布されます（[LICENSE](LICENSE) 参照）。

### GPL エンジンについて

本リポジトリには GPL コード（YaneuraOu.wasm 等）を一切含みません。CI で SPDX ライセンス自動照合を行い、GPL / AGPL / LGPL 系依存の混入をブロックします。

将来的な強豪 AI エンジン統合は別プロジェクト **MOMO Shogi Solo**（別リポジトリ・GPL-3.0）で実施されます。

## Related Projects

- **MOMO Shogi Solo**（別リポジトリ・GPL-3.0）：本将棋 + YaneuraOu.wasm による強豪 AI 版
  - 本リポ（アプリ B・全機能・MIT）を基に、機能縮小して派生
  - 分離設計により両プロジェクトのコード共有はしない（GPL 汚染防止）

## Architecture

`src/` 配下は 3 層構造：

- **`core/`**：全アプリ共通（engine / ui-core / controller / i18n / plugin / store）
- **`features/`**：機能単位（matchmaking / quantum / torus / custom-rules / cat-lang / kifu-replay / spectator / rating）。アプリ A では tree-shake で完全除外
- **`adapters/`**：AI/エンジン差替口（mcts-adapter / selfmade-alphabeta / usi-adapter）

ビルドエントリは `src/main-b.tsx`（本アプリ・全機能）と `src/main-a.tsx`（Solo 用・最小骨組み）の 2 系統。

## Development

```bash
cd games/shogi-src
npm install
npm run dev              # http://localhost:5173/
npm run build            # dist/ に両エントリのビルド出力
npm run test             # Vitest
npm run typecheck        # TypeScript --noEmit
npm run ci               # 全チェック（CI と同じ）
```

技術スタック：Vite 6 + React 19 + TypeScript + Zustand + Vitest。

## Deploy

```bash
npm run build
# 成果物 (dist/) を ../shogi/ にコピー
cp -r dist/* ../shogi/
# git commit + push で GitHub Pages が反映
```

デプロイ先 URL: `https://qiqiroon.github.io/momo/games/shogi/`

## Documentation

設計仕様書（親仕様書 v1.21・分冊・付録 D0〜D11）は開発ワークスペース側にあり、本リポには含まれません。実装者は該当ドキュメントを参照して開発してください。
