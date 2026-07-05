# ネットワーク管理 — ポート分離 / 別端末アクセス / 実行監視

開発(プログラム設計)・HMI・見える化をポートで分離し、タブレットや別PCのブラウザから
HMI・見える化だけを開けるようにする機能の設計・API・運用手順です。

実装: `backend/plc/network_config.py`(設定の読み込み・検証・永続化)、
`backend/plc/subservers.py`(サブサーバーのライフサイクル管理)、
`backend/api/subapps.py`(役割スコープ付きFastAPIアプリ、8010/8020用)、
`backend/api/network_routes.py`(`/api/network*`、8000のみに公開)、
`backend/static_pages/{hmi,viz}.html`(別端末向けスタンドアロンページ、ビルド工程なし)。
UI側は `frontend/src/components/NetworkTab/`。

対象読者: `backend/`・`frontend/` を変更する開発者、および複数端末での運用者。

---

## 1. アーキテクチャ: 1プロセス・複数ポート

制御エンジン・状態・スケジューラ(`PLCRuntime` / `TaskScheduler`)は単一プロセス内の
シングルトンのままです。そのプロセスの同じasyncioイベントループ上に、役割ごとの
`uvicorn.Server` を追加で起動します(`uvicorn.Config` + `Server.serve()` を
`asyncio.create_task` として実行)。3つのポートはすべて同じ `runtime` / `manager`
(WebSocket接続マネージャ)を参照するため、どのポートから見ても同じPLC状態・同じ
ライブ配信を観測します。

| ポート (デフォルト) | 役割 | 起動方法 | bind |
|---|---|---|---|
| **8000** | 開発スタジオ(現行) | ユーザー自身の `uvicorn main:app --reload --port 8000`(変更なし) | 127.0.0.1 (uvicornのデフォルト。ユーザーが `--host` を指定すれば従う) |
| **8010** | HMI配信 | `main.py` の起動時(lifespan)にプロセス内で自動起動 | `0.0.0.0`(LAN内の別端末からアクセス可) |
| **8020** | 見える化配信 | 同上 | `0.0.0.0` |

8000は**このモジュールが管理するサブサーバーではありません**。ユーザーがどう起動するかに
委ねられており、`/api/network` 上は常に `status: "listening"`(そのAPIリクエスト自体が
8000で処理されている時点で自明)として表示されるだけの情報提供に留まります。8010/8020は
`SubserverManager`(`backend/plc/subservers.py`)が起動・停止・再起動を管理します。

### 公開範囲(役割スコープ)

各サブサーバーは**別々のFastAPIアプリインスタンス**です(`main.app` とは異なるASGIアプリ)。
共有ルーターの一部だけ隠す方式ではなく、**そもそも登録しない**ことでスコープを強制します
(ミドルウェアやガード漏れによる意図しない公開を構造的に防止)。

**8010 (HMI配信)** — `backend/api/subapps.py` の `build_hmi_app()`:
- 公開: `GET /`(スタンドアロンHMIページ)、`GET /api/hmi/screens`・
  `GET /api/hmi/screens/{name}`(一覧・取得のみ)、`POST /api/io/{node_id}`・
  `GET /api/io`(I/O書込/読取)、`GET /api/signals`、`GET/POST /ws`(状態WS)
- **非公開**: プログラム編集(`/api/program*`)、リソース変更(`/api/resources`)、
  デバッグAPI(`/api/debug/*`)、画面の保存/削除(`PUT`/`DELETE /api/hmi/screens/{name}`)、
  ネットワーク管理(`/api/network*`)

**8020 (見える化配信)** — `build_viz_app()`:
- 公開: `GET /`(スタンドアロン見える化ページ)、`GET /api/viz/history`、
  `GET /api/program`(稼働ボード用、読み取り専用)、`GET /api/resources`(読み取りのみ)、
  `GET /api/signals`、`GET/POST /ws`
- **非公開**: I/O書込(`/api/io*` は一切登録されない)、プログラム編集、デバッグAPI、
  ネットワーク管理

これらの境界は `backend/tests/test_network.py` で、各アプリを直接 `TestClient` に
マウントして検証しています(実ソケットなしで高速)。

---

## 2. ネットワーク設定ファイル

`backend/network_config.json`(初回起動時に自動生成):

```json
{
  "services": [
    {"name": "studio", "role": "studio", "port": 8000, "enabled": true},
    {"name": "hmi", "role": "hmi", "port": 8010, "enabled": true},
    {"name": "viz", "role": "viz", "port": 8020, "enabled": true}
  ]
}
```

- `studio` エントリは**情報提供のみ**。`PUT /api/network/studio` は常に400
  (「起動方法(プロセス起動時の `--port` 引数)で固定」であることを示すエラー)。
- `hmi` / `viz` の `port` / `enabled` は `PUT /api/network/{service}` で変更可能。
- バリデーション(`plc/network_config.py` の `NetworkConfig.validate_update`):
  - ポート範囲: 1024〜65535
  - 予約ポート禁止: 8000(開発スタジオ)・5173(Vite開発サーバー)
  - 重複禁止: 他のサービスと同じポートは不可
  - 不明なサービス名は404(`KeyError`)、それ以外の違反は400(`NetworkConfigError`)

`PLC_NETWORK_CONFIG_PATH` 環境変数で設定ファイルのパスを差し替え可能(検証用に隔離した
一時構成で別ポート帯を試したいときに使用。通常の開発では未設定のままでOK)。

---

## 3. 別端末からのアクセス手順

1. 開発マシンでいつも通り起動: `cd backend && uvicorn main:app --reload --port 8000`
   (`.claude/launch.json` の `backend` 構成、または手動起動)。起動時に自動的に
   8010(HMI)・8020(見える化)もこのプロセス内で立ち上がります。
2. 開発マシンのLAN IPを確認: 「ネットワーク」タブの各サービスカードの「アクセスURL」に
   `http://<LAN IP>:8010` / `:8020` が表示されます(`socket` 経由で自動検出。取得できない
   環境では `127.0.0.1` にフォールバック)。「コピー」ボタンでURLをコピーできます。
3. 同じLAN内のタブレット・別PCのブラウザで、コピーしたURLを開きます。
   - HMI (`:8010`): 保存済み画面をドロップダウンで選択→運転操作。
   - 見える化 (`:8020`): 稼働状況ボード・信号トレンド・スキャン/タスク使用率(読み取り専用)。
4. Windowsでは `0.0.0.0` バインド時にファイアウォールの許可プロンプトが出ることがあります。
   許可しない場合、LAN内の別端末からは到達できませんが `localhost` からのアクセスは
   引き続き機能します。

**Windows環境でのVite開発サーバー(5173)を別端末に公開したい場合**は本機能の対象外です
(フロントエンド開発サーバーは開発専用。別端末向けは常にビルド不要のスタンドアロンページ
8010/8020を使います)。

---

## 4. スタンドアロンページ (`backend/static_pages/`)

Viteのビルド工程を経ない、FastAPIが直接配信する自己完結HTML+インラインJS(ライブラリ
依存なし、Reactも不使用)。同じ役割スコープAPI(8010/8020)だけを叩きます。

- **`hmi.html`**: 画面選択ドロップダウン → 保存済みHMI画面(`docs/HMI.md` の書式)を
  素のJS(DOM操作)で描画。ウィジェット5種(`button_momentary` / `button_alternate` /
  `lamp` / `number` / `gauge`)対応。状態WS(`/ws`)でライブ更新、ボタンは
  `POST /api/io/{node_id}` を呼び出します。タブレット幅を想定したレスポンシブ
  (`viewport` メタタグ、折り返し可能なトップバー)。
- **`viz.html`**: 稼働状況ボード(プログラムツリーの装置/工程/動作グループを再帰集約、
  いずれかのリーフ出力がONなら「稼働中」)+ 信号トレンド(SVG `<polyline>`、bool信号は
  ステップ波形)+ スキャン/タスク使用率(制御/HMI/見える化のミニバー)。すべて読み取り専用。

どちらも `GET /api/signals` や `GET /api/hmi/screens` など役割スコープ内のAPIだけを
使い、失敗時は静かにリトライ(WS再接続は2秒後に自動)します。

---

## 5. ネットワーク管理 + 実行プログラム監視 API

### `GET /api/network` (8000のみ)

```json
{
  "services": [
    {"name": "studio", "role": "studio", "port": 8000, "enabled": true,
     "status": "listening", "ws_clients": 1,
     "urls": {"localhost": "http://localhost:8000", "lan": "http://192.168.1.20:8000"}},
    {"name": "hmi", "role": "hmi", "port": 8010, "enabled": true,
     "status": "listening", "ws_clients": 1, "urls": {...}},
    {"name": "viz", "role": "viz", "port": 8020, "enabled": true,
     "status": "listening", "ws_clients": 1, "urls": {...}}
  ],
  "monitoring": {
    "program_name": "無題プログラム (7 ノード)",
    "running": true,
    "scan_index": 1299,
    "last_cycle_time_ms": 0.15,
    "node_count": 7,
    "tasks": [ /* runtime.scheduler.snapshot() と同じ形、docs/RESOURCES.md 参照 */ ]
  },
  "recent_events": [ /* GET /api/debug/events と同じ形の直近20件 */ ]
}
```

- `ws_clients` は全ポート合算(3ポートすべてが単一の `ConnectionManager` を共有するため、
  ポート別の内訳は追跡していません)。
- `program_name` は明示的な名前フィールドが `ProgramGraph` に無いため、ルートのグループ
  ラベル(あれば連結)またはノード数からの簡易表示です。

### `PUT /api/network/{service}`

```json
{"port": 8011, "enabled": true}
```

- `port` / `enabled` はどちらか片方だけでも可。
- 検証失敗は400(`NetworkConfigError` の内容を `detail` に含む)、不明なサービス名は404。
- 成功時: 設定を永続化(`network_config.json`)→ 該当サブサーバーだけを停止・
  新しいポートで再起動 → 更新後の状態を返す。**他のサービス・制御ループには影響しません**
  (PLCの実行状態・接続中のI/O値は継続)。

---

## 6. フロントエンド: 「ネットワーク」タブ

`frontend/src/components/NetworkTab/index.tsx`(5番目のタブ)。

- 上段: サービスカード×3(名前・役割・状態インジケータ・ポート編集・有効/無効トグル・
  アクセスURL(コピー可)・WS接続数)。`studio` はポート入力が無効化表示(起動方法で固定)。
- 下段: 実行プログラム監視パネル(プログラム名・運転状態・スキャン回数・直近スキャン時間・
  ノード数・タスク別使用率ミニバー)+ 信号遷移イベントログ(`GET /api/debug/events` を
  2秒間隔でポーリング、最新20件)。
- 全体を2秒間隔でポーリング更新(`GET /api/network`)。ポート変更は入力欄の `blur` で
  即座に `PUT` します。

---

## 7. テスト

`backend/tests/test_network.py`:

- 設定の生成・永続化・再読込・欠損サービスの補完
- バリデーション: 重複ポート・範囲外ポート・予約ポート・`studio` 編集の拒否・不明サービス名
- 役割スコープ: `build_hmi_app()` / `build_viz_app()` を直接 `TestClient` にマウントし、
  デバッグAPI・プログラム編集・リソース変更・画面保存/削除・ネットワークAPIが非公開
  (404または405)であること、HMIのI/O書込は成功しvizは拒否されることを確認
- `GET /api/network` のレスポンス形状(監視情報フィールドを含む)、`PUT` の検証エラー

```bash
cd backend
python -m pytest tests/test_network.py -v
python -m pytest tests/ -q   # 全体回帰(75件)
```

`tests/conftest.py` は `PLC_DISABLE_SUBSERVERS=1` をデフォルト設定し、ネットワーク以外の
既存テスト(`TestClient(app)` で `main.py` の完全なlifespanを起動するもの)が実ポート
8010/8020まで毎回バインドしないようにしています(`test_network.py` 自体は各ASGIアプリを
直接マウントするため実ポートを使いません)。

実ポートでの動作(サブサーバー起動・ポート変更後の新ポート応答・別端末アクセス相当の
`0.0.0.0` バインド)は、18000番台などの一時ポート構成での手動 `curl` 検証で確認します
(`PLC_NETWORK_CONFIG_PATH` で隔離した設定ファイルを使い、実際の `network_config.json` は
汚しません)。

---

## 8. セキュリティに関する注意

- 8010/8020は認証なしでLAN内に公開されます。**信頼できるLAN内でのみ使用してください**
  (会社/自宅の管理下ネットワーク限定を想定。公衆Wi-Fiや外部公開ネットワークでの使用は
  非推奨)。
- HMI配信ポート(8010)はI/O書込APIを公開しているため、そのポートに到達できる人は誰でも
  実機相当の操作(ボタン押下等)が可能です。運用時はネットワーク自体のアクセス制御
  (ファイアウォール、VLAN分離等)で保護してください。
- 見える化ポート(8020)は読み取り専用ですが、プログラム構成(`GET /api/program`)や
  信号トレンドが閲覧可能です。機密性の高いロジックを扱う場合は同様にネットワークで
  保護してください。
- 本機能はPoC(概念実証)の一部であり、TLS/認証機構は実装していません。
