# 階層(グループ)機能 — プログラムJSONの書式

Software PLC のプログラムJSONに「装置 → 工程 → 動作 → 機能」のような可変階層の
グループ構造を定義するための書式です。**階層は表示・ドリルダウン専用**で、実行エンジン
(`backend/plc/runtime.py` / `graph.py`)は階層を一切認識しません。ロード時に
`backend/plc/graph.py` の `flatten_program()` が再帰的にフラット化し、従来と同じ
フラットな実行グラフに変換します。

対象読者: プログラムJSONを書く/生成する開発者・AIアシスタント。フロントエンドの
表示側の詳細は `frontend/src/store/plcStore.ts` / `frontend/src/components/GroupNode` を参照。

## 1. グループノードの定義

既存の `NodeDefinition`(`backend/plc/models.py`)に以下のフィールドが追加されています。
`type: "group"` のノードだけがこれらのフィールドを使います。

```jsonc
{
  "id": "machine1",
  "type": "group",
  "label": "搬送装置",
  "kind": "装置",                 // 自由記述: 装置/工程/動作/機能 など。UIのバッジ色分けに使用
  "position": {"x": 0, "y": 0},   // 親レベルでのキャンバス位置(通常ノードと同じ)
  "inputs": [
    {"id": "start", "name": "Start", "data_type": "bool"}
  ],
  "outputs": [
    {"id": "running", "name": "Running", "data_type": "bool"}
  ],
  "children": {                   // ProgramGraph と同じ形 (nodes + edges)
    "nodes": [ ... ],
    "edges": [ ... ]
  }
}
```

- `inputs` / `outputs` はグループが外部に見せる境界ポート。`id` はグループ内の
  エッジから `$parent` 経由で参照される安定キー(`name` は表示用ラベル、`data_type`
  は `bool` | `int` | `float`)。
- `children` は通常の `ProgramGraph`(`{"nodes": [...], "edges": [...]}`)。
  子ノードはさらに `type: "group"` にでき、**ネストの深さに制限はありません**。
- グループは親レベルでは1つの大きなブロックとして表示され、他の通常ノードと同様に
  `edges` の `source`/`target` に `id`(この例では `machine1`)を指定して配線します
  (ハンドルIDはグループの `inputs`/`outputs` の `id` を使う)。

## 2. `$parent` 参照記法(境界ポートの配線)

グループの `children.edges` の中で、グループ自身の境界ポートを参照するために予約
ノードid **`$parent`** を使います。`handle` にはそのグループの `inputs`/`outputs`
の `id` を指定します。

```jsonc
"children": {
  "nodes": [
    {"id": "sr1", "type": "SR", "position": {"x": 0, "y": 0}}
  ],
  "edges": [
    // グループの入力ポート "s_in" を内部ノード sr1.S に配線(パススルー)
    {"id": "e1", "source": "$parent", "source_handle": "s_in", "target": "sr1", "target_handle": "S"},
    {"id": "e2", "source": "$parent", "source_handle": "r_in", "target": "sr1", "target_handle": "R"},
    // 内部ノード sr1.Q をグループの出力ポート "q_out" に配線(パススルー)
    {"id": "e3", "source": "sr1", "source_handle": "Q", "target": "$parent", "target_handle": "q_out"}
  ]
}
```

- `source: "$parent", source_handle: <input_port_id>` = 「グループの入力ポートから
  この内部ノードへ」
- `target: "$parent", target_handle: <output_port_id>` = 「この内部ノードからグループの
  出力ポートへ」
- `source` と `target` の両方が `$parent` のエッジ(直結パススルー、内部ロジックなし)
  もサポートされています。
- 同じ入力ポートを複数の内部ノードに配線(ファンアウト)、複数の内部ノードの出力を
  同じ出力ポートにまとめる、なども可能です。

## 3. フラット化の挙動(実行時)

- `flatten_program()`(`backend/plc/graph.py`)がロード時に再帰的に展開します。
  子ノードidは **親のidをパス区切り文字 `/` で連結**して一意化します
  (例: `machine1/process_feed/sr1`)。グループがネストしている場合は
  `machine1/process_feed/startstop_action/sr1` のように深さ分連結されます。
- グループノード自身はフラット化後のグラフには一切残りません。境界ポートは
  完全に配線パススルーとして解決され、外部からグループの入力ポートに繋がる信号は、
  そのポートを参照する内部ノードの入力に直結されます(出力も同様、ネストを貫通して
  解決されます)。
- **`GET /api/program` は元のネスト構造をそのまま返します**(フロント表示用)。
  フラット化はあくまで内部実行表現であり、`runtime.get_program()` は
  `load_program()` に渡された元の `ProgramGraph` を保持します。
- WebSocket (`/ws`) の状態配信・`GET /api/debug/state` / `GET /api/debug/events` は
  従来通り**フラットなノードパス単位**です(例:
  `machine1/process_feed/y_feed`)。`POST /api/io/{node_id}` などのAPIも
  フラットパスで指定します。
- 既存のフラットなプログラム(`type: "group"` を含まないもの、例:
  `examples/start_stop.json`)は `flatten_program()` を通しても完全に無変更で
  出力されるため、後方互換です(`backend/tests/test_hierarchy.py::
  test_flatten_preserves_plain_program_unchanged` で検証)。

## 4. サンプル

`examples/conveyor_machine.json` に3階層のサンプルがあります。

```
machine1 (装置: 搬送装置)
├─ process_feed (工程: 供給工程)
│   ├─ startstop_action (動作: スタートストップ動作)
│   │   └─ not1, sr1 (機能ブロック)
│   └─ y_feed (Y0 Feed Motor)
└─ process_transport (工程: 搬送工程)
    ├─ timer_action (動作: タイマー動作)
    │   └─ ton1 (機能ブロック)
    └─ y_transport (Y1 Transport Motor)
```

読み込み方法:

```bash
# 起動時デフォルトは従来通り examples/start_stop.json
# 切り替えは PUT /api/program に直接ProgramGraphを渡すか、
# 以下の便利エンドポイントで examples/ 内のファイルを名前指定でロードできる:
curl -X POST http://localhost:8000/api/program/examples/conveyor_machine/load
curl -X POST http://localhost:8000/api/program/examples/start_stop/load
curl http://localhost:8000/api/program/examples   # 一覧
```

検証:

- `backend/tests/test_hierarchy.py`: フラット化のユニットテスト(id一意化、
  ポートパススルー解決、2段ネスト、フラットプログラムの非破壊、E2E、
  `get_program()` のネスト保持)。
- `backend/scripts/scenarios/conveyor_hierarchy.json`: シナリオランナー用
  E2Eシナリオ(`python scripts/scenario_runner.py scripts/scenarios/conveyor_hierarchy.json`)。

## 5. フロントエンド側の対応(表示・ドリルダウン)

- `GroupNode` コンポーネント(`frontend/src/components/NodeTypes/GroupNode.tsx`)が
  グループを1つの大きなブロックとして描画します: ラベル、`kind` バッジ(装置/工程/
  動作/機能で色分け)、In/Outハンドル(ライブ値で色が変化)、内部の集約稼働
  インジケータ(内部の子孫出力のいずれかがONなら緑)、内部ブロック数。
- ダブルクリックで `usePLCStore` の `drillDown(groupId)` を呼び、現在の階層パス
  (`currentPath: string[]`)にそのグループidを積みます。パンくずバー
  (`frontend/src/components/Breadcrumb`)でクリックすると `navigateTo(index)` で
  該当階層に戻ります。
- 現在パス配下のノード/エッジは `getNodesAtPath(program, currentPath)` で
  `ProgramGraph`(ネスト構造そのまま)から都度算出されます。境界ポート
  (親の in/out)はグループ内表示時に入出力端子ノードとして描画されます。
- WSで届くフラットなパス(`machine1/latch1` など)は、現在表示中の階層プレフィックス
  (`currentPath.join('/') + '/'`)を使って対応する子ノードのローカルidにマッピング
  されます。グループブロックの集約状態は、そのグループ配下の全子孫ノードの出力値
  から計算されます(いずれかが `true` なら稼働中)。
