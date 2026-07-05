# シミュレーションタブ / シーケンサ検定機

模擬デバイス(押しボタン・スイッチ・ランプ・モーター・数値インジケータ・コンベア・
ジグ・位置センサー・リレー・デジタルスイッチ)を画面上で操作し、実行中の `PLCRuntime` と
信号レベルで結線して動かすための機能です。加えて、「検定手順を自動実行して合否判定する」
**シーケンサ検定機**をここで動かせます。コンベア上をジグ(ワーク台)が実際に移動し、
ジグ上の特徴点(ネジ等。着脱可能)が物理センサに当たって反応する(センサーがONになり
PLC入力へ反映される)ところまでシミュレートできます。リレーデバイスにより「PLC出力→
リレーコイル→接点→モーター」という実配線も模擬できます(`backend/sim_rigs/
kentei_plc.json`が実物のシーケンサ検定盤を模したサンプルです)。

**最重要の設計方針**: 検定機は `backend/plc/simulation.py` にハードコードされた
「モーター検定」のような専用機能ではありません。この engine は

- どんなデバイスがあるか(`devices`。コンベア/ジグ/位置センサーも含む)
- センサーの模擬応答をどう作るか(`feedback_rules`)
- 検定の手順・合否条件は何か(`exam.steps`)

を一切知らない**汎用エンジン**で、これら全てを **`backend/sim_rigs/*.json`(リグ設定)**
から読み込んで解釈します。新しい検定機が欲しければ、コードを書く必要はなく、リグJSONを
1つ追加するだけです(下記「新しい検定機を作る」参照)。コンベア/ジグ/位置センサーの
物理挙動(位置積分・検出窓判定)もツール側は汎用の `PhysicsEngine` だけを持ち、
「ネジ」「コンベアの長さ」等の具体的な機械構成は一切知りません。

対象読者: `backend/plc/simulation.py` / `backend/api/sim_routes.py` /
`frontend/src/components/SimulationTab/` を変更する開発者、および新しいリグ(検定機)を
JSONで追加したい人。

---

## 全体アーキテクチャ

```
frontend/src/components/SimulationTab/
  index.tsx        … タブ本体。リグ一覧取得/選択/アクティブ化、検定start/abort、
                      exam statusを500msポーリング、ジグ原点復帰ボタン
  DeviceCanvas.tsx  … devices[] をレンダリング(押しボタン/スイッチ/ランプ/モーター/数値/
                      コンベア+ジグ+位置センサー)。信号値・sim_state(ジグ位置/センサー
                      状態)は WS 経由の共有ストア(usePLCStore)から読む
  ExamPanel.tsx     … exam.steps の実行状況(pending/running/pass/fail)+ 合否バッジ

backend/api/sim_routes.py   … HTTP層(薄い)。CRUD・activate/deactivate・exam start/status/abort・
                              GET /api/sim/state・POST /api/sim/jigs/{id}/reset
backend/plc/simulation.py   … 本体(FastAPI非依存、pytestで直接importして検証可能)
  - read_signal / write_signal      … 信号パス規約の読み書き(下記)
  - FeedbackRuleEngine               … feedback_rules を評価する汎用プラント模擬
  - PhysicsEngine                     … conveyor/jig/position_sensor の位置積分+窓検出
  - ExamRunner                       … exam.steps を実時間で1つずつ実行する汎用シーケンサ
                                        (reset_jig opでPhysicsEngineも操作)
  - SimulationManager (singleton)    … 「どのリグがアクティブか」「検定は実行中か」を管理、
                                        sim_state()でPhysicsEngineの動的状態を公開
backend/sim_rigs/*.json     … リグ定義(データ)。motor_exam.json, lamp_practice.json,
                              conveyor_exam.json(コンベア/ジグ/センサー実例)、
                              kentei_plc.json(リレー/ネジ着脱/DSW/7セグを含む
                              KENTEI-PLC検定盤実例)
```

`backend/main.py` の起動時(`lifespan`)に

```python
runtime.post_scan_hook = simulation_manager.feedback_tick
runtime.sim_state_provider = simulation_manager.sim_state
```

が設定されています。`post_scan_hook`は毎スキャン終了後に呼ばれ(アクティブなリグが
無ければ no-op)、`feedback_tick()`は内部で`PhysicsEngine.tick()`(位置積分+センサー
判定)→`FeedbackRuleEngine.tick()`の順に両方を駆動します。これにより「コンベア駆動信号
→ ジグが物理的に移動 → センサーが検出→PLC入力へ書込 → feedback_ruleでさらに別の入力へ
反映 → 次スキャンでロジックがそれを読む」というループ全体が1スキャンごとに回ります。
`sim_state_provider`は`PLCRuntime._hmi_task`(WS配信タスク)が`state_update`メッセージに
`sim_state`(ジグ位置/センサー状態)を同梱するためのフック -- `runtime.py`自体は
シミュレーション機能を一切知らないよう、`post_scan_hook`と同じ「注入可能フック」方式を
踏襲しています。

---

## 信号パス規約

`plc/simulation.py::read_signal` / `write_signal` は、他の機能(シナリオランナー、
`/api/debug/state` 等)と同じ規約を使います:

| 形式 | 意味 | 例 |
|---|---|---|
| `"var.<id>"` | 内部変数 | `"var.counter1"` |
| `"node_id.port"` | ノードの出力ポートを読む(読み取り専用) | `"y_motor.OUT"` |
| `"node_id"`(裸) | `DigitalInput` ノードの強制値。読み書き両方、既定ポートは `.OUT` | `"x_start"` |

デバイス(pushbutton/switch)は基本的に `DigitalInput` バックの信号に書き込み、
ランプ/モーター/数値インジケータは出力ポートや変数を読みます。

`DigitalInput` の `.OUT` を読む場合、次の完了スキャンを待たずに強制I/O値
(`runtime.get_io()`)を直接読みます。`set` した直後に `expect` しても古い値を見てしまう
レース(docs/QA_LOG.md の BUG-006 と同種)を避けるためです。

グラフに存在しないノードID(例: プログラムが宣言していない模擬センサー入力)を読む場合は
強制I/Oストアへフォールバックします。つまり `feedback_rules` の `set_input` は
実プログラムのノードである必要はありません(`motor_exam.json` の `x_motor_fb` がこの例)。

---

## リグJSON書式

```jsonc
{
  "name": "motor_exam",              // ファイル名(拡張子なし)と一致させる
  "title": "モーター起動停止検定機",   // UI表示用タイトル
  "description": "...",               // UI表示用説明文
  "target_program": "start_stop",     // 検定開始プリフライトチェックが参照する対象プログラム名
                                       // (下記「検定開始プリフライトチェック」参照)。
                                       // アクティブ化自体は自動ロードしない -- 一致しないまま
                                       // アクティブ化はできるが、検定開始時に不一致が検出される

  "devices": [ /* 下記 */ ],
  "feedback_rules": [ /* 下記 */ ],
  "exam": { "title": "...", "description": "...", "steps": [ /* 下記 */ ] }
}
```

`backend/plc/simulation.py::save_rig()` がAPI保存時に最低限の型検証を行います
(`devices`はlist、`feedback_rules`はlist、`exam`はdict、`exam.steps`はlist -- それ以外は
自由形式)。

### `devices[]` (デバイスtype一覧)

| `type` | 見た目 | 操作 | 追加フィールド |
|---|---|---|---|
| `pushbutton` | 円形の押しボタン | mousedown/upで一時的にON、離すとOFF(momentary) | `mode: "momentary"`(既定)。将来的に `"toggle"` も型上は許容。`color: "red"\|"amber"\|"blue"`で非押下時の色を変更可(既定は灰色。押下中は常に緑、KENTEI-PLCの非常停止PB風ボタンなどに使う純粋な見た目用フィールド) |
| `switch` | トグルスイッチ | クリックでON/OFFをトグル | - |
| `lamp` | 丸ランプ | 表示専用(信号がtrueなら点灯) | `color: "green"\|"amber"\|"red"\|"blue"`(既定green) |
| `motor` | 回転アニメ付き円 | 表示専用(信号がtrueなら回転アニメ+「運転中」表示) | - |
| `indicator_number` | 7segふうの数値表示、または本物の7セグ風表示 | 表示専用(number/booleanをそのまま表示、それ以外は`--`) | `style: "seven_seg"`で本物の7セグメント風描画(桁数は`digits`、既定2)に切替。省略時は従来の等幅フォント表示 |
| `conveyor` | ベルト(駆動中はストライプが流れる) | 表示専用。ジグを載せて動かす土台 | 下記「物理デバイス」参照 |
| `jig` | コンベア上を動く矩形(ワーク台) | 表示専用+ネジ(feature)はクリックで着脱可 | 下記「物理デバイス」「ネジ着脱」参照 |
| `position_sensor` | コンベア沿いの小さな検出器 | 表示専用(検出中は点灯) | 下記「物理デバイス」参照 |
| `relay` | リレー箱(コイル+接点表示) | 表示専用(コイル励磁でCOIL表示+接点表示が連動) | 下記「リレー」参照 |
| `digit_switch` | ▲▼付きの数値表示(DSW風サムホイールスイッチ) | ▲▼クリックで`min`〜`max`の範囲で値を増減、`signal`へ書込 | `digits`(桁数、既定1)、`min`(既定0)、`max`(既定9) |

共通フィールド: `id`(一意), `label`(UI表示名), `signal`(信号パス),
`position: {x, y}`(キャンバス上の絶対配置。省略時はフローレイアウトで並ぶ)。
`conveyor`/`jig`/`position_sensor`/`relay` は `position` を(コンベア・リレー自体を除き)
使わない -- ジグ・センサーは自分が乗る/沿う `conveyor` の座標系(mm)で位置が決まるため。

### `relay` (リレー: コイル→接点の実配線模擬)

実物のシーケンサ検定盤(KENTEI-PLC)を模した拡張。PLC出力(コイル)がリレーを励磁し、
その接点が別の信号(モーター駆動など)を実際に動かす、という実配線を模擬します。

```jsonc
{
  "id": "ry_fwd", "type": "relay", "label": "コンベア駆動リレー(正転)",
  "coil_signal": "y_ry_fwd.OUT",     // 監視するコイル信号(信号パス規約に従う)
  "contact_signal": "ry_fwd_contact"  // コイルがtruthyの間trueを書き込む接点信号
}
```

`PhysicsEngine._evaluate_relays()`(post_scan_hook経由で毎スキャン後に評価、他の物理
デバイスと同じ`tick()`に相乗り)が、`coil_signal`が真の間`contact_signal`へtrueを、
偽になれば即座にfalseを書き込みます。励磁遅延は無し(仕様上不要と判断)。

**コンベアをリレー接点経由で駆動する**: `conveyor`の`drive_signal`/`reverse_signal`に
リレーの`contact_signal`を指定すれば、「PLC出力→リレーコイル→接点→モーター」という
実配線をそのまま模擬できます(`backend/sim_rigs/kentei_plc.json`参照)。この用途のため、
`PhysicsEngine._advance_jig`は`drive_signal`と`reverse_signal`の**どちらか一方が
真であれば駆動**という判定に対応しています(正転リレー・逆転リレーという独立した2つの
駆動信号を持つ構成向け)。既存の`conveyor_exam.json`のような「`drive_signal`単体で
駆動要否を決め、`reverse_signal`は駆動中の向きだけを決める」という規約とも後方互換です
(`reverse_signal`が真ならその時点で駆動も真、という関係が保たれるため)。

### ネジ着脱 (`jig.features[].attached`)

ジグのネジ穴に相当する`features[]`の各要素に`attached`(既定true)を追加できます。

```jsonc
{
  "id": "jig1", "type": "jig", "conveyor": "conv1", "home_mm": 0, "size_mm": 120,
  "features": [
    { "id": "screw1", "type": "screw", "offset_mm": 10, "label": "ネジ穴1", "attached": true },
    { "id": "screw2", "type": "screw", "offset_mm": 40, "label": "ネジ穴2", "attached": false }
  ]
}
```

`attached: false`のネジは`position_sensor`の検出対象から完全に除外されます
(`detect: "feature"`のセンサーが素通りする、実物のネジ穴が空いている状態と同じ)。
フロントエンドは`attached`に応じてネジ(装着=明るい丸)/空き穴(未装着=暗い破線丸)を
描画し分け、検定実行中でなければクリックでトグルできます(`DeviceCanvas.tsx`の
`ConveyorDevice`)。

- **API**: `POST /api/sim/jigs/{jig_id}/features/{feature_id}` body
  `{"attached": true|false}` -- `PhysicsEngine.set_feature_attached()`を呼び、
  センサー状態も即座に再評価します(`reset_jig`と同じ「同期的に反映」方針)。不明な
  jig/featureは404。
- **exam op**: `{"op": "set_feature", "jig": "jig1", "feature": "screw2",
  "attached": false, "note": "..."}` -- 検定手順内で「このネジパターンで検定する」と
  固定するために使う(`kentei_plc.json`のステップ④〜⑦が実例)。不明なjig/featureは
  fail(`error: "unknown jig/feature: ..."`)。
- **動的状態**: `GET /api/sim/state`のjigsエントリに`features: {"<feature_id>":
  {"attached": true|false}}`が同梱されます(既存の`position_mm`に追加、後方互換)。

### レーン (`jig.features[].lane` / `position_sensor.lane`)

実機KENTEI-PLCと同様、ジグのネジ穴とセンサーを**コンベア進行方向に対して垂直(幅方向)に
並べる**ための拡張です。`features[]`の各要素と`position_sensor`デバイスの両方に、整数の
`lane`(0, 1, 2, ... -- 幅方向の何列目かを表す添字。省略時は既定で`0`)を追加できます。

```jsonc
// ジグ: 4つのネジ穴が全て同じoffset_mm(進行方向位置)、laneだけが0〜3で異なる
// = ジグを進行方向から見て一列に4つ並んだ穴(幅方向)という配置
{
  "id": "jig1", "type": "jig", "conveyor": "conv1", "home_mm": 0, "size_mm": 120,
  "features": [
    { "id": "screw1", "type": "screw", "offset_mm": 60, "lane": 0, "attached": true },
    { "id": "screw2", "type": "screw", "offset_mm": 60, "lane": 1, "attached": false },
    { "id": "screw3", "type": "screw", "offset_mm": 60, "lane": 2, "attached": true },
    { "id": "screw4", "type": "screw", "offset_mm": 60, "lane": 3, "attached": false }
  ]
}

// センサー: 4連、全て同じat_mm(ジグの4穴と同じ進行方向位置)、laneだけが異なる
// = コンベアを横切るブラケットに4個の検出器を取り付けたイメージ
{ "id": "sens1", "type": "position_sensor", "conveyor": "conv1", "at_mm": 450, "lane": 0, "detect": "feature", "signal": "x_sens1" }
{ "id": "sens2", "type": "position_sensor", "conveyor": "conv1", "at_mm": 450, "lane": 1, "detect": "feature", "signal": "x_sens2" }
{ "id": "sens3", "type": "position_sensor", "conveyor": "conv1", "at_mm": 450, "lane": 2, "detect": "feature", "signal": "x_sens3" }
{ "id": "sens4", "type": "position_sensor", "conveyor": "conv1", "at_mm": 450, "lane": 3, "detect": "feature", "signal": "x_sens4" }
```

**判定ルール**(`PhysicsEngine._evaluate_sensors`): `detect: "feature"`のセンサーは、
**自分の`lane`と一致するfeatureだけ**を検出対象にします(`sensor.get("lane", 0) !=
feat.get("lane", 0)`なら即スキップ)。したがってジグが同じ地点を通過しても、レーン0の
センサーはレーン1〜3のネジ穴を一切検出しません -- 実機の「各センサーが自分のレーンの
ネジ穴だけを見る」構成そのままです。`detect: "jig"`(両端リミットスイッチ等)は`lane`を
一切参照しません(ジグ本体そのものを検出する仕様なので、幅方向の区別が無意味なため)。

**後方互換**: `lane`を持たない既存のfeature/position_sensor(`conveyor_exam.json`、
`test_conveyor.py`のフィクスチャ等)は、双方とも暗黙のレーン0として扱われるため
(`.get("lane", 0)`の既定値が両者で揃っているため)、これまで通り検出し合います。
「センサー側だけ`lane`省略・feature側は明示的に`lane: 0`」のような片側だけ書いた
組み合わせも、両方とも実質レーン0として一致します。

**動的状態**: `GET /api/sim/state`のjigsエントリの各featureに`lane`も同梱されます
(`{"attached": true|false, "lane": <int>}`、既定0)。フロントエンドの
`DeviceCanvas.tsx`はこれを使い、同じ`offset_mm`/`at_mm`を共有する複数のfeature/
sensorをlane順に縦一列(進行方向に対して垂直な列)へ積んで描画します
(`groupByLane`ヘルパー)。laneが1種類しかない場合(旧来のrig)は従来通り1個の点として
描画されるため、既存rigの見た目は変わりません。

### 物理デバイス: `conveyor` / `jig` / `position_sensor`(位置積分 + 窓検出)

ジグ(ワーク台)がコンベア上を移動し、ジグ上の特徴点(ネジ等)が物理センサに当たって
反応する機能。`backend/plc/simulation.py::PhysicsEngine` が担当する、デバイス種別・
機械名を一切知らない汎用エンジンで、次の3種のdeviceだけを解釈します。

```jsonc
// コンベア: drive_signal がtruthyの間、正方向に speed_mm_s で駆動
{
  "id": "conv1", "type": "conveyor", "label": "搬送コンベア",
  "drive_signal": "y_motor.OUT",   // 駆動信号(信号パス規約に従う)
  "reverse_signal": null,           // 任意。ONなら逆方向に駆動
  "length_mm": 1000,                 // コンベア全長(mm)
  "speed_mm_s": 200,                  // 駆動中の速度(mm/s)
  "width": 480                        // UI描画幅(px)。省略時480
}

// ジグ: 指定コンベアに乗る。位置(mm)はジグ先頭基準
{
  "id": "jig1", "type": "jig", "label": "ジグA",
  "conveyor": "conv1",               // 乗る conveyor の id
  "home_mm": 0,                       // 原点位置(mm)。activate/reset_jigで戻る先
  "size_mm": 120,                      // ジグ本体の長さ(mm)。detect:"jig"判定に使用
  "at_end": "stop",                     // "stop"(既定、端で停止/クランプ) | "wrap"(周回)
  "features": [                          // ジグ先頭からのオフセットにある検出対象
    { "id": "screw1", "type": "screw", "offset_mm": 100, "label": "ネジ" }
  ]
}

// 位置センサー: at_mm ± window_mm/2 に対象が重なっている間 signal を true に書込
{
  "id": "sens1", "type": "position_sensor", "label": "ネジ検出LS",
  "conveyor": "conv1",                // 監視する conveyor の id
  "at_mm": 800,                        // センサー設置位置(mm)
  "window_mm": 12,                      // 検出窓の全幅(mm)。at_mm ± window_mm/2
  "detect": "feature",                   // "feature"(既定、featuresのみ検出) | "jig"(ジグ本体を検出)
  "sensor_style": "limit_switch",         // "limit_switch" | "proximity"(見た目の差のみ)
  "signal": "x_screw_det"                 // 検出中trueを書き込む信号パス
}
```

**物理モデル(位置積分)**: `PhysicsEngine.tick()` が(feedback_rulesと同じ
post_scan_hook経由で)毎スキャン後に1回呼ばれ、前回tickとの実時間差 `dt_s` を
`runtime.clock`(クロック抽象、テストではVirtualClock)から取得し、駆動中の各ジグの
位置を `position += speed_mm_s * dt_s`(逆転中は符号反転)で積分します。`at_end`が
`"stop"`(既定)なら `[0, length_mm]` にクランプ、`"wrap"`なら `% length_mm` で周回します。

**検出窓の判定(スイープ方式)**: センサーは対象の「現在位置」だけでなく、**直前tickから
今回tickまでに実際に通過した区間(スイープ区間)**が検出窓と重なるかで判定します
(`PhysicsEngine._evaluate_sensors`)。理由: スキャン周期(既定100ms)× 速度によっては
1tickでの移動量(例: 200mm/s × 100ms = 20mm)が検出窓(例: 12mm)より大きくなり得るため、
tick終了時点の位置だけを見る単純な点サンプリングでは対象が窓を跳び越えて素通りし、
検出漏れが起こり得ます。スイープ区間判定によりスキャン周期に関わらず検出漏れを防ぎます。

**ジグのリセット**: `POST /api/sim/jigs/{id}/reset` で1つのジグを `home_mm` へ即座に
戻せます(センサー状態も同時に再評価される)。`exam.steps` からは `{"op": "reset_jig",
"jig": "jig1"}` で同じ操作を検定手順の一部として実行できます(検定を再試行可能にする
ため -- 下記`conveyor_exam.json`参照)。リグの `activate()` および `start_exam()`
(`_reset_devices_to_default()`経由)は、既存のpushbutton/switch/feedback_rule状態と
同様に、**全ジグを home_mm へ・全position_sensorの信号をfalseへ**自動的にリセットします。

**動的状態の取得**: `GET /api/sim/state` が `{"jigs": {"<id>": {"position_mm": ...,
"features": {"<feature_id>": {"attached": true|false}}}}, "sensors": {"<id>": true|false},
"relays": {"<id>": true|false}}` を返します(`relays`とjigsの`features`は今回の拡張で
追加、いずれもキーが無い/空dictでも既存リグ(motor_exam/lamp_practice/conveyor_exam、
relay/jig featuresを持たない)は後方互換です)。加えて、WSの`state_update`メッセージにも
同じ形の `sim_state` キーが同梱されます(`hmi`タスクの配信周期に乗る -- フロントの
コンベア/ジグアニメーションが滑らかになるよう、ポーリングではなくWSを優先して読みます。
WS切断中は `SimulationTab`が`GET /api/sim/state`を200ms間隔でポーリングするフォール
バックに切り替わります)。

### `feedback_rules[]` (プラント模擬フック)

```jsonc
{
  "watch": "y_motor.OUT",     // 監視する信号
  "equals": true,              // この値と一致したら条件成立(省略時true)
  "delay_ms": 500,             // 条件成立からこのms後に反映
  "set_input": "x_motor_fb",   // 書き込み先信号(裸nodeIdまたはvar.<id>)
  "value": true,                // 条件成立時に書き込む値
  "revert_on_clear": true,     // 監視条件が崩れたら即座に revert するか
  "revert_value": false,        // 省略時は `not value` が使われる
  "note": "..."                 // ドキュメント用(実行に影響しない)
}
```

評価はレベルベース(`FeedbackRuleEngine.tick()`、毎スキャン後に呼ばれる)で、エッジ検出は
「条件が成立し続けた累積時間」だけで行うため、再入しても冪等です。

### `exam.steps[]` (検定手順)

`scripts/scenario_runner.py` と同じ `op` 語彙に、実時間実行用の `within_ms` /
`after_ms` を追加したものです。

```jsonc
{ "op": "set", "signal": "x_start", "value": true, "note": "① 起動PBを押す" }
{ "op": "expect", "signal": "y_motor.OUT", "value": true,
  "within_ms": 300, "after_ms": 0, "note": "② 300ms以内に起動すること" }
```

- `set`: 即座に信号へ書き込み、必ず成功扱い(pass)。
- `expect`: `signal` の値が `value` になるまで `poll_interval_ms`(既定20ms)間隔で
  ポーリングする。
  - `within_ms`(既定1000ms): このステップの計測開始からこのms以内に満たされなければ
    **タイムアウトでfail**。
  - `after_ms`(既定0ms): このms未満で既に満たされてしまったら **「早すぎ」でfail**
    (`motor_exam.json` のステップ③・⑦が実例。センサー応答や3秒タイマーが早発火して
    いないかを見る検定ならではのチェック)。
  - 両方同時に指定すると「`after_ms` 〜 `within_ms` の間で満たされること」という
    許容ウィンドウになる。
- `reset_jig`: `{"op": "reset_jig", "jig": "jig1", "note": "..."}` -- 指定したジグを
  即座に `home_mm` へ戻す(`PhysicsEngine.reset_jig`と同じ処理。センサー状態も再評価
  される)。ジグを持つリグの検定手順で、最後にジグを原点復帰させて次回実行に備える
  ためのステップとして使う(`conveyor_exam.json`のステップ⑨が実例)。指定した`jig`が
  存在しない、またはリグに物理デバイスが無い(`PhysicsEngine`未初期化)場合はfail
  (`error: "unknown jig: ..."`)。
- `set_feature`: `{"op": "set_feature", "jig": "jig1", "feature": "screw2",
  "attached": false, "note": "..."}` -- 指定したジグの指定featureの装着状態を即座に
  設定する(`PhysicsEngine.set_feature_attached`と同じ処理。センサー状態も再評価
  される)。ネジ着脱ができるリグの検定手順で「このネジパターンで検定する」と固定する
  ために使う(`kentei_plc.json`のステップ④〜⑦が実例)。指定した`jig`/`feature`が
  存在しない場合はfail(`error: "unknown jig/feature: ..."`)。

不明な `op` は即座にfail(`error: "unknown op: ..."`)。例外はどのステップでも捕捉され、
実行中のステップを fail 扱いにして安全に終了する(バックグラウンドタスクが無言で
死なないようにするため)。

---

## 検定ランナーの状態遷移

`ExamRunner.state`: `idle → running → (passed | failed | aborted)`

各ステップ(`StepResult.status`): `pending → running → (pass | fail)`
(abort時は実行中も含めて `pending` のままにして状態全体を `aborted` にする)

`SimulationManager.start_exam()` は `ExamRunner` を作った直後、`.run()` を
バックグラウンドタスクとして起動する**前**に `state = "running"` へ同期的に設定します。
これは `POST /api/sim/exam/start` の直後に `GET /api/sim/exam/status` を呼んでも
(イベントループがタスクをまだ1度も実行していなくても)`idle` が返ってしまわないようにする
ためです。

`activate()` / `deactivate()` はどちらも進行中・完了済みの `ExamRunner` を破棄します。
別のリグをアクティブ化した後に前のリグの合否バッジが残り続けるのを防ぐためです。

`start_exam()` は毎回 `_reset_devices_to_default()` を呼びます。すべてのデバイス入力
(pushbutton/switch)を `False` に、すべての `feedback_rules` の `set_input` を
`revert_value`(既定 `not value`)に戻し、`FeedbackRuleEngine` の遅延/ラッチ状態も
リセットします。これをしないと、前回の手動操作や前回の検定実行で `True` のまま残った
信号が `after_ms`(早すぎ判定)を偽陽性でfailさせてしまいます(実際の検定治具が毎回
既知の原点状態から始めるのと同じ理由)。

---

## API リファレンス (`backend/api/sim_routes.py`)

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/sim/rigs` | リグ名一覧(`backend/sim_rigs/*.json` のstem、ソート済み) |
| GET | `/api/sim/rigs/{name}` | リグ定義を1件取得。無ければ404 |
| PUT | `/api/sim/rigs/{name}` | リグ定義を保存(新規作成/上書き)。型不正なら400 |
| DELETE | `/api/sim/rigs/{name}` | リグ定義を削除。アクティブなリグを削除した場合は自動でdeactivate |
| GET | `/api/sim/active` | `{"active_rig": name\|null, "rig": {...}\|null}` |
| GET | `/api/sim/rigs/{name}/bindings` | 各デバイスの信号フィールドの解決状態(`resolved`/`kind`)を返す。現在のプログラムに存在しない信号を検出(下記「リグバインド編集」参照)。`name`が現在アクティブなリグの場合、リレーの`contact_signal`は`resolved: true, kind: "rig"`として報告される(下記「検定開始プリフライトチェック」参照) |
| POST | `/api/sim/rigs/{name}/activate` | リグをアクティブ化(feedback_rules・物理エンジンを結線、jig位置/センサーを初期化、examをリセット)。無ければ404 |
| POST | `/api/sim/deactivate` | アクティブなリグを解除(feedback_rules・物理エンジンの結線解除、進行中の検定をabort) |
| GET | `/api/sim/state` | `{"jigs": {"<id>": {"position_mm": ..., "features": {...}}}, "sensors": {"<id>": true\|false}, "relays": {"<id>": true\|false}}`。アクティブなリグが無い/物理デバイスが無ければ空dict |
| POST | `/api/sim/jigs/{jig_id}/reset` | 指定ジグを`home_mm`へ即座に戻す。不明なjig、またはアクティブなリグが無い場合は404 |
| POST | `/api/sim/jigs/{jig_id}/features/{feature_id}` | body `{"attached": bool}`。指定ジグの指定feature(ネジ等)の装着状態を即座に設定。不明なjig/feature、またはアクティブなリグが無い場合は404 |
| POST | `/api/sim/exam/start` | アクティブなリグの検定を開始(バックグラウンド実行)。body(任意)`{"force": bool}`(既定false)。アクティブなリグが無い/examが無い/既に実行中の場合は400。**未解決信号があり`force`が偽の場合は409**(下記「検定開始プリフライトチェック」参照) |
| GET | `/api/sim/exam/status` | `{"state", "title", "steps": [...]}`。検定を開始していなければ `state: "idle"` |
| POST | `/api/sim/exam/abort` | 実行中の検定を中止(未実行時も安全) |
| GET | `/api/program/current-name` | `{"name": string\|null, "node_count": int}`。現在ロード中のプログラム名(`POST /api/program/examples/{name}/load`経由でロードした場合のみ設定、それ以外は`null`)とノード数。シミュレーションタブのヘッダー表示・プリフライトの`current_program`表示に使用 |

フロントの `SimulationTab/index.tsx` は `/api/sim/exam/status` を500ms間隔でポーリングして
`ExamPanel` に反映します(ページ再読込後も進行状況を拾えるように、リグ切替時にも
再ポーリングを開始)。ジグ位置/センサー状態(`sim_state`)はWSの`state_update`メッセージに
同梱されたものを優先して使い(`plcStore.simState`)、WS切断中のみ`/api/sim/state`を200ms
間隔でポーリングするフォールバックに切り替わります。

---

## 検定開始プリフライトチェック(BUG-009対策)

**背景**: リグの`exam.steps`は`target_program`(下記「リグJSON書式」参照)を前提に書かれた
信号パスを参照します。しかし`target_program`は従来「参考情報(表示のみ)」で、実際に
ロードされているプログラムと一致しているかは検証されていませんでした。そのため、
例えば`start_stop`がロードされたまま`kentei_plc`リグ(`target_program: "kentei_machine"`)
をアクティブ化して検定を開始すると、手順が参照する信号(`y_ry_fwd.OUT`等)がプログラムに
存在せず、`read_signal`の寛容なフォールバック(未知ノードは強制I/Oストアへ)により
`set`ステップは見かけ上成功し、何ステップか進んだ先で初めて「timeout: expected True,
got None」という原因のわかりにくい不合格になっていました(BUG-009、docs/QA_LOG.md)。

**対策**: `POST /api/sim/exam/start`は検定を実際に開始する前に、`exam.steps`が参照する
全信号(`set`/`expect`の`signal`フィールド)を`resolve_signal_kind`で現在のプログラムに
対して解決を試みます(`plc/simulation.py::collect_exam_signals` /
`SimulationManager.preflight_exam`)。**1つでも未解決の信号があれば検定を開始せず
409 Conflict**を返します:

```jsonc
// FastAPIの慣例通りdetailキーの下にネストされる
{
  "detail": {
    "error": "unresolved_signals",
    "signals": ["y_ry_fwd.OUT", "var.screw_count", ...],
    "target_program": "kentei_machine",
    "current_program": "start_stop",  // 名前不明時は "(不明なプログラム, Nノード)" 形式
    "hint": "リグの対象プログラムをロードしてください"
  }
}
```

**例外(リグ提供信号)**: リレーの`contact_signal`・`feedback_rules[].set_input`・
`position_sensor.signal`は、たとえ現在のプログラムのノードとして存在しなくても
「リグ自身が提供する仮想信号」として解決済み扱いになります(`plc/simulation.py::
rig_provided_signals`)。これは`read_signal`が元々持っている寛容なフォールバック
(未知ノードは強制I/Oストアへ)と整合させるための措置で、これが無いと
`motor_exam.json`の`x_motor_fb`のような正規の仮想フィードバック信号が、
**正しい`target_program`(`start_stop`)がロードされていても**常に「未解決」と誤検出
されてしまいます。

**強制実行**: `{"force": true}`をbodyに含めると、プリフライトチェックをスキップして
従来通り検定を開始できます(判断済みの操作者向けの抜け道)。

**フロント側の挙動**(`SimulationTab/index.tsx`):
- **予防的バナー**: リグをアクティブ化した時点で`target_program`が設定されており、かつ
  そのリグの`bindings`(`GET /api/sim/rigs/{name}/bindings`)に未解決フィールドが
  1つでもあれば、検定開始を試みる前から警告バナーを表示します(「対象プログラム:
  kentei_machine(未ロード。現在: start_stop)」+「kentei_machine をロード」ボタン)。
- **409ダイアログ**: 実際に検定開始が409で拒否された場合、モーダルダイアログで
  target_program・現在のプログラム・未解決信号数と一覧を表示し、
  「\<target_program\> をロードして開始」(対象プログラムをロード→自動で検定を
  再試行)・「このまま強制実行」(`force: true`で再試行)・「キャンセル」の3ボタンを
  提供します。
- **ヘッダー表示**: シミュレーションタブのツールバーに現在ロード中のプログラム名を
  常時小さく表示(`GET /api/program/current-name`、`usePLCStore.currentProgramName`)し、
  リグの`target_program`と照合しやすくしています。
- プログラムが切り替わった(`currentProgramName`が変化した)タイミングで`bindings`を
  再取得するため、「対象プログラムをロードして開始」直後にリレーの赤い「!」マーカーが
  正しく消えます(切り替え前の古い解決状態を表示し続けない)。

---

## リグバインド編集(シミュレーション側からロジック設計信号への紐付け)

ロジック設計タブの信号名とリグの信号バインドを**どちらからも紐付けられる**ようにする機能
(docs/VARIABLES.md「6. 信号ハブ」の一部)。従来、リグの信号を実プログラムに合わせるには
サンプルJSON改造か手編集しかありませんでした。

- **有効化**: シミュレーションタブの「✎ バインド編集」トグルボタン(検定実行中は無効化)。
- **未解決信号の可視化**: `GET /api/sim/rigs/{name}/bindings`(`plc/simulation.py::
  rig_bindings`)が各デバイスの信号フィールド(`signal`/`drive_signal`/`reverse_signal`/
  `coil_signal`/`contact_signal`)の解決状態を返し、現在のプログラムに存在しない信号を
  参照しているデバイスには**編集モードのON/OFFに関わらず**赤い「!」マーカーが表示されます
  (例: `kentei_plc.json` の PB3/PB4/SS1/PL3/PL4 — 意図的な未配線デモ)。
- **バインド編集パネル**: 編集モード中にデバイスをクリックすると右側にパネルが開き、
  そのデバイスの信号フィールドごとに、`GET /api/signals` から取得した全信号(+内部変数)
  のドロップダウン、または自由入力で新しい信号パスを設定できます。保存は既存の
  `PUT /api/sim/rigs/{name}`(リグ全体を書き戻し)を使い、他のフィールド(devices の
  position 等)は変更せずそのまま送り返します。
- **その場作成ショートカット**: 未解決の信号フィールドには「入力ノードとして作成」
  (バインド値が`var.`で始まらない場合)または「変数として作成」(`var.<id>`の場合)
  ボタンが表示されます。前者は `POST /api/program/nodes`(`type: "DigitalInput"`, 明示
  `id`指定)、後者は `POST /api/variables`(明示`id`指定)を呼び、成功すると即座に
  bindings/signals を再取得して解決状態を更新します。
- **検定実行中は編集不可**: `SimulationTab` はバインド編集トグルボタンを
  `examStatus.state === "running"` の間disabledにします(サーバー側APIはロックしていません
  — 仕様からの判断、詳細はdocs/VARIABLES.md §7参照)。
- **`resolved`/`kind`の意味**: `read_signal`(既存のシグナル読み書き、上記「信号パス規約」
  参照)は未知のノードidでも強制I/Oストアへフォールバックする寛容な設計で、
  `rig_bindings`が使う`resolve_signal_kind`は基本的に「現在のプログラムに実在する
  ノード/変数か」を厳密に判定します(`kind: "var"|"input"|"output"|"none"`)。
  **例外(`kind: "rig"`)**: `name`が現在アクティブなリグの場合に限り、リレーの
  `contact_signal`(`ry_fwd_contact`等)は「リグ自身が提供する仮想信号」として
  `resolved: true, kind: "rig"`を返します(BUG-009対策、`plc/simulation.py::
  rig_provided_signals`参照)。プログラムのノードではないという点は変わりませんが、
  アクティブなリグが実際にその信号を毎スキャン書き込んでいる以上、赤マークで警告する
  意味がないための措置です。**リグが非アクティブな時にそのリグのbindingsを閲覧した
  場合は、この例外は適用されず`kind: "none"`(未解決)のままです**(まだ結線されて
  いないため)。`kentei_plc.json`のPB3/PB4/SS1/PL3/PL4のような意図的な未配線は、
  アクティブ/非アクティブに関わらず引き続き「未解決」として赤マーク対象です
  (詳細はdocs/VARIABLES.md §6.2)。

---

## 新しい検定機を作る(コードを書かずに)

`backend/sim_rigs/motor_exam.json` を例に、手順は以下の3つだけです。

1. **対象プログラムの信号名を把握する**: `GET /api/program` または
   `GET /api/debug/state` で、検定したいプログラム(`examples/*.json` からロードした
   もの)のノードID・ポート名を確認する。
2. **`backend/sim_rigs/<新しい名前>.json` を作る**(または `PUT /api/sim/rigs/<name>` で
   保存する):
   - `devices[]` に操作したい入力(pushbutton/switch)と見たい出力(lamp/motor/
     indicator_number)を並べる。`signal` は手順1で確認した信号パスを使う。
   - センサーのような「プログラムが直接持たない模擬フィードバック」が必要なら
     `feedback_rules[]` で `watch`(実出力)→ `set_input`(架空の入力信号名でよい)を
     定義する。
   - `exam.steps[]` に、検定員の操作手順をそのまま `set`/`expect` の列として書く。
     タイマーの応答時間チェックが要るステップには `within_ms`/`after_ms` を付ける。
3. **保存すると即座に `GET /api/sim/rigs` に出現する**(サーバー再起動不要)。
   シミュレーションタブでリグを選んでアクティブ化→検定開始で動く。

`backend/sim_rigs/lamp_practice.json` は「スイッチ1つ・ランプ1つ・feedback_rulesなし」の
最小構成の実例です。逆に `motor_exam.json` は feedback_rules(センサー模擬)と、
`after_ms`/`within_ms` を組み合わせた「早すぎても遅すぎてもfail」という時間窓判定の実例
になっています。`backend/sim_rigs/conveyor_exam.json` は conveyor/jig/position_sensor
(物理デバイス)+ feedback_rules + reset_jig を組み合わせた実例です(下記参照)。

### 配線上の注意点(motor_exam.json / conveyor_exam.jsonの例)

`examples/start_stop.json` のSRラッチは `R` 入力を `NOT(x_stop)` から**継続的に**受けて
います(エッジトリガーではない)。そのため検定手順で「起動PBを押す→離す」だけをすると、
離した瞬間に(`x_stop`が既定でFalseなら)R=Trueとなりラッチが即座にリセットされてしまい
ます。`motor_exam.json` のステップ④・⑤はこれを避けるため、起動PBを離す**前**に停止PBを
ONにしてラッチを保持しています(詳細は `DEV_WORKFLOW.md` の「配線上の注意」セクションと
同じ現象)。他のプログラムを対象にする場合も、ラッチ/リセットの結線がエッジ型か
レベル型かを`GET /api/program`で確認してから手順を組んでください。

`conveyor_exam.json` も同じ制約を受けます。「センサーが検出したら自動停止する」ためには
`x_stop`(=R入力のNOT対象)を**Falseに落とす**必要がある(Trueにするとラッチは逆に保持
される)ため、`feedback_rules`の`set_input: "x_stop", "value": false`という、一見直感に
反する配線になっています(コメント参照)。検定手順側も「運転保持スイッチ(X1)をONにして
ラッチを保持→起動PBを離す」という同じ手順を踏んでいます。

### コンベア搬送検定機(`conveyor_exam.json`)の実装ノート

「ジグ上のネジがセンサに当たって反応する」ことを実証するサンプル検定機です。
`examples/start_stop.json`(X0起動→SRラッチ→Y0モーター)のY0出力をコンベアの
`drive_signal`に流用し、ジグ(`home_mm=0`、ネジは`offset_mm=100`の位置)がコンベア上を
`speed_mm_s=200`で搬送され、`at_mm=800`の位置センサーへ到達すると検出信号
(`x_screw_det`)がONになります。ネジの初期絶対位置は100mm、センサーは800mm地点なので
搬送距離は700mm、200mm/sなら理論到達時刻は3500ms -- 検定手順のステップ⑦は
`after_ms=3000`/`within_ms=4500`でこれを検証します。検出信号は`feedback_rules`経由で
`x_stop`(運転保持入力)へ配線されており、センサーがPLCの入力として実際に動作へ反映
される(モーターが自動停止する)ことを実証します。最後に`reset_jig`ステップでジグを
原点へ戻し、検定を繰り返し実行できることも確認します。

### KENTEI-PLC 検定盤(`kentei_plc.json` + `examples/kentei_machine.json`)の実装ノート

実物のシーケンサ検定盤(OMRON系検定練習機)の写真を元に要望された拡張の集大成
サンプルです。`relay`(正転/逆転リレー2個)・`jig`のネジ着脱4穴(幅方向レーン0〜3、
上記「レーン」節参照)・両端リミットスイッチ+レーンごとに4連のネジ検出センサー・
PB1〜PB5・SS0/SS1・PL1〜PL4・`digit_switch`(DSW)・
`indicator_number(style: seven_seg)`(DPL1/DPL2)をすべて1つのリグに配置しています。

- **対象プログラム** `examples/kentei_machine.json`(フラット構成): PB1でSRラッチ
  (`sr_fwd`)をセットして正転リレーコイル(`y_ry_fwd`)を励磁、右端LS(`x_ls_right`)で
  もう一方のSRラッチ(`sr_rev`)をセットして逆転側へ切替、左端LS(`x_ls_left`)で両ラッチを
  リセットして全停止。**インターロック**は出力段で`AND(sr_fwd.Q, NOT(sr_rev.Q))`/
  `AND(sr_rev.Q, NOT(sr_fwd.Q))`を掛けて実現しており、万一両方のSRラッチが同一スキャンで
  同時にセットされても(`pb1`と`x_ls_right`が同時に真になるような極端なケース)、リレー
  コイル自体は絶対に同時励磁しません(`backend/tests/test_kentei.py::
  test_kentei_machine_forward_reverse_interlock_never_both_true`で固定)。
  **レーン別ネジ検出**: 4連センサー(`x_sens1`〜`x_sens4`、各々ジグの対応するレーンの
  ネジ穴だけを検出)の出力を、レーンごとに独立したSRラッチ(`lat_sens1`〜`lat_sens4`、
  S=対応するセンサー、R=`PB1 OR PB2`)で保持します -- ジグがセンサーを一瞬で通過しても
  検出結果を取りこぼさないため、かつ次回起動(PB1)時には必ずクリアされた状態から
  始めるためです。4つのラッチ出力は新設の**ADDブロック**(`backend/plc/nodes.py::
  ADDExecutor`、2〜4入力の数値/bool合算、bool入力は0/1として加算)で合算し、
  `var.screw_count`へ`VAR_WRITE`(DPL1表示)。PB2はいつでも全停止+ラッチ/カウント
  リセット。
- **リグ** `kentei_plc.json`: `conv1`(speed_mm_s=100)の駆動信号・逆転信号にリレーの
  `contact_signal`(`ry_fwd_contact`/`ry_rev_contact`)を指定 -- 「PLC出力→リレーコイル→
  接点→コンベア駆動」という実配線をそのまま模擬しています。ジグはネジ穴4つ
  (`screw1`〜`screw4`、全てoffset_mm=60でlaneのみ0〜3と異なる=幅方向一列、初期は
  screw1・screw3=レーン0・2のみ装着)、ネジ検出センサーは4連(`sens1`〜`sens4`、全て
  `at_mm=450`でlaneのみ異なる=ベルトを横切るブラケット状)。検定手順は`set_feature`で
  ネジ2本パターン(レーン0・2)を固定→PB1起動→正転リレー励磁+接点ON確認→往路で
  レーン0・2のセンサーのみ同時検出(レーン1・3は無反応)→ラッチ→ADD合算で
  screw_count=2確認→右端LSで逆転リレーへ切替(かつ正転リレー接点が同時にOFFである
  ことを確認、インターロックの実証)→復路でもラッチが保持されscrew_countは2のまま
  (往復で加算されるのではなく、レーンごとに1回ラッチされた本数を表示し続ける仕様)→
  左端LS帰着→両リレーOFF確認→PB2でラッチ・カウントを0へリセット→`reset_jig`、の
  26ステップです。
- **リレー経由駆動の物理エンジン対応**: `PhysicsEngine._advance_jig`は元々
  「`drive_signal`が真の間だけ駆動し、`reverse_signal`は駆動中の向きのみを決める」
  という`conveyor_exam.json`の規約でしたが、kentei_plc.jsonのように**正転リレー・
  逆転リレーという独立した2つの駆動信号**を持つ構成では、逆転リレー単体で(正転リレーを
  経由せず)駆動できる必要があります。そのため`driving = drive_signal OR
  reverse_signal`(どちらか一方が真であれば駆動)へ拡張しました。既存の
  `conveyor_exam.json`(`reverse_signal`が真の時は`drive_signal`も既に真、という前提の
  配線)への影響はありません(`backend/tests/test_kentei.py::
  test_two_relays_drive_forward_and_reverse_independently`で新しい規約を、
  `backend/tests/test_conveyor.py`の既存テスト群で後方互換を、それぞれ固定)。
- **ネジパターンを変えたときの挙動**: `set_feature`でネジ4本(4レーン)のうちどのレーンを
  装着済みにするかでscrew_countが変わります(APIから直接
  `POST /api/sim/jigs/jig1/features/{screw_id}`で着脱してから手動でPB1を押しても同様に
  反映されることをcurlで確認済み、下記参照)。3本装着(レーン0・1・2)ならscrew_count=3、
  4本全て装着ならscrew_count=4になります。

---

## テスト

- `backend/tests/test_simulation.py`(43件): リグCRUD・信号読み書き・
  `FeedbackRuleEngine`(遅延反映・revert・revert無し・reset)・`ExamRunner`(同梱リグ
  motor_exam/lamp_practiceが通しでpassすること、タイムアウトfail、`after_ms`早すぎfail、
  abort、状態遷移、不明op、`SimulationManager`のactivate/deactivate/start_exam例外系、
  API層(`/api/sim/*`のHTTPスモークテスト))を、`VirtualClock`+実sleepなしのスタブで
  検証(実時間待機なし)。
- 意図的な不合格パスの再発防止:
  `test_exam_runner_fails_when_program_never_satisfies_expect`
  (`within_ms`タイムアウト)、`test_exam_runner_after_ms_too_early_is_a_failure`
  (`after_ms`早すぎ判定)。
- `backend/tests/test_conveyor.py`(28件): `PhysicsEngine`の位置積分(駆動ON/OFF・
  逆転・`at_end`の`stop`/`wrap`)、`position_sensor`の検出(`detect: "feature"/"jig"`・
  検出窓のスイープ判定・通過後OFF)、`reset_jig`(エンジンメソッド・exam op・API の3経路)、
  `SimulationManager`統合(`feedback_tick()`が物理エンジン→feedback_rule engineの順で
  両方を毎回駆動すること、activate/deactivateでの初期化)、`conveyor_exam.json`の
  ヘッドレス完走(`SimulationManager.activate()`/`start_exam()`経由)、HTTP層
  (`/api/sim/state`、`/api/sim/jigs/{id}/reset`)。全て`VirtualClock`駆動(実sleepなし)。
- `backend/tests/test_kentei.py`(52件): `relay`デバイス(コイル→接点の即時反映、
  接点経由でconveyorが駆動されること、正転/逆転2リレーがそれぞれ独立に駆動できること)、
  ネジ着脱(`attached`のデフォルト・検出除外・`set_feature_attached`のライブ切替・
  exam op `set_feature`・`GET /api/sim/state`への反映)、
  **レーン**(`lane`一致/不一致でのfeature検出フィルタ、4連センサーが装着レーンのみ
  同時検出、`detect: "jig"`はlaneを無視、`lane`未指定は両側とも暗黙のレーン0として
  後方互換に振る舞う、`GET /api/sim/state`のfeatureエントリへの`lane`同梱)、
  **ADDブロック**(`backend/plc/nodes.py::ADDExecutor`のbool/数値合算・2入力使用時の
  未接続ポート無視・整数和がintのまま返ること・カタログ登録)、`digit_switch`の書込経路、
  `examples/kentei_machine.json`のPLCロジック(PB1でのラッチ、右端LSでの正転→逆転切替、
  左端LSでの全停止、PB2でのラッチ/カウントリセット、レーン別ラッチが検出パルス消失後も
  保持されること、PB1が前回分のラッチを一斉クリアすること、
  正転/逆転インターロックが同一スキャンでの同時セットでも破られないこと)、
  `kentei_plc.json`のヘッドレス完走(`SimulationManager`直接操作・`activate()`/
  `start_exam()`経由の両方、レーン別検定手順込み)、HTTP層(ネジ着脱API・
  `GET /api/sim/state`の`relays`キー・`POST /api/program/examples/kentei_machine/load`)、
  **検定開始プリフライトチェック**(BUG-009対策。start_stopがロードされたままの
  409+`signals`/`target_program`/`current_program`、kentei_machineロード後の200開始、
  `force: true`での強制開始、`preflight_exam()`が正しいプログラムでは空リストを返すこと・
  誤ったプログラムでは実際の不足信号を返すこと、`bindings`エンドポイントの
  `contact_signal`が「アクティブ時のみkind: "rig"」であること)。
  全て`VirtualClock`駆動(実sleepなし)。
- `backend/tests/test_binding.py`(38件、新規、信号ハブ機能): ノードid改名
  (`rename_node_in_graph`のトップレベル/ネスト済みグループでのエッジ張替え、
  `validate_new_id`の命名規則/予約語拒否、`POST /api/program/nodes/{id}/rename`の
  HTTPスモーク、リグ/HMI画面ファイルへの波及更新、アクティブなリグのメモリ内書き換え)、
  `POST /api/program/nodes`の明示id指定(重複/不正id拒否含む)、
  `GET /api/sim/rigs/{name}/bindings`の解決状態(input/output/var/noneそれぞれ)、
  `GET /api/signals/usage`のused_by集計・unresolved検出(複数ファイルからの同一未解決
  参照が1エントリにまとまること含む)。詳細はdocs/VARIABLES.md「6. 信号ハブ」参照。

```bash
cd backend
python -m pytest tests/test_simulation.py tests/test_conveyor.py tests/test_kentei.py -q
```

## 実サーバーでの手動確認例(curl)

```bash
# start_stopプログラムがロードされていることを確認
curl -s http://localhost:8000/api/program

# motor_examリグをアクティブ化
curl -s -X POST http://localhost:8000/api/sim/rigs/motor_exam/activate

# 検定を開始し、ステータスをポーリング
curl -s -X POST http://localhost:8000/api/sim/exam/start
curl -s http://localhost:8000/api/sim/exam/status   # state: running → ... → passed

# 後片付け
curl -s -X POST http://localhost:8000/api/sim/deactivate
```

### コンベア/ジグ/センサーの確認例(conveyor_exam.json)

```bash
# conveyor_examリグをアクティブ化(ジグ位置がhome_mmへ初期化される)
curl -s -X POST http://localhost:8000/api/sim/rigs/conveyor_exam/activate
curl -s http://localhost:8000/api/sim/state   # {"jigs":{"jig1":{"position_mm":0.0}},"sensors":{"sens1":false}}

# 検定を開始し、ジグ位置をサンプリング(搬送中は約200mm/sで増加し、
# センサー到達→自動停止→reset_jigで0mmへ戻るまでが1回のcurlループで観測できる)
curl -s -X POST http://localhost:8000/api/sim/exam/start
for i in $(seq 1 10); do curl -s http://localhost:8000/api/sim/state; echo; sleep 0.3; done
curl -s http://localhost:8000/api/sim/exam/status   # state: passed、全10ステップpass

# 個別にジグをリセットしたい場合
curl -s -X POST http://localhost:8000/api/sim/jigs/jig1/reset

# 後片付け
curl -s -X POST http://localhost:8000/api/sim/deactivate
```

### KENTEI-PLC検定盤の確認例(kentei_plc.json)

```bash
# 対象プログラムをロードしてからリグをアクティブ化(kentei_plcはtarget_programが
# kentei_machineだが、自動ロードはしないので手動でロードする)
curl -s -X POST http://localhost:8000/api/program/examples/kentei_machine/load
curl -s -X POST http://localhost:8000/api/sim/rigs/kentei_plc/activate
curl -s http://localhost:8000/api/sim/state
# => {"jigs":{"jig1":{"position_mm":0.0,"features":{
#     "screw1":{"attached":true,"lane":0},"screw2":{"attached":false,"lane":1},
#     "screw3":{"attached":true,"lane":2},"screw4":{"attached":false,"lane":3}}}},
#     "sensors":{"ls_left":true,"ls_right":false,
#                 "sens1":false,"sens2":false,"sens3":false,"sens4":false},
#     "relays":{"ry_fwd":false,"ry_rev":false}}
# -- lane 0とlane 2のみ装着(デフォルトパターン)

# ネジパターンをAPIから直接変更(レーン1も装着=3本パターンにする)
curl -s -X POST http://localhost:8000/api/sim/jigs/jig1/features/screw2 \
  -H "Content-Type: application/json" -d '{"attached": true}'
curl -s http://localhost:8000/api/sim/state   # screw2(lane 1).attached: true に即反映

# PB1で手動往復させ、screw_countが3になることを確認(var.screw_countはGET /api/variablesで確認可能)
curl -s -X POST http://localhost:8000/api/io/x_pb1 -H "Content-Type: application/json" -d '{"value": true}'
curl -s -X POST http://localhost:8000/api/io/x_pb1 -H "Content-Type: application/json" -d '{"value": false}'
sleep 5
curl -s http://localhost:8000/api/variables | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print([v['value'] for v in d if v['id']=='screw_count'])"
# => [3]  (レーン0・1・2の3本が検出されカウントに反映)

# 検定を実行(手順内のset_featureでレーン0・2の2本パターンに固定し直してから走る)
curl -s -X POST http://localhost:8000/api/sim/exam/start
for i in $(seq 1 10); do curl -s http://localhost:8000/api/sim/state; echo; sleep 2; done
curl -s http://localhost:8000/api/sim/exam/status   # state: passed、全26ステップpass

# 後片付け
curl -s -X POST http://localhost:8000/api/sim/jigs/jig1/reset
curl -s -X POST http://localhost:8000/api/sim/deactivate
curl -s -X POST http://localhost:8000/api/program/examples/start_stop/load
```

### 検定開始プリフライトチェックの確認例(BUG-009再現、日本語入りJSONは`--data-binary @file`推奨)

```bash
# 意図的にプログラム不一致を再現: start_stopがロードされたままkentei_plcをアクティブ化
curl -s -X POST http://localhost:8000/api/program/examples/start_stop/load
curl -s -X POST http://localhost:8000/api/sim/rigs/kentei_plc/activate

# 検定開始 -> 409(修正前は原因のわかりにくいタイムアウト不合格になっていた)
curl -s -i -X POST http://localhost:8000/api/sim/exam/start
# => HTTP/1.1 409 Conflict
#    {"detail":{"error":"unresolved_signals",
#      "signals":["x_pb1","y_ry_fwd.OUT","var.screw_count","x_pb2"],
#      "target_program":"kentei_machine","current_program":"start_stop",
#      "hint":"リグの対象プログラムをロードしてください"}}

# 対象プログラムをロードしてから再アクティブ化 -> 検定開始 -> 200/passed
curl -s -X POST http://localhost:8000/api/program/examples/kentei_machine/load
curl -s -X POST http://localhost:8000/api/sim/rigs/kentei_plc/activate
curl -s -X POST http://localhost:8000/api/sim/exam/start   # {"ok":true,"state":"running"}
sleep 6
curl -s http://localhost:8000/api/sim/exam/status   # state: passed、全26ステップpass

# force:true で不一致のままでも強制開始できることの確認
curl -s -X POST http://localhost:8000/api/program/examples/start_stop/load
curl -s -X POST http://localhost:8000/api/sim/rigs/kentei_plc/activate
curl -s -X POST http://localhost:8000/api/sim/exam/start \
  -H "Content-Type: application/json" --data-binary '{"force": true}'
# => {"ok":true,"state":"running"}(プリフライトをスキップして開始)
curl -s -X POST http://localhost:8000/api/sim/exam/abort

# 後片付け
curl -s -X POST http://localhost:8000/api/sim/jigs/jig1/reset
curl -s -X POST http://localhost:8000/api/sim/deactivate
curl -s -X POST http://localhost:8000/api/program/examples/start_stop/load
```
