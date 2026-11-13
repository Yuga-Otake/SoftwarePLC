# アーキテクチャ — Conversational Factory Builder

体験の定義は [DEMO.md](./DEMO.md)。本書はそれを最小実装で実現するための設計と技術判断。

## 1. 中心原則

**Equipment IR が唯一の真実。** 3D・AI・制御生成・シミュレーションは互いを知らず、IR だけを読み書きする。

```
 自然言語 ──▶ AI ──▶ PatchOp[] ──(検証・ユーザー承認)──┐
 3D編集/UI操作 ──▶ PatchOp[] ───────────────────────┤
                                                    ▼
                                             Equipment IR
                    ┌───────────────┬───────────────┼────────────────┐
                    ▼               ▼               ▼                ▼
                3D シーン      Control IR ──▶ STコード      比較 (headless×2)
                 (R3F)             │
                    ▲              ▼ 解釈実行
                    └────── シミュレータ (I/O を介して設備を動かす)
```

## 2. 技術判断

| 判断 | 採用 | 理由 |
|---|---|---|
| 構成 | **ブラウザのみの静的アプリ**（バックエンドなし） | スマホでURLを開くだけ。GitHub Pagesで配信。運用コストゼロ |
| UI | Vite + React + TypeScript + React Three Fiber + drei + zustand | 指定通り。3D編集は drei の TransformControls |
| IR検証 | zod | AI出力を必ず実行時検証する必要がある |
| シミュレーション | **運動学ベース・自作**（物理エンジン不使用） | 決定的・高速・headlessで比較実行できる。ワーク位置＝「どのコンベヤの何m地点」 |
| 制御ロジック | IR → **Control IR**（ステップシーケンス）をテンプレートで決定的に生成。**LLMは使わない** | 再現性と安全性。同じControl IRをST出力と解釈実行の両方に使い、表示STと動作の一致を保証 |
| ST実行 | MVPではSTテキストをパースしない（Control IRを解釈実行） | STインタプリタは工数大。一致は生成元の共有で担保 |
| AI | ブラウザからAnthropic APIを直接呼ぶ（キーはユーザーが入力しlocalStorage保存）＋キー無し用の**デモモード**（定型文のルールベース解釈） | サーバ不要。デモモードはUIに明示し、AIと偽らない |
| AIの権限 | AIは **PatchOpの提案のみ**。zod検証→applyPatch→validateを通過した提案だけを変更カードで提示、適用は人 | AIの推定を確認可能に |
| GLB保存 | IndexedDB（アセット）＋ localStorage（IR） | サーバ不要 |
| テスト | vitest（core は Node で全テスト）＋ Playwright スモーク1本 | core が純TSなので速い |

MVPの既知の割り切り: APIキーをブラウザに置く（個人利用前提。公開時はプロキシ化）／コンベヤは直線のみ・分岐合流なし／NG品の排出機構なし（カウントのみ）。

## 3. 「見た目で断定しない」の実装

- **`semantics.status`**: `proposed` の設備は不活性（シミュレーション不動作・制御/ST生成の対象外）。確認操作で `confirmed`。
  AIがGLBに対して使える手掛かりはファイル名・ノード名・外形寸法のみで、必ず `propose_semantics`（根拠・確信度つき）で出す。
- **`assumptions`**: ユーザーが言っていない値をAIが置いたら `assume` で記録。変更カードに表示し、STにコメントとして残る。
- 3D上で proposed は半透明＋「?」バッジ、搬送方向などの仮定は矢印で可視化。

## 4. ディレクトリ

```
src/core/            純TS。React/three 非依存。Nodeでテスト
  ir/schema.ts       ★契約: Equipment IR + PatchOp (zod)
  contracts.ts       ★契約: モジュール間インタフェース
  ir/                applyPatch, validate
  library/           設備ライブラリ (conveyor, source, sensor, stopper, inspection_cell, generic)
  control/           generateControl, emitST, createController
  sim/               createSimulation (固定刻み・シード乱数・異常注入・メトリクス)
  compare/           runHeadless, compare
  ai/                AIProvider (anthropic / demo), システムプロンプト, tool定義
src/app/             React UI
  store/             zustand: ir, 履歴(undo), 選択, sim状態
  scene/             R3F: 設備メッシュ, ワーク, ギズモ, GLB
  panels/            チャット, 変更カード, プロパティ, ライブラリ, ST, HUD, 比較, 異常注入
```

★の2ファイルは契約。実装者（Sonnet）は変更せず、必要なら理由を添えて主任アーキテクトへ差し戻す。

## 5. シミュレーション仕様（要点）

- 固定刻み 10 ms。毎刻み: センサ更新 → コントローラ1スキャン → アクチュエータ更新 → ワーク移動。
- ワークは `motor_run` がONのコンベヤ上でのみ進む。前のワークとの最小間隔を保って滞留（アキューム）。
- ストッパは全開でない限り、ワーク先端を自位置で止める。センサはワーク本体が自位置に重なるとON。
- 検査ステーションは `inspect_start` の立上りから `inspectTimeS` 後に `inspect_done`、結果はシード乱数で `ngRate`。
- 末端（下流接続なし）に達したワークは排出＝完成。排出間隔からサイクルタイムを計測。
- 異常注入: センサ固着ON/OFF、ストッパ固着、検査完了せず、モータトリップ。

## 6. 生成される制御ロジック（検査セル1台あたり）

| ステップ | 出力 | 遷移 |
|---|---|---|
| S0 ワーク待ち | — | 在荷センサON → S1 ／ 運転中に長時間未到着 → **アラーム** |
| S1 検査中 | inspect_start | inspect_done → S2 ／ タイムアウト → **アラーム** |
| S2 開放 | release | 在荷センサOFF → S3 ／ タイムアウト（詰まり）→ **アラーム** |
| S3 通過待ち | release | 通過時間経過 → S0 |

常時: `コンベヤ運転 := Run AND NOT Alarm`。アラームで全停止、リセットで復帰。

## 7. 実装順序（MVP）

GitHub Issue と1対1。上から順に、M1/M2 と M4 は並行可。

| # | マイルストーン | 完了条件 |
|---|---|---|
| M0 | 土台: 旧コード撤去、Vite+R3F+vitest 雛形、IR契約 | `npm run build` `npm test` が通る |
| M1 | core: ライブラリ、applyPatch/validate、Control IR生成、ST出力、シミュレータ、比較 | headlessで標準ラインが流れ、CT計測・異常停止・比較がテストで通る |
| M2 | 3D設備エディタ: ライブラリから配置、移動/回転/スケール、プロパティ編集、Undo、保存 | スマホで設備を置いて動かせる |
| M3 | 3D実行: ▶/■、ワーク搬送アニメ、HUD、STライブハイライト、異常注入、I/O表示 | デモのシーン2・4 |
| M4 | 対話: チャット→PatchOp→変更カード→適用、仮定の承認、デモモード | デモのシーン1 |
| M5 | 比較UI: 適用前後の自動比較表 | デモのシーン3 |
| M6 | GLB: アップロード/保存/配置、意味付け提案→確認→動作、ライブラリ保存 | デモのシーン5 |
| M7 | 公開: GitHub Pages、Playwrightスモーク | スマホでURLを開ける |

## 8. やらないこと（削除した機能）

旧 Software PLC（FBDブロックキャンバス、Python FastAPIランタイム、Pythonカスタムブロック/サンドボックス、WebSocket I/Oパネル）はすべて撤去。
MVP後に再検討: 分岐/合流、ロボット、NG排出、STインタプリタ、PLCopen XML出力、実PLC接続、マルチユーザー。
