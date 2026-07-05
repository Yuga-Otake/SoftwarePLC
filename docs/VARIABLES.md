# 変数マネージャー — I/O(X/Y) + 内部変数(M/D相当)

I/O(DigitalInput=X / DigitalOutput=Y)と、キャンバス上のノードとは独立した「内部(ワーク)
変数」(三菱PLCのM/Dのようなもの)を統合的に一覧・編集・ライブ監視・強制書込できる、
どのタブからでも開けるポップアップ画面の書式とAPIです。フロントエンドの実装は
`frontend/src/components/VariablesModal/`、バックエンドは `backend/plc/models.py`
(`VariableDefinition`)・`backend/plc/runtime.py`(変数ストア)・`backend/plc/nodes.py`
(`VAR_READ`/`VAR_WRITE`)・`backend/api/routes.py` の `/api/variables*` エンドポイント。

対象読者: 変数モデル・VARブロック・変数APIを直接扱う開発者・AIアシスタント。

---

## 1. プログラムJSONの `variables` セクション

```jsonc
{
  "nodes": [ /* ... */ ],
  "edges": [ /* ... */ ],
  "variables": [
    {
      "id": "m1",              // プログラム内で一意なID
      "name": "counter1",      // 表示名(省略時はidがそのまま使われる)
      "type": "bool",          // "bool" | "number"
      "initial": false,        // プログラムロード時の初期値
      "comment": "説明コメント" // 任意
    }
  ]
}
```

- **後方互換**: 既存のプログラムJSON(`variables` キーが無いもの)はそのままロードでき、
  `variables` は空リスト扱いになります(`ProgramGraph.variables: list[VariableDefinition] = []`)。
- ロード時(`PLCRuntime.load_program`)に、各変数の値ストアが `initial` で初期化されます
  (`type` に応じて `bool`/`float` に強制変換)。

---

## 2. 実行エンジン: 変数ストアと信号パス規約

- `PLCRuntime._var_values: dict[var_id, value]` が実際の値を保持する、スキャン全体で
  共有される単一の辞書です。`PLCGraph.execute()` に `var_store=` として渡され、ノード
  パラメータの予約キー `_var_store` として各ノードへ注入されます(`_now_ms` と同じ仕組み)。
- **信号パス規約**: 既存の `"node_id.port"` 規約に合わせ、内部変数は擬似ノードid `var`
  ポート名=変数idとして `var.<id>` の形で表現されます。これにより:
  - `GET /api/signals` に `{"path": "var.m1", "node_id": "var", "port": "m1", ...}` として
    自動的に列挙される(HMIバインド・vizトレンド選択に**追加の特別対応なしで**現れる)
  - WebSocket状態配信(`state_update`)の `runtime` オブジェクトに `runtime.var.m1` として
    含まれる(`PLCRuntime.get_broadcast_state()`)
  - イベントログ(`/api/debug/events`, `/api/history/events`)・vizトレンド履歴
    (`/api/viz/history`)にも同じ信号パスで値遷移が記録される
- 内部変数の値変化は、ノード出力の変化と全く同じ扱いでイベントログ・トランジションリング
  バッファに記録されます(`_scan_cycle` 内でスキャン前後の値をdiffして検出)。

---

## 3. VARブロック (`VAR_READ` / `VAR_WRITE`)

`backend/plc/nodes.py` に追加された2種類のブロック(カタログにも自動的に載ります):

| type | パラメータ | 入力 | 出力 | 説明 |
|---|---|---|---|---|
| `VAR_READ` | `VAR_ID`(str): 変数id | なし | `OUT`: 変数の現在値 | 指定した内部変数の値を出力する |
| `VAR_WRITE` | `VAR_ID`(str): 変数id | `IN`: 書き込む値 | `OUT`: `IN`をそのままミラー | 指定した内部変数へ毎スキャン書き込む |

- 存在しない `VAR_ID` を参照した場合、**評価エラーでクラッシュせず**、安全なデフォルト値
  (`VAR_READ`は`False`、`VAR_WRITE`は書き込みをスキップしつつ`OUT`はIN値をミラー)を返し、
  そのノードのstateに `_warning` キー(例: `"unknown variable id: 'ghost'"`)を残します。
  `GET /api/debug/state` の `node_states` で確認できます。
- `VAR_WRITE` → `VAR_READ` の可視性: 同一スキャン内であれば、トポロジカル順序で先に実行
  された `VAR_WRITE` の書き込みは後続の `VAR_READ` から即座に見えます(同じ辞書オブジェクト
  を共有しているため)。トポロジカル順序が逆の場合でも、**次のスキャンでは確実に**見えます。
- フロントエンド(`frontend/src/components/NodeTypes/VarNode.tsx`)では、`VAR_ID` を
  自由入力ではなく既存の内部変数から選ぶドロップダウンとして表示します(store の
  `variableRows` を参照、変数マネージャーで追加した変数が即座に選択肢に反映されます)。

---

## 4. API

すべて `backend/api/routes.py` に実装。I/O(X/Y)と内部変数を統合した1つのビューを返します。

### `GET /api/variables`

I/O(DigitalInput/DigitalOutput全ノード)+ 内部変数の統合リストを返します。

```jsonc
[
  {
    "id": "x_start", "kind": "input", "name": "X0 Start", "type": "bool",
    "value": false, "comment": "", "editable_name": true, "editable_value": true
  },
  {
    "id": "y_motor", "kind": "output", "name": "Y0 Motor", "type": "bool",
    "value": false, "comment": "", "editable_name": true, "editable_value": false
  },
  {
    "id": "m1", "kind": "internal", "name": "counter1", "type": "number",
    "value": 3.0, "comment": "説明", "initial": 0,
    "editable_name": true, "editable_value": true
  }
]
```

- `kind`: `"input"`(X) / `"output"`(Y) / `"internal"`(内部変数)
- `editable_value`: 強制書込が可能かどうか(出力Yは常に`false` — 下記参照)
- 入力(X)の `value` は、実行中の値(`_io_values`、force-writeで即座に反映)を返します。
  過去に **`_current_outputs`(直近の完了スキャンの出力)から読んでいたため、force直後に
  即GETすると稀に反映前の値を返すレースコンディションがありました(BUG-006、下記QA_LOG
  参照)**。現在は `_io_values` を直接読むため、force直後のGETでも常に最新値が返ります。

### `POST /api/variables` — 内部変数の新規作成

```jsonc
// request
{ "id": "m1", "name": "counter1", "type": "number", "initial": 0, "comment": "" }
// id省略時は自動生成 (m_<hex>)。既存idと重複する場合は400。
```

### `PUT /api/variables/{id}` — 内部変数の定義更新

```jsonc
// request (すべて省略可、指定したフィールドのみ更新)
{ "name": "new_name", "type": "bool", "initial": true, "comment": "更新後コメント" }
```

`type` を変更した場合、現在のライブ値は新しい型に再変換されます(`initial` 自体は変更
されない限りリセットされません — 実行中の値を意図せず消さないため)。

### `DELETE /api/variables/{id}` — 内部変数の削除

内部変数のみ対象。I/O(X/Y)ノードの削除は既存のキャンバス/パレット操作
(`DELETE /api/program/nodes/{node_id}`)に委ねます。

### `POST /api/variables/{id}/force` — 強制書込

```jsonc
// request
{ "value": true }
```

- **内部変数**: 変数ストアへ直接書き込みます。
- **入力X**: 既存のI/O書込(`POST /api/io/{node_id}` と同等)。
- **出力Y**: **非対応(400を返す)**。出力は1スキャンだけの上書きが「次スキャンで
  ロジックにより即座に上書きされ直す」ため実用上の意味が薄く複雑になるだけ、という判断で
  読み取り専用としました(仕様からの判断: 詳細は本ドキュメント末尾)。

### `PUT /api/variables/{id}/rename` — 改名

```jsonc
// request
{ "name": "新しい名前" }
```

内部変数は表示名(`name`)を、I/O(X/Y)ノードはラベル(`label`)を更新します。
I/Oの**追加・削除**は本APIの対象外(既存のキャンバス/パレット操作を使用)。

---

## 5. フロントエンド

- **タブバー右端の「変数」ボタン**(`frontend/src/components/TabBar/`)は5つのモードタブ
  とは独立したボタンで、クリックするとモーダル(`VariablesModal`)をオーバーレイ表示します。
  どのタブがアクティブでも開けます(App.tsxのトップレベルにマウント)。Escキーまたは
  ×ボタンで閉じます。
- モーダル内は「入力X」「出力Y」「内部変数」の3セクション + 検索ボックス(名前・ID・
  コメントで絞り込み)。列: 名前(内部変数・I/Oラベルともに編集可)、型、初期値(内部変数の
  み編集可)、コメント(内部変数のみ)、現在値(WSでライブ更新、ONは緑バッジ)、強制書込
  (boolはトグルボタン、numberは入力欄+Setボタン、出力Yは「読取専用」表示)。
- 内部変数は「+ 内部変数を追加」フォームで新規作成、各行の✕ボタンで削除できます。
- 現在値は `usePLCStore` のWebSocket購読(`_applyWSUpdate`)から、`runtime.var.<id>` と
  I/O行の `runtime.<node_id>.OUT` を使って毎スキャンin-place更新されます(モーダルを
  開くたびに `/api/variables` を再フェッチする必要はありません)。
- **HMIビルダー・見える化タブとの連携**: 内部変数は `GET /api/signals` に自動的に
  現れるため、HMIウィジェットの信号バインドドロップダウン・vizタブのトレンド選択に
  追加対応なしで表示されます(§2参照)。

---

## 6. 信号ハブ — ロジック設計とシミュレーションリグの双方向紐付け

ロジック設計タブのノードid(=信号名)と、シミュレーションリグ/HMI画面が参照する信号名を
**どちらからも発見でき、どちらからも紐付けられる**ようにする機能群です。実装は
`backend/plc/rename.py`(ノードid改名+波及更新)、`backend/plc/signal_hub.py`(使用箇所
集計・未解決検出)、`backend/plc/simulation.py` の `resolve_signal_kind`/`rig_bindings`
(リグバインドの解決状態)。フロントは `VariablesModal`(使用箇所バッジ・未解決セクション)、
`BaseNode.tsx`/`GroupNode.tsx`(ノードid改名UI)、`SimulationTab/BindingPanel.tsx`
(リグのバインド編集)。

### 6.1 ノードid(信号名)の改名 — `POST /api/program/nodes/{node_id}/rename`

```jsonc
// request
{ "new_id": "x_pb1" }
// response
{
  "id": "x_pb1", "old_id": "x_pb1_old",
  "edge_refs_updated": 2,
  "updated_refs": { "sim_rigs": ["kentei_plc"], "hmi_screens": ["main"] }
}
```

- **検証** (`plc/rename.py::validate_new_id`): 既存ノードidと同じ命名規則
  (`^[A-Za-z_][A-Za-z0-9_]*$` — 先頭は英字/アンダースコア、以降は英数字/アンダースコアの
  み)。予約語(`var`, `$parent`)は拒否。新idが既存id(**グループ内も含めた全体**、
  `all_node_ids()`)と重複する場合は400。
- **エッジの張替え**: プログラム内の全エッジのsource/targetを新idに更新します
  (`rename_node_in_graph`)。**グループ(階層)内のノードも対象**——ノードが実際に宣言されて
  いる階層レベルのエッジのみ張り替えます(エッジは階層をまたいで直接ノードidを参照しない、
  docs/HIERARCHY.mdの`$parent`規約どおり)。
- **波及更新**: `backend/sim_rigs/*.json` と `backend/hmi_screens/*.json` を全て走査し、
  旧idを参照する `signal`/`drive_signal`/`reverse_signal`/`coil_signal`/`contact_signal`
  (デバイス)、`watch`/`set_input`(feedback_rules)、`exam.steps[].signal` を新idへ書き換えて
  ファイルへ保存します。`"var.<id>"` は内部変数の参照であり、ノードidの改名では**変更されま
  せん**。レスポンスの `updated_refs` に更新されたファイル名一覧が返ります。
- **実行中ランタイムへの反映**: `runtime.load_program()` を改名直後に呼ぶため、サーバー
  再起動なしで次スキャンから新idが有効になります。**現在アクティブなリグ**(メモリ上の
  `simulation_manager.active_rig`、ディスク上のJSONとは別オブジェクト)も同様に書き換える
  ため、実行中のシミュレーションセッションが古い信号名を参照し続けることはありません。
- **`POST /api/program/nodes` の `id` 指定**: ノード新規作成時に `id` を明示指定できるよう
  拡張(従来は自動採番のみ)。指定した場合は改名と同じ検証(命名規則・予約語・重複)を通り
  ます。リグバインド編集パネルの「入力ノードとして作成」ショートカットが使用します。

### 6.2 リグバインドの解決状態 — `GET /api/sim/rigs/{name}/bindings`

```jsonc
{
  "name": "kentei_plc",
  "bindings": [
    { "device_id": "pb1", "device_type": "pushbutton", "field": "signal",
      "signal": "x_pb1", "resolved": true, "kind": "input" },
    { "device_id": "pl3", "device_type": "lamp", "field": "signal",
      "signal": "x_pl3_unused", "resolved": false, "kind": "none" }
  ]
}
```

- `kind`: `"var"`(内部変数として解決) / `"input"`(DigitalInputノード) /
  `"output"`(それ以外のノード、出力ポートとして読む前提) / `"none"`(現在のプログラムに
  存在しない)。
- **`read_signal`(既存のシグナル読み書き)との違いに注意**: `read_signal` は未知のノードid
  でも強制I/Oストアへフォールバックして値を返す寛容な設計です(リグの仮想センサー信号など、
  実プログラムに存在しないノードを想定——docs/SIMULATION.md参照)。一方この
  `resolve_signal_kind`/`rig_bindings` は「**現在のプログラムに実在するか**」だけを厳密に
  判定します。そのため、`kentei_plc.json` のリレー接点信号(`ry_fwd_contact` など、実プロ
  グラムのノードではなくリグ内部だけの仮想信号)は意図的に「未解決」として報告されます——
  これは壊れたバインドではなく、リグ設計上の正常な仮想信号です。バインド編集パネルの赤
  マークはあくまで「今のプログラムのノード/変数としては見つからない」というシグナルであり、
  ネジ穴3/4のような**意図的な未配線デモ**(PL3/PL4)と、この**仮想信号**の両方を区別なく
  拾います(区別が必要な場合は`docs/SIMULATION.md`の信号パス規約を参照して手動判断)。
- `null`/未設定のフィールド(例: `reverse_signal: null` が多くのリグの標準構成)は
  bindings一覧に含まれません(未解決として報告しない)。
- 検定実行中(`exam.state == "running"`)は、フロントのバインド編集モードのトグル自体が
  無効化されます(サーバー側APIはロックしていません——フロント側の運用ルール)。

### 6.3 信号の使用箇所・未解決参照 — `GET /api/signals/usage`

```jsonc
{
  "signals": [
    { "path": "x_start.OUT", "node_id": "x_start", "port": "OUT", "data_type": "bool",
      "used_by": { "logic": 1, "hmi_screens": ["main"], "sim_rigs": ["motor_exam"] } }
  ],
  "unresolved": [
    { "path": "x_pl3_unused", "referenced_by": [{ "kind": "sim_rig", "name": "kentei_plc" }] }
  ]
}
```

- `signals[].used_by.logic`: そのノードidがsource/targetになっているエッジ数(グループ内も
  含めて集計、`plc/signal_hub.py::signals_usage_report`)。
- `signals[].used_by.hmi_screens`/`sim_rigs`: そのノードid(または`var.<id>`)を参照している
  HMI画面/シミュレーションリグのファイル名一覧(`backend/hmi_screens/*.json` /
  `backend/sim_rigs/*.json` を実走査)。
- `unresolved`: リグ/HMI画面が参照しているが現在のプログラムに存在しない信号(§6.2と同じ
  `resolve_signal_kind` を使用)。**同じ信号が複数ファイルから参照されている場合は1エントリ
  にまとめ**、`referenced_by` に全参照元を列挙します。
- 変数マネージャーモーダル(`VariablesModal`)は各行(入力/出力/内部変数)に使用箇所バッジを
  表示し、末尾に「未解決の参照」セクションを設けて、そこから直接「入力ノードとして作成」
  (`POST /api/program/nodes` に明示id指定)・「変数として作成」(`POST /api/variables`)
  できます。同じ作成ショートカットはシミュレーションタブのバインド編集パネルにもあります
  (同じAPI呼び出し)。

---

## 7. 仕様からの判断・補足

- **出力Y(DigitalOutput)を強制書込の対象外とした**: 要求仕様どおり「1スキャンだけの
  上書きは複雑なので内部変数と入力のみ対応」という判断を採用。出力は次スキャンで
  ロジック側の値に上書きされ直すため、UIで「読取専用」と明示しています。
- **I/Oの追加・削除は変数マネージャーの対象外**: 仕様どおり、改名のみ対応。追加/削除は
  既存のキャンバス(ドラッグ&ドロップ)・パレット操作に委ねています。
- **`var.<id>` という信号パス規約**: 既存の `"node_id.port"` 規約を壊さずに内部変数を
  統合するため、擬似ノードid `"var"` を採用しました。実在するノードidと衝突しないよう、
  `"var"` というノードidをユーザーが手動で使わない前提です(将来的に衝突検出を追加する
  余地はありますが、現状のノードid命名規則(パレットからの自動生成)ではまず衝突しません)。
- **ノードid改名の一意性チェックはプログラム全体でグローバル**: エンジン自体は同一idの
  重複をトップレベルでしか気にしません(BUG-005、後述のQA_LOG参照——後勝ちで静かに上書き)
  が、改名APIは新idが**ツリー全体(全グループ内含む)**で一意であることを要求する、より
  厳しい基準を採用しました。信号名は「発見可能な安定した名前」であることが本機能の目的
  そのものであり、異なる階層に同名ノードが存在すると信号ハブの「このidは何を指すか」が
  曖昧になってしまうためです。
- **リグ波及更新は「参照している全ファイル」を無条件で書き換える**: 改名時にどのリグ/
  HMI画面が実際にその信号を意図して使っているか(仕様上の関連)を判定する手段がないため、
  文字列としてold_idを参照している箇所は全て新id に置き換えます。誤って無関係な同名の
  信号(通常は起こりにくい——命名規則により)を書き換えてしまうリスクはありますが、
  逆に「更新し忘れて壊れたバインドが残る」方が発見しにくく害が大きいと判断しました。
- **リグバインド編集は仕様どおり検定実行中ロック**: サーバー側APIでは強制していません
  (`PUT /api/sim/rigs/{name}` 自体は検定中でも呼べる)——フロントの運用ルールとして
  `SimulationTab` がバインド編集トグルボタンを検定実行中は無効化するのみです。バックエンド
  でロックするとバインド編集以外の正当なユースケース(将来的な programmatic なリグ更新)
  まで巻き込む可能性があるため、UIレベルの抑制に留めました。
