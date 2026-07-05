> **階層(グループ)機能**: プログラムJSONで「装置 → 工程 → 動作 → 機能」のような
> 可変階層を定義し、キャンバス上でドリルダウン表示する機能の書式・設計は
> [`docs/HIERARCHY.md`](docs/HIERARCHY.md) を参照してください。実行エンジンは
> ロード時にフラット化された階層を実行するため、本ドキュメントに記載の
> シナリオランナー / pytest / デバッグAPIの使い方はそのまま適用できます
> (フラットなノードパス、例: `machine1/process_feed/y_feed`、で指定します)。
>
> **リソース按分(タスクスケジューラ)/ HMI画面ビルダー**: PLCロジックより上位の
> control/hmi/viz タスク分割とCPU按分・デグレードポリシーは
> [`docs/RESOURCES.md`](docs/RESOURCES.md)、D&D HMI画面の書式は
> [`docs/HMI.md`](docs/HMI.md) を参照してください。関連テストは
> `backend/tests/test_scheduler.py`(仮想クロック、実時間待ちなし)。
>
> **ネットワーク管理(ポート分離)/ 実行プログラム監視**: 開発スタジオ(8000)・HMI配信
> (8010)・見える化配信(8020)をポートで分離し、別端末(タブレット・別PC)からHMI・
> 見える化だけを開けるようにする機能、およびネットワーク管理タブでの実行監視は
> [`docs/NETWORK.md`](docs/NETWORK.md) を参照してください。関連テストは
> `backend/tests/test_network.py`。
>
> **変数マネージャー(I/O名称変更・内部変数)**: I/O(X/Y)と内部変数(M/D相当)を統合した
> 一覧・編集・ライブ監視・強制書込のポップアップ画面、および `VAR_READ`/`VAR_WRITE`
> ブロックの仕様は [`docs/VARIABLES.md`](docs/VARIABLES.md) を参照してください。関連
> テストは `backend/tests/test_variables.py`。
>
> **シミュレーションタブ(模擬デバイス)/ シーケンサ検定機**: モーター・ランプ・押しボタン
> 等の模擬デバイスを画面上で操作する機能と、検定手順をライブ実行して合否判定する
> 「検定機」の仕組みは [`docs/SIMULATION.md`](docs/SIMULATION.md) を参照してください。
> **検定機はコードのハードコードではなく `backend/sim_rigs/*.json` の設定から作られる**
> のが最重要ポイントです。関連テストは `backend/tests/test_simulation.py`。

# 開発ワークフロー(スクショなしの動作評価)

このドキュメントは、Software PLC PoC の動作評価を「ブラウザのスクリーンショット」に頼らず、
**ログ / JSON 出力**だけで完結させるための手順をまとめたものです。すべて仮想クロック
(`backend/plc/clock.py` の `VirtualClock`)を使うため、TON/TOFF などの秒単位のタイマーも
実時間を待たずに一瞬で検証できます。

対象読者: このリポジトリの `backend/` を変更する開発者。

## 全体像

| 手段 | 用途 | 実行時間の目安 |
|---|---|---|
| `scripts/scenario_runner.py` | シナリオJSONを1本ずつ流し、JSONL形式の信号遷移ログ + pass/failサマリを出力 | 数ms |
| `pytest tests/` | エンジンの各ブロック(SR/TON/CTUなど)とE2E(スタート/ストップ回路)のユニットテスト | 1秒未満(全27件) |
| `GET /api/debug/state` / `GET /api/debug/events` | サーバー起動中のランタイムの内部状態・信号遷移を curl で確認 | - |

いずれも**実時間の `sleep` を伴いません**。仮想クロックを明示的に進める(`advance_ms`)ことで
時間経過をシミュレートします。

---

## 1. シナリオランナー (`backend/scripts/scenario_runner.py`)

### 使い方

```bash
cd backend
python scripts/scenario_runner.py scripts/scenarios/start_stop_basic.json
python scripts/scenario_runner.py scripts/scenarios/stop_priority.json
python scripts/scenario_runner.py scripts/scenarios/ton_timer.json

# 複数まとめて(シェルのglob展開に依存)
python scripts/scenario_runner.py scripts/scenarios/*.json
```

HTTPサーバーやブラウザは一切起動しません。`PLCRuntime` を直接インポートし、`VirtualClock` で
駆動します。

### シナリオJSONの書式

```jsonc
{
  "program": "../examples/start_stop.json",  // このシナリオファイルからの相対パス
  "scan_interval_ms": 100,                    // 省略時はランタイムのデフォルト(100ms)
  "steps": [
    {"set": {"x_start": true}},               // DigitalInput ノードIDに値を設定
                                               // (反映されるのは次のスキャンから)
    {"advance_ms": 100},                      // 仮想クロックを進め、scan_interval_ms 刻みで
                                               // スキャンを実行(タイマーの経過時間が積算される)
    {"expect": {"y_motor.OUT": true}},        // "node_id.port" 形式でアサーション
    {"advance_ms": 3000},
    {"expect": {"y_done.OUT": true}}
  ]
}
```

- `expect` のキーは `"node_id.port"`。ポートを省略した bare な node_id
  (DigitalInput/DigitalOutput)は `.OUT` が補われます。
- `set` は複数キーを同時指定可能です。
- `set` した値は次のスキャン(現在の仮想時刻のまま1回スキャンを実行)で反映されます。
  `advance_ms` を挟まずに `expect` するとまだ反映されていない場合があるので注意してください
  (下記「はまりどころ」参照)。

### 出力

信号が変化するたびに1行のJSON (JSONL) が標準出力に流れます:

```json
{"t_ms": 3100.0, "scan": 31, "signal": "y_done.OUT", "old": false, "new": true}
```

成功時は最後に1行サマリが出力されます:

```json
{"result": "pass", "scenario": "scripts/scenarios/start_stop_basic.json", "steps": 19, "checks": 10, "duration_ms": 3.23}
```

失敗時(`expect` の不一致)は標準エラーに差分が出力され、プロセスは非ゼロ終了コードで終了します:

```json
{"result": "fail", "scenario": "...", "scan": 35, "t_ms": 3200.0, "mismatches": [{"signal": "y_motor.OUT", "expected": false, "actual": true}]}
```

### 既存シナリオ

`backend/scripts/scenarios/` に3本用意されています。いずれも `examples/start_stop.json`
(X0=Start, X1=Stop, SR ラッチ→Y0=Motor、同時に3秒のTONタイマー→Y1=Done)を対象にしています。

- `start_stop_basic.json`: 基本的な起動/停止の往復
- `stop_priority.json`: SR (Set優先) のセット/リセット同時入力時の挙動
- `ton_timer.json`: TONタイマーが3秒でY1をONにし、リセットでクリアされる挙動

**配線上の注意 (重要)**: `examples/start_stop.json` の SR ラッチは `R` 入力を
`NOT(x_stop)` から受けています。これはエッジトリガーではなく**毎スキャン継続的**に
効くので、「x_stop が False の間は R が True」になります。SR は Set優先のため:

- `x_start` を保持している間は S が勝ち、モーターはONのまま
- `x_start` を離すと、`x_stop` が False(デフォルト)なら R=True となり、
  即座にラッチがリセットされる(「離す=停止」という素朴な直感とは異なる)
- ラッチを保持したまま `x_start` だけ離したい場合は `x_stop` を True に
  保持する必要がある(R=False になるため)

詳細は各シナリオファイルの `_comment` フィールドと `stop_priority.json` を参照してください。

---

## 2. pytest によるユニットテスト (`backend/tests/`)

### セットアップ

`pytest` / `pytest-asyncio` / `httpx` (FastAPI TestClient用) が必要です。既存の
`requirements.txt` は変更していないので、開発時は追加で以下をインストールしてください:

```bash
cd backend
pip install -r requirements-dev.txt
# 権限エラーが出る場合:
pip install --user -r requirements-dev.txt
```

### 実行

```bash
cd backend
python -m pytest tests/ -q
```

実行時間の目安: **27件・1秒未満**(仮想クロックのみ使用、実時間の待機なし)。

`backend/pytest.ini` で `asyncio_mode = auto` を設定済みなので、`async def test_...` を
そのまま(デコレータなしで)書けます。

### テストファイル構成

- `tests/conftest.py`: `Harness` クラス(`PLCRuntime` + `VirtualClock` の薄いラッパー)と
  `make_program()` / `load_example_program()` ヘルパー
- `tests/test_sr_latch.py`: SR (Set優先) / RS (Reset優先) フリップフロップの基本動作
- `tests/test_ton_timer.py`: TON (オンディレイ) タイマーの経過時間・ON遷移・リセット
- `tests/test_ctu_counter.py`: CTU (カウントアップ) カウンターの立ち上がりエッジ検出・リセット
- `tests/test_start_stop_e2e.py`: `examples/start_stop.json` を実際にロードしたE2Eテスト
  (SR配線の癖を含む)
- `tests/test_debug_api.py`: `/api/debug/state`, `/api/debug/events` と既存API
  (`/api/catalog`, `/api/program`)の疎通確認(FastAPI `TestClient` 使用)

### はまりどころ: `set_io` の反映タイミング

`PLCRuntime.set_io(node_id, value)` は次のスキャンからしか反映されません。
テストで値をセットした直後に `advance()` だけ呼ぶと、タイマーの起点が1スキャン分
ずれることがあります。`tests/test_ton_timer.py` のように、

```python
h.set_io("in1", True)
await h.scan()      # ここで反映させてから
await h.advance(3000)  # 経過時間を積算する
```

という2段階にするのが安全です(シナリオランナーの `{"set": ...}` ステップも内部で
同じことをしています)。

---

## 3. デバッグAPI (`GET /api/debug/state`, `GET /api/debug/events`)

サーバーを起動した状態で、ブラウザを開かずに curl だけで現在の実行状態を確認できます。

### サーバー起動

```bash
cd backend
python -m uvicorn main:app --port 8001
```

(デフォルトの8000番が使用中の場合はポートを変えてください。起動時に
`examples/start_stop.json` が自動ロードされます。)

### `GET /api/debug/state`

現在の全入出力・各ノードの内部状態・スキャン回数を1つのJSONで返します。

```bash
curl -s http://localhost:8001/api/debug/state
```

```json
{
  "scan_index": 26,
  "now_ms": 1783125171239.72,
  "io_values": {},
  "outputs": {
    "x_start": {"OUT": false},
    "sr1": {"Q": false},
    "ton1": {"Q": false, "ET": 0.0},
    "y_motor": {"OUT": false},
    "y_done": {"OUT": false}
  },
  "node_states": {
    "sr1": {"q": false},
    "ton1": {"start_time": null}
  }
}
```

I/Oを変更して反映を確認する例:

```bash
curl -s -X POST http://localhost:8001/api/io/x_start -H "Content-Type: application/json" -d '{"value": true}'
sleep 0.5
curl -s http://localhost:8001/api/debug/state
# => "y_motor": {"OUT": true} になっているはず
```

### `GET /api/debug/events?since=<n>`

直近の信号遷移イベント(リングバッファ、最大1000件)を返します。シナリオランナーの
JSONL出力と同じ形式 (`seq`, `t_ms`, `scan`, `signal`, `old`, `new`) で、`since` に
前回取得した `last_seq` を渡すことで差分ポーリングができます。

```bash
curl -s "http://localhost:8001/api/debug/events?since=0"
```

```json
{
  "events": [
    {"seq": 1, "t_ms": 1783125168711.2, "scan": 0, "signal": "x_start.OUT", "old": null, "new": false},
    {"seq": 8, "t_ms": 1783125168711.2, "scan": 0, "signal": "y_done.OUT", "old": null, "new": false}
  ],
  "last_seq": 8
}
```

以降は `since=8` のように直近の `last_seq` を渡せば、新規イベントのみ取得できます。

### サーバーの停止

`uvicorn` をフォアグラウンドで起動した場合は `Ctrl+C`。バックグラウンド起動した場合は
プロセスを `Stop-Process` (PowerShell) や `kill` (bash) で終了してください。

---

## AIプロバイダ設定 (Anthropic / Gemini)

AIアシスタント(`backend/ai/`)は Anthropic (Claude) と Google Gemini の両方に対応しています。
`backend/ai/providers.py` の `AIProvider` インターフェースを介して切り替わり、ツール定義・
システムプロンプト・ツール実行ロジック(`backend/ai/assistant.py`)はプロバイダ非依存です。

### 選択ロジック

1. 環境変数 `AI_PROVIDER=anthropic` または `AI_PROVIDER=gemini` が設定されていればそれに従う
2. 未設定の場合、`ANTHROPIC_API_KEY` があれば Anthropic、無くて `GEMINI_API_KEY` があれば
   Gemini を自動選択(両方ある場合は Anthropic 優先)
3. どちらのキーも無ければ従来通り「未設定」として振る舞う(`GET /api/ai/status` が
   `{"available": false, "provider": null}` を返す)

### Gemini実装の注意点

- 新規SDK依存を追加せず、既存の `httpx` で REST API
  (`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`)
  を直接叩いています(`GeminiProvider` in `backend/ai/providers.py`)。
- Anthropicのツールスキーマ(`input_schema`)はGeminiのfunction calling形式
  (`function_declarations` + `parameters`)に変換されます
  (`anthropic_tools_to_gemini`)。
- モデルは既定で `gemini-2.5-flash`(`GEMINI_MODEL` で変更可)。
- 会話履歴の形式がAnthropic(`messages`/`content`)とGemini(`contents`/`parts`、
  role="model")で異なるため、`run_assistant()` 内でプロバイダごとに変換しています。

### テスト

`backend/tests/test_ai_providers.py` は実APIを一切呼ばず、プロバイダ選択ロジック(env
組み合わせ)・ツールスキーマ変換の往復・Gemini応答(functionCall含む)のパースを、
`httpx.AsyncClient` 互換のフェイククライアントでモックして検証しています。

### フロントエンド表示

AIパネル(`frontend/src/components/AIPanel/`)右上に、現在設定されているプロバイダ名
(Anthropic / Gemini / 未設定)がバッジで表示されます(`GET /api/ai/status` を参照)。

---

## まとめ: 典型的な開発ループ

1. `backend/plc/nodes.py` や `backend/plc/runtime.py` を変更
2. `python -m pytest tests/ -q` で高速に回帰確認(1秒未満)
3. 変更が特定のシナリオに関わる場合は `python scripts/scenario_runner.py scripts/scenarios/xxx.json` で
   JSONL出力を目視確認
4. UIに関わる変更のみ、最後に実サーバー + ブラウザで見た目を確認(スクショはこの最終段階のみ)
