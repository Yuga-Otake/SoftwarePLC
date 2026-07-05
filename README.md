# Software PLC

ブラウザで動く、ソフトウェアPLC（Programmable Logic Controller）の探索・実験プラットフォーム。
ブロック（ファンクションブロック図 / FBD）を組み合わせて自動化ロジックを作り、状態がリアルタイムで流れる様子を視覚的に確認できます。

## 構成

- **backend/**: Python (FastAPI) — PLC実行エンジン、REST API、WebSocket、AIアシスタント
- **frontend/**: React + Reactflow — ビジュアルキャンバス、I/Oパネル、AIパネル
- **examples/**: サンプルプログラム（スタート/ストップ回路など）

## 起動方法

### 1. バックエンド (FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

→ `http://localhost:8000` で起動します。

AIアシスタント機能を使う場合は、`backend/.env.example` を `backend/.env` にコピーして
`ANTHROPIC_API_KEY`（Claude）または `GEMINI_API_KEY`（Google Gemini）のいずれかを設定して
ください（任意。未設定でもPLC本体は動作します）。両方設定した場合はAnthropicが優先されます。
`AI_PROVIDER=anthropic` / `AI_PROVIDER=gemini` で明示的にプロバイダを固定することもできます。
詳細は `DEV_WORKFLOW.md` の「AIプロバイダ設定」を参照してください。

### 2. フロントエンド (Vite + React)

別のターミナルで：

```bash
cd frontend
npm install
npm run dev
```

→ `http://localhost:5173` をブラウザで開いてください。
（Vite の dev サーバーが `/api` と `/ws` を `http://localhost:8000` にプロキシします）

## 確認できること

- 起動すると「スタート/ストップ回路」のサンプルが自動で読み込まれます
- 下部の I/O パネルで `X0 Start` / `X1 Stop` をクリックして ON/OFF を切り替えられます
- X0 を ON にすると、SR ラッチ → モーター出力 (Y0) が緑色でアクティブになり、接続線がアニメーションします
- 同時に TON タイマーが動き出し、3秒後に Y1 (Done) が点灯します
- 上部のパレットからブロックをドラッグ＆ドロップしてキャンバスに追加できます
- 右側の AI パネルで「X1がONになったら3秒後にY1を点灯させて」のように指示すると、AIがブロックを提案します（要 `ANTHROPIC_API_KEY`）
- 最下部のステータスバーでスキャン周期の使用率・メモリ使用量を確認できます
- 上部タブバー右端の「変数」ボタンから、どのタブからでも変数マネージャー（I/O名称変更・
  内部変数の追加編集・現在値のライブ監視・強制書込）を開けます。詳細は
  [`docs/VARIABLES.md`](docs/VARIABLES.md) を参照してください。
