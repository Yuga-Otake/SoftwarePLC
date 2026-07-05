# HMI画面 — D&Dビルダーの書式とAPI

PLCロジックより上位の「操作画面(HMI)」を、ドラッグ&ドロップで作成・保存・運転できる
機能の書式です。フロントエンドの実装は `frontend/src/components/HmiTab/`、バックエンドの
永続化APIは `docs/RESOURCES.md` の「HMI画面の永続化」セクション、実体は
`backend/api/routes.py` の `/api/hmi/screens*` エンドポイントと `backend/hmi_screens/*.json`。

対象読者: HMI画面JSONを直接読み書きする開発者・AIアシスタント。

---

## 1. 画面JSONの書式

```jsonc
{
  "name": "main",                 // 画面名(ファイル名 = {name}.json)
  "widgets": [
    {
      "id": "w1",                 // 画面内で一意なID
      "type": "button_momentary", // "button_momentary" | "button_alternate" | "lamp" | "number" | "gauge"
      "x": 40, "y": 40,           // グリッド座標(px)
      "w": 80, "h": 40,           // サイズ(px)
      "label": "Start",           // 表示ラベル
      "signal": "x_start.OUT",    // バインド先信号パス ("node_id.port"、GET /api/signals で列挙可能)
      "color": "#22c55e",         // 任意。ON時/主要色
      "options": {                // ウィジェット種別ごとの追加設定(任意)
        "min": 0, "max": 100      // 例: gauge の場合の表示レンジ
      }
    }
  ]
}
```

### ウィジェット種別

| type | 用途 | 運転モードでの挙動 |
|---|---|---|
| `button_momentary` | モーメンタリ(押している間だけON) | pointerdown で信号=true、pointerup/leaveで信号=false を `POST /api/io/{node_id}` へ送信(bool信号のみバインド可) |
| `button_alternate` | オルタネイト(押すたびに反転) | クリックごとに現在値を反転して送信 |
| `lamp` | ランプ表示 | WS状態でライブ更新。値がtrueなら`color`で点灯、falseは消灯色 |
| `number` | 数値表示 | WS状態の値をそのまま表示(bool/int/float) |
| `gauge` | ゲージ表示 | `options.min`/`options.max` の範囲で数値をバー表示 |

- ボタン系(`button_momentary`/`button_alternate`)は **bool型の信号かつ書き込み可能な
  I/O(DigitalInput相当のnode_id)** にバインドすることを想定しています。バインド先の
  `node_id` に対して既存の `POST /api/io/{node_id}` (IOPanelが使うものと同じAPI)を呼び出し
  ます。
- ランプ/数値/ゲージは読み取り専用で、任意の信号パス(通常ノードの出力ポートやI/Oの現在値)
  にバインドできます。

---

## 2. 編集モード / 運転モード

- **編集モード**: ウィジェットパレットからキャンバスへドラッグ配置、選択して移動・
  リサイズ、プロパティパネルでラベル・信号バインド・色を設定。ネイティブの pointer
  イベント(またはHTML5 DnD)で実装、新規ライブラリ依存なし。
- **運転モード**: 編集操作は無効化。ランプ/数値/ゲージは `usePLCStore` のWebSocket状態
  (`runtimeState`)からライブ更新。ボタンは実際にI/O書き込みAPIを呼び出す(PLCロジック
  タブのIOPanelと同じ効果 — 同じ `toggleIO` 相当のI/O書込)。

---

## 3. API

`docs/RESOURCES.md` 参照。要約:

- `GET /api/hmi/screens` : 保存済み画面名一覧
- `GET /api/hmi/screens/{name}` : 画面JSON取得(404 = 未保存)
- `PUT /api/hmi/screens/{name}` : 画面JSON保存(bodyは上記スキーマの `dict`。`name`
  フィールドは任意 — URLの `{name}` が正となりファイル名を決める)
- `DELETE /api/hmi/screens/{name}` : 削除

画面名は `^[A-Za-z0-9_-]+$` のみ許可(パストラバーサル対策)。
