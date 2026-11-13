# Conversational Factory Builder

自然言語で量産ラインを設計し、3Dで構築・シミュレーションするブラウザアプリ。
まず `docs/DEMO.md`（目指す体験）と `docs/ARCHITECTURE.md`（設計・実装順序）を読むこと。

## 役割分担

- メインセッション = 主任アーキテクト。設計・技術判断・契約の変更・レビューを担当。
- 通常の実装・テスト・修正は Sonnet のサブエージェント（Agent ツール, `model: "sonnet"`）へ委譲する。
- ユーザーはスマホから指示する。報告は短く、判断が必要な点は選択肢で。

## 規約

- `src/core/ir/schema.ts` と `src/core/contracts.ts` は契約。実装者は変更しない（必要なら差し戻す）。
- `src/core` は純 TypeScript（React / three.js を import しない）。Node 上の vitest で検証する。
- IR の変更は必ず `PatchOp` → `applyPatch` 経由。UI も AI も同じ経路。
- AI は提案のみ。見た目・ファイル名からの推定は `propose_semantics`、未指定値は `assume` で必ず可視化する。
- 制御ロジック/ST 生成に LLM を使わない（決定的なテンプレート生成）。
- UI 文言は日本語。スマホ縦画面を第一に。

## コマンド

```bash
npm install
npm run dev      # 開発サーバ
npm test         # vitest
npm run build    # 型チェック + ビルド
```
