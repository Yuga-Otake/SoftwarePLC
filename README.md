# Conversational Factory Builder

自然言語で量産ラインを設計し、3D で構築・シミュレーションするブラウザアプリです。スマホ縦画面を第一に想定しています。目指す体験は [docs/DEMO.md](docs/DEMO.md)、設計と実装順序は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## コマンド

```bash
npm install
npm run dev      # 開発サーバ
npm test         # vitest
npm run build    # 型チェック + ビルド
npm run preview  # ビルド結果のプレビュー
```

## 公開

GitHub Pages へ自動公開されます。リポジトリの Settings → Pages → Source を "GitHub Actions" に設定し、`main` へマージすると `.github/workflows/pages.yml` がビルドして公開します。URL は `https://<ユーザー名>.github.io/<リポジトリ名>/` です。

## E2E

デモモード（APIキーなし）でデモの主要シーンを通すスモークテストです（Playwright が必要）。

```bash
npm run build && npm run e2e
```

失敗時のスクリーンショットは `e2e/artifacts/` に保存されます。CI（`.github/workflows/ci.yml`）でも実行されます。
