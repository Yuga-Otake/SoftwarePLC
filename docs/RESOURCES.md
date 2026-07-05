# リソース按分 — タスクスケジューラの設計とAPI

Software PLC を実PLCに近づけるため、エンジン上位に3つの「タスク」を定義し、CPUリソース
(実行頻度)を按分します。**表示だけでなく実際の動作(WS配信レート・トレンドのサンプリング
レート)に反映されます。**

実装: `backend/plc/scheduler.py`(`TaskScheduler` / `TaskConfig` / `TaskStats`)、
`backend/plc/runtime.py`(`PLCRuntime.scheduler` として保持、`run_scan` / `_hmi_task` /
`_viz_task` をコールバックとして登録)。

対象読者: `backend/` を変更する開発者。UI側は `frontend/src/components/ResourcesTab/`。

---

## 1. タスクモデル

| タスク | 役割 | デフォルト周期 | デフォルト cpu_share | 保護 |
|---|---|---|---|---|
| `control` | PLCスキャン実行 (`PLCRuntime.run_scan` → `_scan_cycle`) | 100ms | 50% | ○ (常に保護) |
| `hmi` | WebSocket状態配信 (`_hmi_task`) | 100ms | 30% | - |
| `viz` | トレンド用履歴サンプリング + 集約配信 (`_viz_task`) | 500ms | 20% | - |

各タスクは `TaskConfig(name, period_ms, cpu_share, protected)` で定義され、実行のたびに
`TaskStats` が実測値(busy time / 使用率 / 実効周期 / degraded フラグ)を保持します。

### 実挙動への反映

- 以前は `_scan_cycle` が毎スキャンWSへブロードキャストしていましたが、現在は **`hmi` タスク
  が自分の実効周期でブロードキャストします**。`hmi.period_ms` を変えると実際に配信レートが
  変わります(`PUT /api/resources` で確認可能、後述)。
- `viz` タスクは自分の実効周期で `PLCRuntime._current_outputs` の全信号をサンプリングし、
  `runtime._viz_history`(信号ごとのリングバッファ)に追記します。周期を変えるとサンプリング
  レートが変わります。
- `control` タスクは従来通り `scan_interval_ms` で駆動されるスキャンサイクルそのもの
  (`PATCH /api/runtime/config` の既存の挙動と後方互換。`control.period_ms` を変更すると
  `runtime.scan_interval_ms` にも反映されます)。

---

## 2. 使用率の実測

`TaskScheduler.tick()` が「今回のtickで実行が必要(due)なタスク」を1つずつ呼び出し、
`time.perf_counter()` で実行前後の壁時計差分を busy time として記録します(仮想クロックは
「いつ実行すべきか」の判定にのみ使い、実行コスト自体は常に実時間で計測します — CPU負荷は
PLC内部時間の進み方に関係なく実コストだからです)。

```
utilization_pct = avg(busy_time over last 20 runs) / effective_period_ms * 100
```

移動平均のウィンドウは `UTILIZATION_WINDOW = 20`(`scheduler.py`)。

---

## 3. 過負荷時のデグレード(制御優先)ポリシー

`TaskScheduler._apply_overload_policy()` が毎tick後に評価する、決定的なポリシーです
(仮想クロックでユニットテスト可能 — `backend/tests/test_scheduler.py` 参照)。

**過負荷判定**:
- 全タスクの `utilization_pct` 合計が `OVERLOAD_TOTAL_PCT = 90.0` を超える、または
- `control` 自身の使用率がその `cpu_share` を超える(制御タスクが苦しい = 全体が限界)

**対象タスク**: `protected=False` のタスク(`hmi`, `viz`)のみ。`control` の**設定周期・
cpu_share は一切変更されません**(保護)。

**個別トリガー**: 上記の全体過負荷に加え、`hmi`/`viz` 各タスクが**自分の `cpu_share` を
超過した場合**も個別にデグレード対象になります。

**デグレード動作**: 対象タスクの実効周期 (`effective_period_ms`) を
`DEGRADE_STEP = 1.5` 倍ずつ引き伸ばします(例: 設定100ms → 実効150ms → 225ms → …)。
上限は `MAX_STRETCH = 4.0`(設定値の4倍まで)。

**回復動作**: 過負荷でなくなり、かつ自分のシェア内に収まっていれば、実効周期は
`RECOVER_STEP = 0.85` 倍ずつ設定値に向かって回復します(設定値の1.02倍未満になったら
設定値にスナップ)。

**設定周期 vs 実効周期の区別**: `TaskConfig.period_ms`(ユーザー設定値、常に不変)と
`TaskStats.effective_period_ms`(実際に使われている周期、デグレード時は設定値より大きい)
を明確に分けて保持・公開します。`degraded` フラグは `effective_period_ms > period_ms * 1.001`
のときに `true`。

**手動での周期/シェア変更** (`PUT /api/resources`) は、その場で `effective_period_ms` を
新しい `period_ms` にリセットします(デグレード状態もクリア)。過負荷が続いていれば次回tick
以降のポリシー評価で再度デグレードされます。

---

## 4. API

### `GET /api/resources`

```json
{
  "tasks": [
    {"name": "control", "period_ms": 100.0, "effective_period_ms": 100.0, "cpu_share": 50.0,
     "protected": true, "utilization_pct": 12.3, "run_count": 420, "last_busy_ms": 1.2, "degraded": false},
    {"name": "hmi", "period_ms": 100.0, "effective_period_ms": 100.0, "cpu_share": 30.0,
     "protected": false, "utilization_pct": 5.1, "run_count": 418, "last_busy_ms": 0.3, "degraded": false},
    {"name": "viz", "period_ms": 500.0, "effective_period_ms": 500.0, "cpu_share": 20.0,
     "protected": false, "utilization_pct": 2.0, "run_count": 84, "last_busy_ms": 1.0, "degraded": false}
  ]
}
```

### `PUT /api/resources`

```json
{"tasks": [{"name": "hmi", "period_ms": 250, "cpu_share": 40}]}
```

- `name` は `control` | `hmi` | `viz` のいずれか(不明な名前は400)。
- `period_ms` / `cpu_share` はどちらか片方だけでも可。
- `control` の `cpu_share` は無視されます(保護のため固定値のまま)。`control.period_ms`
  を変更した場合は `runtime.scan_interval_ms` にも反映されます(既存のスキャン周期設定と
  同じ効果)。
- レスポンスは `GET /api/resources` と同じ形。

### `GET /api/viz/history?signal=<node_id.port>&since_ms=<t>`

`viz` タスクが記録したリングバッファ(信号ごと、最大2000サンプル)を返します。

```json
{"signal": "y_motor.OUT", "samples": [{"t": 1783128342.79, "value": false}, ...]}
```

`since_ms` は `t * 1000 >= since_ms` のフィルタ(ミリ秒指定)。省略時は全件。

### `GET /api/signals`

現在の全信号パス(`node_id.port`)と現在値・推定データ型(`bool`|`number`|`other`)の一覧。
HMIウィジェットのバインド先ドロップダウンや、見える化タブの信号ピッカーに使用します。

```json
[{"path": "y_motor.OUT", "node_id": "y_motor", "port": "OUT", "value": true, "data_type": "bool"}, ...]
```

### HMI画面の永続化

`GET /api/hmi/screens` : 保存済み画面名の一覧(`backend/hmi_screens/*.json` のstem)。
`GET /api/hmi/screens/{name}` : 画面JSONを返す(存在しなければ404)。
`PUT /api/hmi/screens/{name}` : 画面JSONを保存(上書き)。
`DELETE /api/hmi/screens/{name}` : 削除。

画面JSONの書式は [`docs/HMI.md`](HMI.md) を参照。

---

## 5. テスト

`backend/tests/test_scheduler.py`(仮想クロック + 実時間なしのユニットテスト、および
FastAPI `TestClient` によるAPIテスト):

- デフォルトタスクの初期値
- 周期どおりのタスク起動回数(仮想クロックを100ms刻みで10回進め、control/hmiが10回、
  viz(500ms周期)が2回実行されることを確認)
- busy time からの使用率算出
- 過負荷時に `hmi`/`viz` がデグレードし、`control` の設定周期・cpu_shareは変化しないこと
- 負荷が下がった後にデグレードから回復すること
- `PUT /api/resources` が実効周期に即座に反映されること、`control` の `cpu_share` が
  無視されること、不明なタスク名で400になること
- `/api/signals` が信号一覧と型推定を返すこと
- `/api/viz/history` の `since_ms` フィルタ
- HMI画面の保存→一覧→読込のラウンドトリップ、404、不正な名前の拒否

```bash
cd backend
python -m pytest tests/test_scheduler.py -v
python -m pytest tests/ -q   # 全体回帰(48件)
```
