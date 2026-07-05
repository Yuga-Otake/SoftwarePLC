# QA履歴・バグ台帳

評価と修正の履歴を集約するファイル。**評価・修正作業を行うエージェントは、作業前に必ずこのファイルを読み、作業後に必ず追記すること。**
目的: 同じ観点の再評価・同じバグの再調査という二度手間を防ぐ。

## 運用ルール
- 評価した観点は結果が「問題なし」でも記録する(何を確認済みかが資産)
- バグは BUG-<連番> で採番し、状態を更新する: `open` → `fixed` → `verified`
- 修正には再発防止テスト(pytest or シナリオ)を必ず紐付け、テスト名を記録する
- 日付は絶対日付(YYYY-MM-DD)で書く

---

## 検証済みの観点(再評価不要。変更が入った場合のみ再確認)

| 日付 | 観点 | 方法 | 結果 |
|---|---|---|---|
| 2026-07-04 | SR/RS ラッチ基本動作 | pytest test_sr_latch.py (7件) | pass |
| 2026-07-04 | TON タイマー(閾値前後・リセット) | pytest test_ton_timer.py (6件) | pass |
| 2026-07-04 | CTU カウンタ | pytest test_ctu_counter.py (4件) | pass |
| 2026-07-04 | スタート/ストップ回路 E2E | pytest test_start_stop_e2e.py + シナリオ3本 | pass |
| 2026-07-04 | 階層フラット化(id一意化・ポートパススルー・2段ネスト・fan-out) | pytest test_hierarchy.py (6件) + conveyor_hierarchy シナリオ | pass |
| 2026-07-04 | タスクスケジューラ(周期精度・使用率・過負荷デグレード・control保護) | pytest test_scheduler.py (15件) + curl実測(hmi周期変更→配信レート実変化) | pass |
| 2026-07-04 | デバッグAPI /api/debug/state, /api/debug/events | pytest + curl | pass |
| 2026-07-04 | HMI画面 保存/読込/404/不正名拒否 | pytest | pass |
| 2026-07-04 | フロント: 階層ドリルダウン(3階層・パンくず・集約状態ライブ更新) | preview実機確認 | pass |
| 2026-07-04 | フロント: HMIビルダー(配置・バインド・運転モード操作)、見える化、リソースタブ | preview実機確認 | pass |
| 2026-07-04 | ネットワーク分離: 役割スコープ(HMIアプリにデバッグ/編集API無し、vizアプリでI/O書込403/404) | pytest test_network.py(TestClient直マウント、27件) | pass |
| 2026-07-04 | ネットワーク設定の検証(重複ポート・範囲外・予約ポート・studio編集拒否) | pytest test_network.py | pass |
| 2026-07-04 | サブサーバー実起動(18000番台一時構成): HMIページ/見える化ページHTML応答、HMIポートI/O書込反映、vizポート書込拒否、PUT /api/network でポート変更→旧ポート停止・新ポート応答 | curl実測 | pass |
| 2026-07-04 | 実サーバー(8000, uvicorn --reload)起動時に8010/8020が自動起動すること | curl (`GET /api/network`, `GET :8010/`, `GET :8020/`) | pass |
| 2026-07-04 | フロント: ネットワークタブ(3サービスカード・状態緑・URL・監視パネル・イベントログ)、ポート変更UI操作(8010→8012→8010)、スタンドアロンHMIページ(ボタン押下→ランプ点灯・ゲージ表示)、スタンドアロン見える化ページ(稼働ボード・トレンドSVG) | preview実機確認、コンソールエラーなし | pass |
| 2026-07-04 | TOFF(オフディレイ)基本動作・閾値前後・再トリガ・PT=0 | pytest test_toff_timer.py(7件・新規) | pass |
| 2026-07-04 | COMP比較演算子6種(>,<,>=,<=,==,!=)・未知OP文字列・未接続入力 | pytest test_comp_and_or.py(直接executor単体テスト、DigitalInputはbool強制のため経由不可と判明・回避策記録) | pass |
| 2026-07-04 | AND/OR 3-4入力・一部未接続・全未接続(AND→True/OR→False の空集合既定値) | pytest test_comp_and_or.py | pass |
| 2026-07-04 | CTU: PV=0即Q=True、preset到達後も加算継続、reset優先(R=Trueの間はCU無視) | pytest test_ctu_counter.py(3件追加) | pass、ただし1件はBUG-002として修正 |
| 2026-07-04 | TON: PT=0即Q=True、1スキャンのみのチャタリング入力でQ誤発火なし、未接続入力の既定値 | pytest test_ton_timer.py(3件追加) | pass |
| 2026-07-04 | SR/RS: S=R=True同時アサート時の優先順位(Set優勢/Reset優勢) | 既存 pytest test_sr_latch.py で網羅済みを再確認(探索スクリプトの誤り一件を切り分け、製品バグではないと確認) | pass |
| 2026-07-04 | 不正プログラムロード: 存在しないノードへのエッジ、存在しないノードからのエッジ、未知ノードtype、重複ノードid、自己ループエッジ、2ノード間フィードバックループ、空グループchildren、$parent参照の未宣言ポートid、グループ境界をまたぐid重複 | pytest test_malformed_programs.py(新規12件)。全て500クラッシュせず妥当に処理されることを確認 | pass |
| 2026-07-04 | PUT /api/program 経由で上記の不正プログラムをロードしても500にならないこと | pytest test_malformed_programs.py(HTTPレベル4件) | pass |
| 2026-07-04 | PUT /api/resources: period_ms=0/負値/1ms、cpu_share合計>100 | pytest test_scheduler.py(4件追加)。0/負値は1msにクランプ、1msは受理、cpu_share合計超過は許容(タスク単独クランプのみ、使用率は実測ベースなので設計上問題なし) | pass |
| 2026-07-04 | /api/viz/history: 存在しない信号名 | pytest test_scheduler.py(1件追加)。空配列を返す、エラーにならない | pass |
| 2026-07-04 | WS: 複数クライアント同時接続・両方切断後の新規接続(状態の初期push・接続管理のクリーンアップ) | curl相当のTestClient直結確認(websocket_connect x3、切断後の接続数0を確認) | pass |
| 2026-07-04 | プログラム切替(start_stop→conveyor_machine)直後: viz履歴・io_values・current_outputsの残留なし | curl実測(/api/debug/state、/api/viz/history) | pass、ただしイベントログ側はBUG-004として発見・修正 |
| 2026-07-04 | リソースタブのスライダー極値(period_ms min/max, cpu_share 0-100)はフロント側HTML属性で範囲制限済み、バックエンドのクランプは二重の安全網 | フロントソース確認(ResourcesTab/index.tsx min/max属性) | pass |
| 2026-07-04 | AIプロバイダ選択ロジック(AI_PROVIDER明示/自動判定/両方未設定/両方設定時のAnthropic優先) | pytest test_ai_providers.py(env組み合わせ6件) | pass |
| 2026-07-04 | Anthropic⇔Geminiツールスキーマ変換の往復(ネストしたobject/array、required、enum) | pytest test_ai_providers.py | pass |
| 2026-07-04 | Gemini応答パース(プレーンテキスト、functionCall→functionResponseループ、非dict結果のラップ、candidates空) | pytest test_ai_providers.py(モックhttpxクライアント、実通信なし) | pass |
| 2026-07-04 | AI未設定時のrun_assistant()の劣化なし動作(既存の「not configured」メッセージ) | pytest test_ai_providers.py + curl(`GET /api/ai/status`) | pass |
| 2026-07-04 | 変数: プログラムロード時の初期値反映(bool/number)、initial省略時のデフォルト、後方互換(variablesキーなしプログラム) | pytest test_variables.py | pass |
| 2026-07-04 | VAR_WRITE→VAR_READのスキャン間可視性、存在しない変数id参照時の安全動作(クラッシュせずデフォルト値+`_warning`) | pytest test_variables.py | pass |
| 2026-07-04 | 変数の信号統合: `/api/signals`(`var.<id>`)、イベントログ、vizトレンド履歴、WS状態配信(`runtime.var.<id>`) | pytest test_variables.py + curl実測 | pass |
| 2026-07-04 | `/api/variables*` CRUD・force・rename、出力(Y)へのforce拒否、未知id 404 | pytest test_variables.py(24件) + curl実測 | pass、ただし入力(X)forceの直後GETにBUG-006を発見・修正 |
| 2026-07-04 | フロント: 変数マネージャーモーダル(どのタブからも開く、Esc/×で閉じる、検索フィルタ、内部変数追加/削除、名前・初期値・コメント編集、強制書込ライブ反映)、VAR_READ/VAR_WRITEブロックのパレット配置・変数idドロップダウン、AIパネルのプロバイダバッジ表示 | preview実機確認、コンソールエラーなし | pass |
| 2026-07-05 | シミュレーションタブ / シーケンサ検定機: リグCRUD・信号読み書き(var./node.port/裸id・存在しないノードIDへのフォールバック) | pytest test_simulation.py(43件) | pass |
| 2026-07-05 | FeedbackRuleEngine: 条件成立から遅延後の反映、revert_on_clear有無、reset()での状態クリア | pytest test_simulation.py | pass |
| 2026-07-05 | ExamRunner: 同梱リグ(motor_exam/lamp_practice)が通しでpassすること、within_msタイムアウトfail、after_ms早すぎfail、abort、状態遷移(pending→running→pass/fail)、不明op | pytest test_simulation.py | pass |
| 2026-07-05 | SimulationManager: activate/deactivateでのfeedback_rules結線・検定リセット、start_exam例外系(リグ未アクティブ・exam無し・二重実行)、_reset_devices_to_defaultによる前回実行の残留信号クリア | pytest test_simulation.py | pass |
| 2026-07-05 | /api/sim/* のHTTPスモーク(CRUD・activate/deactivate・exam start/status/abort・404/400系) | pytest test_simulation.py | pass |
| 2026-07-05 | 実サーバー(8000)でmotor_examを実際にactivate→検定start→pollingでrunning→各ステップpass遷移→passedまでの完走(TON 3秒タイマー含む) | curl実測(ステータス遷移ログ取得) | pass |
| 2026-07-05 | feedback_rules実動作: y_motor.OUT ON後 約500ms(実測518ms)でx_motor_fbがONになること | curl実測(検定ステップ③の実測elapsed_ms) + preview実機(押しボタン押下→motor回転アニメ+センサーランプ点灯を目視) | pass |
| 2026-07-05 | フロント: シミュレーションタブ(リグ選択→アクティブ化→デバイス表示、押しボタン操作→モーター回転アニメ/センサーランプ点灯、検定開始→ステップがpending→running→passと遷移し合格(PASS)バッジ表示) | preview実機確認、コンソールエラーなし、ネットワーク失敗リクエストなし | pass |
| 2026-07-05 | シナリオランナー4本(start_stop_basic/stop_priority/ton_timer/conveyor_hierarchy) | scripts/scenario_runner.py実行 | pass |
| 2026-07-05 | PhysicsEngine: 位置積分(駆動ON/OFF・逆転・at_end=stop時のクランプ・at_end=wrap時の周回) | pytest test_conveyor.py(VirtualClock駆動) | pass |
| 2026-07-05 | PhysicsEngine: position_sensor検出(detect=feature/jig、検出窓内でON、通過後OFF)、スキャン周期より速い移動でも検出漏れしないこと(スイープ区間判定) | pytest test_conveyor.py | pass、詳細は下記セッション記録参照(設計変更あり) |
| 2026-07-05 | reset_jig: PhysicsEngineメソッド・exam.stepsのreset_jig op・POST /api/sim/jigs/{id}/reset の3経路、不明jig指定時の安全な失敗 | pytest test_conveyor.py | pass |
| 2026-07-05 | SimulationManager.feedback_tick(): PhysicsEngine→FeedbackRuleEngineの順で両方を毎スキャン駆動、activate/deactivateでのジグ位置・センサー信号の初期化 | pytest test_conveyor.py | pass |
| 2026-07-05 | conveyor_exam.jsonのヘッドレス完走(SimulationManager.activate()/start_exam()経由、全10ステップpass) | pytest test_conveyor.py | pass |
| 2026-07-05 | /api/sim/state・POST /api/sim/jigs/{id}/reset のHTTPスモーク(正常系・404系) | pytest test_conveyor.py | pass |
| 2026-07-05 | 実サーバー(8000)でconveyor_examを実際にactivate→検定start→/api/sim/stateをポーリングしジグ位置が実時間で増加(約200mm/s)→センサー到達→モーター自動停止→reset_jigで0mmへ復帰→passedまでの完走 | curl実測(ジグ位置サンプリングログ取得) | pass |
| 2026-07-05 | WSのstate_updateメッセージにsim_state(ジグ位置/センサー状態)が同梱されること(hmiタスク周期配信 + WS接続直後の初回メッセージ両方) | curl相当のPython websockets直結確認 | pass |
| 2026-07-05 | フロント: シミュレーションタブでconveyor_examを表示(ベルトストライプ・ジグ矩形・ネジ突起・位置センサー)、起動PBクリック→ベルトアニメ+モーター回転、検定実行→全ステップpass→合格(PASS)バッジ、ジグ原点復帰ボタン、既存リグ(motor_exam)の後方互換 | preview実機確認、コンソールエラーなし、ネットワーク失敗リクエストなし | pass |
| 2026-07-05 | relayデバイス: コイル信号(coil_signal)が真の間、接点信号(contact_signal)へ即座にtrueを書込・偽になれば即座にfalseに戻す(励磁遅延なし)。conveyorのdrive_signal/reverse_signalにリレーの接点を指定した場合の駆動 | pytest test_kentei.py(relay関連8件) | pass |
| 2026-07-05 | ネジ着脱(jig.features[].attached): デフォルトtrue、`attached: false`のfeatureはposition_sensorの検出対象から完全除外、`set_feature_attached`によるライブ切替(センサー状態の同期的再評価含む)、exam op `set_feature`、`GET /api/sim/state`のjigs.<id>.featuresへの反映 | pytest test_kentei.py(ネジ着脱関連8件) | pass |
| 2026-07-05 | digit_switch: signal(var.<id>)への書込がforce_variable_value経由で反映されること(内部変数として宣言されている前提) | pytest test_kentei.py::test_digit_switch_writes_through_to_variable | pass |
| 2026-07-05 | examples/kentei_machine.json: PB1でのSRラッチ+PL1点灯、右端LSでの正転→逆転切替(PL2点灯、ls_right解除後もラッチ保持)、左端LSでの全停止、PB2でのいつでも停止+screw_countリセット、CTUの立ち上がりエッジのみカウント(連続True保持での多重カウントなし)、正転/逆転インターロック(同一スキャンでpb1とls_rightが同時にTrueになる極端ケースでも出力段のAND+NOTにより同時励磁が起きないこと) | pytest test_kentei.py(kentei_machineロジック関連7件) | pass |
| 2026-07-05 | backend/sim_rigs/kentei_plc.json: リレー2個・ジグのネジ穴4つ(初期2本装着)・両端LS・ネジ検出センサー・PB1〜PB5・SS0/SS1・PL1〜PL4・DSW・DPL1/DPL2を含むリグのヘッドレス完走(SimulationManager直接操作・activate()/start_exam()経由の両方、全23ステップpass) | pytest test_kentei.py(kentei_plc関連2件) | pass |
| 2026-07-05 | /api/sim/jigs/{jig_id}/features/{feature_id} のHTTPスモーク(正常系・不明jig/feature 404・リグ未アクティブ404)、GET /api/sim/state の relays キー(既存リグとの後方互換含む) | pytest test_kentei.py(HTTP層6件) | pass |
| 2026-07-05 | 実サーバー(8000)でkentei_machineをロード→kentei_plcをactivate→検定start→リレー接点の正転→逆転切替(ry_fwd:true→ry_rev:true)・ネジ検出カウントの往復4回到達を`/api/sim/state`ポーリングで実測→全23ステップpassを確認。ネジ1本を`POST /api/sim/jigs/jig1/features/screw4`で外して手動でPB1操作→往復カウントが2(1本×往復2回)になることを確認 | curl実測 | pass |
| 2026-07-05 | フロント: kentei_plcの表示(リレー箱のCOIL/接点表示、コンベア上のジグとネジ穴/空き穴の描画、両端LS・ネジ検出センサー、PB1〜PB5(PB5は赤の非常停止風)、SS0/SS1、PL1〜PL4、DSWの▲▼操作、DPL1/DPL2の7セグメント描画)、ジグのネジをクリックして着脱(装着/未装着の見た目が切り替わり、APIにも反映)、PB1クリック→正転リレー励磁表示→ジグ搬送→右端LSで逆転リレーへ切替の表示→ジグ帰着→DPL1のカウント表示更新、検定実行→全23ステップ合格バッジ表示 | preview実機確認、コンソールエラーなし(既知のReact Flow nodeTypesメモ化警告のみ)、ネットワーク失敗リクエストなし | pass |
| 2026-07-05 | レーン拡張: `jig.features[].lane`/`position_sensor.lane`(幅方向レーン0..N-1、既定0)。`detect: "feature"`センサーは自レーンのfeatureのみ検出しレーン不一致は完全除外、`detect: "jig"`はlaneを無視、`lane`未指定同士(および未指定と明示的な`lane: 0`の組み合わせ)は暗黙のレーン0として後方互換に一致 | pytest test_kentei.py(レーン関連10件、新規) | pass |
| 2026-07-05 | ADDブロック新設(`backend/plc/nodes.py::ADDExecutor`): 2〜4入力の数値/bool合算(bool=0/1)、未接続ポートは0扱い、整数和はintのまま返す、`NODE_CATALOG`/`GET /api/catalog`への自動登録 | pytest test_kentei.py(ADD関連6件、新規) | pass |
| 2026-07-05 | kentei_plc.json改修版: ジグのネジ穴4つを幅方向レーン0〜3(全てoffset_mm=60で一列)に変更、ネジ検出センサーを4連(sens1〜sens4、全at_mm=450でlane違い)に変更、examples/kentei_machine.jsonをレーン別SRラッチ(lat_sens1〜4)+ADD合算+VAR_WRITEへ改修、検定手順を26ステップへ更新(レーン0・2の2本パターン→装着レーンのみ同時検出→ADD合算でscrew_count=2確認→往復後もラッチ保持を確認) | pytest test_kentei.py(改修後の全45件、うち既存関連21件を新設計に合わせて更新) | pass |
| 2026-07-05 | 改修後のkentei_plc.json検定がヘッドレスで引き続き合格すること(SimulationManager直接操作・activate()/start_exam()経由の両方) | pytest test_kentei.py::test_kentei_plc_bundled_rig_passes_headless, test_kentei_plc_bundled_rig_via_simulation_manager_activate | pass |
| 2026-07-05 | 実サーバー(8000)でkentei_machineをロード→kentei_plcをactivate→ネジパターンをAPI(POST /api/sim/jigs/jig1/features/screw2)で3本装着に変更→PB1で手動往復→`/api/variables`のscrew_countが3になることを確認→検定実行(手順内のset_featureで2本パターンに固定し直す)→全26ステップpassを確認→後片付け(deactivate・start_stopへ復元) | curl実測 | pass |
| 2026-07-05 | 双方向バインド機能(BindingPanel・bindings API・rename波及)がリグ書式変更(lane追加・センサー4連化)後も正しく動作すること: `GET /api/sim/rigs/kentei_plc/bindings`が変更前と同じ10件の未解決バインド(リレー接点2種・conveyor駆動2フィールド・PB3/PB4/SS0/SS1/PL3/PL4)を報告 | curl実測(改修前後で未解決バインドの件数・内容が一致することを確認) | pass |
| 2026-07-05 | フロント: DeviceCanvas.tsxのレーン対応描画(ジグのネジ穴4つが同一offset_mmで縦一列=幅方向に積まれる、4連センサーが1つのブラケットとして描画されlaneごとに縦に並ぶ、装着レーンのみ点灯、既存リグ(lane未指定)は従来通り1点描画のまま)、ネジクリック着脱(DOM実クリックで着脱→APIに反映→再往復でパターンが変わることを確認)、DPL1のカウント表示、検定合格バッジ | preview実機確認(DOM評価・アクセシビリティスナップショット。`preview_screenshot`は本セッション中も継続してタイムアウトしたため画像取得は断念——BUG-008と同種の既知事象、機能面の異常ではない)、コンソールエラーなし(既知のReact Flow nodeTypesメモ化警告のみ)、ネットワーク失敗リクエストなし | pass |

## 既知の仕様(バグではない)
- ReactFlow の nodeTypes メモ化警告(実装当初から存在、実害なし。直すなら BUG 扱いでなく改善)
- HMIタブの編集中レイアウトはタブ切替で消える(保存で永続化する設計。ユーザー合意済み)
- フロントのグループポート値表示は代表1パスのみ解決(表示上の簡略化。実行系はfan-out済み)
- PUT /api/resources の cpu_share はタスクごとに0-100へクランプされるのみで、合計が100を超えても拒否されない(デグレードポリシーは設定値ではなく実測使用率で判定するため、設計上問題ない)
- トップレベルで同一ノードidを重複させると後勝ちで上書きされる(PLCGraphがdictキー管理のため)。真の重複拒否は保存時のバリデーションが必要な仕様変更級の話であり、今回はopenのまま(下記参照)
- $parent経由のグループポート参照は、GroupPort宣言（inputs/outputs）とは独立にhandle文字列のみで解決される。宣言されていないポートidを$parentで参照してもflatten時にエラーにならず、単に誰にも消費されないフラットエッジが生えるだけ(UIメタデータであり実行時契約ではない)

## バグ台帳

| ID | 状態 | 発見日 | 症状 | 原因 | 修正 | 再発防止テスト |
|---|---|---|---|---|---|---|
| BUG-001 | verified | 2026-07-04 | ton_timer シナリオが `x_stop=true` でリセットを期待していた | 配線理解の誤り(SRのR入力は NOT(x_stop)) | シナリオ側を修正 | scripts/scenarios/ton_timer.json |
| BUG-002 | verified | 2026-07-04 | CTUカウンタ: CU信号がReset(R)パルスの間ずっとTrueのまま保持され、Rが解除された瞬間に「新規立ち上がりエッジ」として誤カウントされる(実際にはCUの0→1遷移は発生していない) | `CTUExecutor.execute`のreset分岐が`last_cu`を常に`False`に強制していたため、リセット解除時にCUが既にTrueだと偽の立ち上がりに見えていた | reset分岐で`last_cu`をCUの実際の現在値で更新するよう修正(`plc/nodes.py`) | pytest test_ctu_counter.py::test_ctu_no_spurious_count_when_reset_releases_with_cu_held |
| BUG-003 | verified | 2026-07-04 | HMI画面JSONの`widgets`がリストでない(文字列・オブジェクト等、手編集や破損ファイルに由来)場合、標準HMIページ(hmi.html)が`.forEach`で例外を投げてクラッシュしうる。フロントのHMIビルダーも`data.widgets \|\| []`が非配列を素通ししてしまい同様のリスクがあった | API層(`PUT /api/hmi/screens/{name}`)がscreenの中身を無検証で保存しており、`widgets`の型を保証していなかった | (1) API層で`widgets`が非nullかつlistでない場合は400を返すよう`backend/api/routes.py`を修正、(2) `backend/static_pages/hmi.html`の`renderScreen`に`Array.isArray`防御を追加、(3) `frontend/src/components/HmiTab/index.tsx`のロード処理に同様の防御を追加(過去に保存された不正ファイルへの後方互換) | pytest test_scheduler.py::test_hmi_screen_rejects_non_list_widgets |
| BUG-004 | verified | 2026-07-04 | プログラム切替(例: start_stop→conveyor_machine)直後、`/api/debug/events`と`/api/history/events`に旧プログラムのノードidの信号遷移が新プログラムのものと混在して残り続ける(viz_historyは正しくクリアされていたが、イベントログ2種はクリアされていなかった) | `PLCRuntime.load_program()`が`_event_log`・`_transition_events`・`_last_changes`・`_last_custom_block_status`をクリアしていなかった(node_states/current_outputs/history/io_values/viz_historyのみクリアしていた) | `plc/runtime.py`の`load_program()`に上記4つのクリア処理を追加。`_transition_seq`(seq番号の連番カウンタ)はクライアントの`since=`ポーリング互換性のため意図的に維持(リセットしない) | pytest test_debug_api.py::test_program_switch_clears_stale_events_and_history |
| BUG-005 | open (分析のみ、仕様変更級) | 2026-07-04 | `PUT /api/program`(および`/api/program/nodes`)で同一idのノードを複数トップレベルに置いた場合、ロード自体は成功し、`PLCGraph`が内部でdictキー管理しているため後勝ちで上書きされる(先勝ちノードは実行グラフから静かに消える)。500クラッシュはしないが、ユーザーは片方のノードが消えたことに気づきにくい | `PLCGraph.__init__`が`{n.id: n for n in flat.nodes}`でノードをdict化しており、id一意性を保存時点でもロード時点でも検証していない。真の修正には(a) `PUT /api/program`/`POST /api/program/nodes`でid重複を検出し400を返す、または(b) フロントのノード追加UIがuuid生成でしか新規idを発行しないため実運用では起きにくい、のいずれかの設計判断が必要で、バリデーション追加は他のAPI(add_edge重複ハンドル上書きなど)との一貫性も検討すべき仕様変更級の話 | 対応保留。現状の「後勝ち・無クラッシュ」動作をtest_malformed_programs.py::test_duplicate_top_level_node_ids_last_one_wins_no_crashで固定し、将来の意図しない変化を検出できるようにした | (対応時に別途追加予定) |
| BUG-006 | verified | 2026-07-04 | 変数マネージャーで入力(X)を強制書込した直後に`GET /api/variables`を呼ぶと、タイミング次第で書込前の古い値が返ることがある(フロントのpreview実機確認中に発見: 強制書込ボタンを押しても現在値表示が反映されないケースがあった) | `_variable_view_rows()`(`backend/api/routes.py`)が入力(X)ノードの現在値を`runtime.get_current_state()`(`_current_outputs`、直近の**完了した**スキャンの出力)から読んでおり、`force_variable`/`set_io`が更新するのは`_io_values`のみで、それが`_current_outputs`に反映されるのは**次のスキャン完了後**だった。実サーバーはスキャン間隔100msでバックグラウンド実行されているため、force直後の即時GETがこの反映前のウィンドウに当たるとレースする | `_variable_view_rows()`で入力(X)ノードの値を`runtime.get_io()`(force-writeで即座に反映される`_io_values`)から直接読むよう修正。出力(Y)は引き続き`_current_outputs`から読む(ロジック側の計算結果が値なので、こちらは意図通り) | pytest test_variables.py::test_force_input_then_immediate_list_reflects_new_value_no_race |
| BUG-007 | verified | 2026-07-05 | KENTEI-PLC検定盤(正転リレー・逆転リレーの2個で1つのコンベアを駆動)を実装中、逆転リレーのみを励磁してもジグが全く動かない(位置が凍結したまま)ことが手作業でのdry-runで発覚 | `PhysicsEngine._advance_jig`は`drive_signal`が真の場合のみ駆動し、`reverse_signal`は「駆動中の向き」を決めるだけの補助フラグという設計だった(`conveyor_exam.json`の「1つの駆動信号+方向フラグ」という前提を素直に実装した結果)。kentei_plc.jsonのように**正転・逆転が完全に独立した2つの信号**(それぞれ別のリレー接点)である構成では、逆転信号単体で駆動判定にならず、`drive_signal`(正転リレー接点)が偽のままだと逆転リレーを励磁しても永久に停止したままになる | `driving = drive_signal OR reverse_signal`(どちらか一方が真であれば駆動)へ拡張(`backend/plc/simulation.py::PhysicsEngine._advance_jig`)。`reverse_signal`が真の時点は`conveyor_exam.json`の既存配線でも`drive_signal`は既に真であるという前提が保たれているため、既存リグの挙動には影響しない | pytest test_kentei.py::test_two_relays_drive_forward_and_reverse_independently(新規動作の固定)、test_conveyor.py(既存28件、後方互換の再確認) |
| BUG-008 | verified (製品バグではなく開発環境の既知事象として記録) | 2026-07-05 | 信号ハブ機能(ノードid改名・リグバインド編集)実装後、`uvicorn --reload`で起動していた開発サーバー(ポート8000)が、`api/routes.py`・`plc/rename.py`・`plc/signal_hub.py`等への複数回の編集後、`WatchFiles detected changes ... Reloading...`のログは出るにも関わらず、実際に応答する`openapi.json`の内容が更新されず、新規追加した3エンドポイント(`/api/program/nodes/{id}/rename`, `/api/sim/rigs/{name}/bindings`, `/api/signals/usage`)が404を返し続けた(数十秒〜1分待っても解消せず) | 直接の原因は特定していないが、サーバーログに`plc/subservers.py`(HMI/vizサブサーバー、8010/8020番ポート)絡みの`asyncio.exceptions.CancelledError`や`Task was destroyed but it is pending!`が複数回出現しており、reload時の新ワーカープロセスがサブサーバーのポート再バインドに失敗して起動シーケンスが正常に完了しないまま、古いワーカーがリクエストを処理し続けていた可能性が高い(Windows環境でのuvicorn `--reload`+複数ポートバインドの既知の相性問題と推測) | 製品コードの修正ではなく、プレビュー管理下の同一起動設定(`backend`、`.claude/launch.json`)のサーバープロセスを一度停止→再起動することで解消を確認(ユーザー本人が別途起動した対話ターミナルではなく、preview機能で管理されていた同一ポートのプロセスだったため、安全に再起動可能と判断)。再起動後は`openapi.json`が即座に新エンドポイントを含むようになった | 明示的な回帰テストは追加せず(開発環境の運用上の注意点として記録)。バックエンドの機能自体は`TestClient`ベースのpytest(`test_binding.py`38件)と、再起動後の実サーバーへのcurlの両方で動作確認済み |
| BUG-009 | verified | 2026-07-05 | ユーザーがブラウザで`start_stop`プログラムがロードされた状態のまま`kentei_plc`リグを有効化して検定を開始したところ、検定手順が参照する信号(`y_ry_fwd.OUT`等)がプログラムに存在せず、ステップ⑨で「timeout: expected True, got None」という原因のわかりにくい不合格になった。`kentei_plc.json`には`target_program: "kentei_machine"`が設定されているにも関わらず、不一致でも黙って検定が開始されてしまうのが根本原因 | `POST /api/sim/exam/start`(`SimulationManager.start_exam`)が`target_program`を一切参照しておらず、`exam.steps`が参照する信号の解決状態を検定開始前に検証していなかった。`read_signal`の寛容な未知ノードフォールバック(強制I/Oストアへ)により`set`ステップは見かけ上成功してしまうため、実際に不合格になるのは最初の`expect`ステップまで進んでから、かつエラーメッセージには「プログラム不一致」だと分かる情報が一切無かった | (1) `plc/simulation.py`に`collect_exam_signals`(exam.stepsが参照する全signal抽出)・`rig_provided_signals`(リレーcontact_signal/feedback_rules.set_input/position_sensor.signalを「リグ提供の仮想信号」として除外)・`resolve_signal_kind`への`active_rig`引数(rig提供信号を`kind: "rig"`で解決済み扱い)・`SimulationManager.preflight_exam()`(未解決信号一覧を返す)・`UnresolvedSignalsError`例外を追加。`start_exam(force=False)`が未解決信号を検出した場合はこの例外を投げ、`api/sim_routes.py`が409+`{error, signals, target_program, current_program, hint}`を返すよう変更(`force=true`でスキップ可)。(2) `rig_bindings`/`GET /api/sim/rigs/{name}/bindings`にも同じ`active_rig`引数を通し、アクティブなリグ自身のリレーcontact_signalは`kind: "rig"`で解決済み表示するよう改善(従来は常に赤マークで紛らわしかった)。(3) `PLCRuntime.load_program(program, program_name=...)`+`GET /api/program/current-name`で「現在ロード中のプログラム名」をサーバー側に保持。(4) フロント`SimulationTab`に予防的警告バナー(リグ有効化時点でtarget_program不一致+bindings未解決を検出)、409受信時のダイアログ(「\<target_program\>をロードして開始」/「このまま強制実行」/「キャンセル」)、ヘッダーへの現在プログラム名表示を追加 | pytest test_kentei.py新規7件(`test_api_exam_start_rejects_with_409_when_program_mismatched`、`test_api_exam_start_succeeds_once_target_program_is_loaded`、`test_api_exam_start_force_bypasses_preflight`、`test_preflight_exam_empty_when_kentei_machine_loaded`、`test_preflight_exam_reports_missing_signals_against_wrong_program`、`test_relay_contact_signal_reported_as_resolved_kind_rig_when_active`、`test_relay_contact_signal_still_unresolved_when_rig_not_active`)。pytest全体334件パス(既存327件+新規7件)。scripts/scenario_runner.py既存シナリオ4本パス。curl実機再現(start_stopロード状態でkentei_plc検定start→409+signals内容確認→kentei_machineロード→start→全26ステップpassを確認)。フロントpreview実機確認(start_stopのままkentei_plcで検定開始→予防的バナー表示→検定開始ボタンで409ダイアログ表示→「kentei_machineをロードして開始」クリック→検定が走り出し全26ステップpassまで確認、リレーの赤い「!」マーカーがロード後に消えることを確認、コンソールエラーなし) |

## 評価セッション履歴

### 2026-07-04: 初期環境構築〜ネットワーク分離まで
- 上記「検証済みの観点」を確立。pytest 48件・シナリオ4本が常時グリーンの状態。
- ネットワーク分離(8010/8020サブサーバー)実装中 → 完了後にこの表へ追記のこと。

### 2026-07-04: ネットワーク分離・実行監視 実装完了
- 追加: `backend/plc/network_config.py`(設定の読込/検証/永続化)、
  `backend/plc/subservers.py`(uvicorn.Server を asyncio タスクとして起動/停止/再起動)、
  `backend/api/subapps.py`(役割スコープ付きFastAPIアプリ、8010=HMI/8020=viz)、
  `backend/api/network_routes.py`(`/api/network*`、8000のみ)、
  `backend/static_pages/{hmi,viz}.html`(ビルド不要のスタンドアロンページ)、
  `frontend/src/components/NetworkTab/`(5番目のタブ)。
- pytest 75件(既存48 + 新規27件 `test_network.py`)、シナリオ4本、全パス。
- `tests/conftest.py` に `PLC_DISABLE_SUBSERVERS=1` を設定し、既存テストが実ポートを
  バインドしないようにした(新規テストはASGIアプリを直接TestClientにマウントするため
  実ポート不要)。
- 実ポート検証は18000番台の一時構成(`PLC_NETWORK_CONFIG_PATH` で隔離)で実施、実サーバー
  (8000, uvicorn --reload経由でPreview起動)でも8010/8020の自動起動を確認。
- ドキュメント: `docs/NETWORK.md` 新設、`DEV_WORKFLOW.md` にポインタ追記。
- 検証用HMI画面 `backend/hmi_screens/verify_test.json`(ボタン+ランプ+ゲージ)を追加保存
  (削除せず残置 -- 標準の動作確認用画面として今後も利用可能)。

### 2026-07-04: 系統的QA(重点領域A・B)、バグ4件発見・修正 + 1件open
- 対象: 「動作のバグがまだありそう」という依頼を受け、重点領域A(未テストのブロック・
  エンジン動作)とB(API・スケジューラのエッジ)を網羅的に評価。
- 評価した観点(詳細は上の「検証済みの観点」表に追記済み): TOFF基本動作、COMP比較演算子
  6種+未知OP、AND/OR 3-4入力+未接続、CTU(PV=0・preset超過継続・reset優先)、TON(PT=0・
  1スキャンチャタリング)、SR/RS優先順位の再確認(既存テストで網羅済みと判明)、不正プロ
  グラムロード全般(存在しないノード参照・未知type・重複id・自己ループ・フィードバック
  ループ・空グループ・$parent未宣言ポート・グループ境界id重複)、PUT /api/resourcesの
  period_ms境界値・cpu_share合計超過、/api/viz/historyの未知信号、WS複数クライアント
  接続/切断/再接続、プログラム切替時の状態残留全般、リソースタブのスライダー範囲制限。
- 発見バグ:
  - **BUG-002 (verified)**: CTUカウンタが、CUが立ち上がったままResetパルスを跨いだ場合に
    reset解除の瞬間を偽の立ち上がりエッジとして誤カウントする。`plc/nodes.py`の
    `CTUExecutor`を修正(reset分岐で`last_cu`をCUの実際値で更新)。
  - **BUG-003 (verified)**: HMI画面JSONの`widgets`が配列でない場合、標準HMIページ
    (`hmi.html`)やHMIビルダー(`HmiTab/index.tsx`)がクラッシュしうる。API層
    (`backend/api/routes.py`)で保存時に400拒否するバリデーションを追加し、両フロント
    側にも防御的な`Array.isArray`チェックを追加(後方互換のため)。
  - **BUG-004 (verified)**: プログラム切替直後、`/api/debug/events`と`/api/history/events`
    に旧プログラムのノードidの信号遷移が残留し新プログラムのものと混在する。
    `plc/runtime.py`の`load_program()`にイベントログ類のクリア処理を追加(`_transition_seq`
    連番はポーリング互換性のため維持)。
  - **BUG-005 (open, 分析のみ)**: トップレベルの重複ノードidが後勝ちで静かに上書きされる。
    500クラッシュはしないため緊急性は低いが、id重複検出をどのAPI層で・どう一貫性を持って
    実施するかは仕様変更級のため今回は対応せず、現状動作をテストで固定するに留めた。
- 追加したテストファイル: `tests/test_toff_timer.py`(7件、新規)、
  `tests/test_comp_and_or.py`(10件、新規)、`tests/test_malformed_programs.py`(16件、
  新規)。既存ファイルへの追加: `test_ctu_counter.py`(+3件)、`test_ton_timer.py`(+3件)、
  `test_scheduler.py`(+5件)、`test_debug_api.py`(+1件)。
- フロント確認: preview(Vite 5173)でネットワーク/HMI/リソースタブを操作し、コンソール
  エラーなしを確認。実サーバー(8000)へのcurlでBUG-003修正(400拒否)が`--reload`経由で
  即座に反映されていることも確認。ユーザーの8000サーバー・Viteは起動したまま維持。
- 最終結果: pytest 128件全パス(約4.5秒)、シナリオ4本全パス。

### 2026-07-04: AIアシスタントのGemini対応 + 変数マネージャー(I/O・内部変数)実装完了
- **Part 1 (Gemini対応)**: `backend/ai/providers.py` を新設し、`AIProvider` インターフェース
  に `AnthropicProvider`(既存ロジックを移植)と `GeminiProvider`(新規SDK依存なし、
  既存の`httpx`でREST APIを直接叩く実装)を追加。`backend/ai/assistant.py` はツール定義・
  システムプロンプト・ツール実行ロジックを維持したまま、プロバイダ非依存の会話ループ
  (`_provider.run_turn(...)`)を呼ぶ形に書き換え。選択ロジックは`AI_PROVIDER`環境変数
  優先、未設定なら`ANTHROPIC_API_KEY`→`GEMINI_API_KEY`の順で自動判定。
  `GET /api/ai/status` を新設し、フロントのAIパネルに使用中プロバイダ名(Anthropic /
  Gemini / 未設定)のバッジを表示。
- **Part 2 (変数マネージャー)**: プログラムJSONに`variables`セクション追加
  (`plc/models.py::VariableDefinition`、既存プログラムとの後方互換あり)。
  `PLCRuntime`に変数ストア(`_variables`/`_var_values`)を追加し、ロード時に`initial`で
  初期化、信号パス規約`var.<id>`で`/api/signals`・イベントログ・vizトレンド履歴・WS状態
  配信に統合。`plc/nodes.py`に`VAR_READ`/`VAR_WRITE`ブロックを追加(存在しない変数id参照
  はクラッシュせず`_warning`+デフォルト値)。`backend/api/routes.py`に
  `GET/POST/PUT/DELETE /api/variables*`・`POST /api/variables/{id}/force`・
  `PUT /api/variables/{id}/rename`を追加。フロントはタブバー右端の「変数」ボタン→
  どのタブからも開けるモーダル(`frontend/src/components/VariablesModal/`)、
  `VAR_READ`/`VAR_WRITE`ノードコンポーネント(`NodeTypes/VarNode.tsx`、変数idを
  ドロップダウンで選択)を追加。
- 発見バグ:
  - **BUG-006 (verified)**: 変数マネージャーで入力(X)を強制書込した直後に
    `GET /api/variables`を呼ぶと、タイミング次第で書込前の古い値が返るレースコンディション
    をpreview実機確認中に発見(強制書込ボタンのUI反映が不安定に見えた)。原因は
    `_variable_view_rows()`が入力ノードの値を`_current_outputs`(直近の完了スキャンの
    出力)から読んでいたため。`_io_values`(force-writeで即座に反映)から直接読むよう
    `backend/api/routes.py`を修正。
- 追加したテストファイル: `tests/test_ai_providers.py`(16件、新規、実API呼び出しなし・
  モックhttpxクライアント)、`tests/test_variables.py`(27件、新規、うち1件がBUG-006の
  再発防止テスト)。
- curl確認: `GET /api/ai/status`(Anthropic/未設定を確認)、`GET /api/variables`、
  内部変数のPOST作成→force→`/api/variables`で値確認、`/api/signals`への`var.<id>`統合、
  入力(X)へのforce→`/api/io`反映、出力(Y)へのforce拒否(400)、rename。実サーバー
  (8000, --reload)へライブ反映されることを確認。
- フロント確認: preview(Vite 5173)で変数モーダルを各タブ(ロジック設計・HMI)から開ける
  こと、内部変数の追加/強制書込/現在値ライブ反映/コメント編集/検索フィルタ、
  VAR_READブロックをキャンバスに配置し変数ドロップダウンが正しく機能すること、AIパネルの
  プロバイダバッジ表示を確認。コンソールエラーなし。スクショ1枚取得。
  (副次的な改善: VARノードの変数ドロップダウンをアプリ起動時に即座に使えるよう、
  `App.tsx`で`loadVariables()`を起動時に事前ロードするよう変更 — 変数モーダルを一度も
  開いていない状態でVAR_READ/VAR_WRITEノードを配置した際に「不明」と表示される問題の
  UX改善)。
- 最終結果: pytest 171件全パス(約5.5秒)、シナリオ4本全パス。ユーザーの8000サーバー・
  Viteは起動したまま維持。

### 2026-07-05: シミュレーションタブ(模擬デバイス+シーケンサ検定機)実装の仕上げ・検証
- 前任エージェントがセッション上限で中断したタスクの仕上げ担当として、実装の全容確認・
  ライブ検証・フロント最終確認・ドキュメント作成を実施。**新規バグは発見されず**
  (BUG-007は採番していない)。実装は既に完成しており、TODO・未配線・未使用コードは
  見当たらなかった。
- 確認した実装(前任の成果、全てそのまま):
  - `backend/api/sim_routes.py`: リグCRUD(GET/PUT/DELETE `/api/sim/rigs*`)、
    activate/deactivate、exam start/status/abort。薄いHTTP層。
  - `backend/plc/simulation.py`: `read_signal`/`write_signal`(信号パス規約の共通実装)、
    `FeedbackRuleEngine`(プラント模擬)、`ExamRunner`(検定シーケンサ、`within_ms`/
    `after_ms`対応)、`SimulationManager`(アクティブリグ+検定ライフサイクルの
    シングルトン)。FastAPI非依存でVirtualClockから直接テスト可能な設計。
  - `backend/main.py`: `runtime.post_scan_hook = simulation_manager.feedback_tick`で
    毎スキャン後にfeedback_rulesを評価するよう結線済み。
  - `backend/sim_rigs/motor_exam.json`(feedback_rules+時間窓判定10ステップ)、
    `backend/sim_rigs/lamp_practice.json`(feedback_rulesなしの最小構成、5ステップ)。
  - `frontend/src/components/SimulationTab/{index.tsx,DeviceCanvas.tsx,ExamPanel.tsx}`:
    リグ選択/アクティブ化、5種デバイスtype(pushbutton/switch/lamp/motor/
    indicator_number)の描画、検定パネル(500msポーリング、ステップ別ステータス色分け、
    合格/不合格/中止バッジ)。`App.tsx`/`TabBar`に6番目のタブとして配線済み。
  - `frontend/src/types/index.ts`: `SimDevice`/`SimFeedbackRule`/`SimExamStep`/`SimRig`/
    `SimExamStepResult`/`SimExamStatus`型定義。
  - `backend/tests/test_simulation.py`(43件、意図的な不合格パス2件
    `test_exam_runner_fails_when_program_never_satisfies_expect`と
    `test_exam_runner_after_ms_too_early_is_a_failure`を含む)は前任が既に用意済みで
    追加不要と判断。
- ライブ検証(ユーザーの8000サーバー、`--reload`起動のまま):
  - `GET /api/program`でstart_stopプログラムがロード済みであることを確認。
  - `POST /api/sim/rigs/motor_exam/activate` → `POST /api/sim/exam/start` →
    `GET /api/sim/exam/status`を0.3秒間隔でポーリングし、`running`(ステップ0-5即pass)
    → `running`(ステップ6でTON 3秒待ち)→ `passed`(全10ステップpass)までの遷移を
    実測ログとして取得。feedback_rule(`y_motor.OUT` ON後500ms遅延で`x_motor_fb`ON)も
    ステップ③の実測elapsed_ms(518.3ms)で妥当性を確認。
  - 検証後、`POST /api/sim/deactivate` + `POST /api/program/examples/start_stop/load`で
    サーバー状態をidle/start_stopに復元。
- フロント確認(Vite previewサーバー、8000とは別インスタンス): motor_examをUIから
  アクティブ化→押しボタン(mousedown)でモーター回転アニメ+センサーランプ点灯を目視
  →検定開始ボタンで検定完走→「● 合格 (PASS)」バッジとステップ①「合格」ラベルを
  スクリーンショットで確認。コンソールエラーなし(既存のReact Flow nodeTypesメモ化警告
  のみ、既知の仕様として`QA_LOG.md`に記載済みのもの)。ネットワーク失敗リクエストなし。
  確認後、previewサーバー側のリグも念のためdeactivateして片付けた。
- 追加した成果物: `docs/SIMULATION.md`(新設。リグJSON書式、信号パス規約、
  feedback_rules、exam.stepsのop/within_ms/after_ms、状態遷移、APIリファレンス、
  「新しい検定機を作る」手順、配線上の注意点、テスト、curl手順を実装から正確に記述)、
  `DEV_WORKFLOW.md`冒頭にポインタ追記。
- 最終回帰確認: `python -m pytest tests/ -q` → **216件全パス(6.06秒)**。
  `scripts/scenarios/*.json` 4本(start_stop_basic, stop_priority, ton_timer,
  conveyor_hierarchy)全てpass。ユーザーの8000サーバー・Viteは起動したまま維持。

### 2026-07-05: コンベア搬送(ジグ移動+物理センサー反応)機能を追加実装

- 依頼: シミュレーションに「コンベア上でジグ(ワーク台)が移動する機能」「移動中、ジグ上の
  ネジ(突起)が物理センサに当たって反応する機能」を追加。引き続き全て設定(リグJSON)から
  作れること。ツール本体には汎用デバイスtypeと物理エンジン(位置積分)のみを持つ。
- 実装(新規/変更ファイル):
  - `backend/plc/simulation.py`: `PhysicsEngine`クラスを新設(conveyor/jig/
    position_sensorの位置積分+検出窓判定)。`ExamRunner`に`reset_jig` op、
    `physics`引数を追加。`SimulationManager`に`_physics_engine`を統合
    (`activate()`/`deactivate()`/`feedback_tick()`/`sim_state()`/`reset_jig()`)。
    `_reset_devices_to_default()`にジグ位置・センサー信号のリセットを追加。
  - `backend/plc/runtime.py`: `sim_state_provider`フック(注入可能、`post_scan_hook`と
    同じ設計)を追加。`_hmi_task`のWSブロードキャストに`sim_state`キーを同梱。
  - `backend/main.py`: `runtime.sim_state_provider = simulation_manager.sim_state`を配線。
  - `backend/api/sim_routes.py`: `GET /api/sim/state`、
    `POST /api/sim/jigs/{jig_id}/reset`を追加。
  - `backend/api/routes.py`: WS接続直後の初期メッセージにも`sim_state`を同梱
    (`hmi`タスクの最初のtickを待たずにジグ位置が反映されるように)。
  - `backend/sim_rigs/conveyor_exam.json`(新規): start_stop.jsonのY0出力をコンベア
    駆動に流用したサンプル検定機。conveyor(1000mm, 200mm/s) + jig(ネジ付き) +
    position_sensor(800mm) + feedback_rule(センサー検出→自動停止) + reset_jig。
  - `backend/tests/test_conveyor.py`(新規、28件): PhysicsEngineの位置積分・センサー
    検出・reset_jig・SimulationManager統合・conveyor_exam.jsonのヘッドレス完走・
    HTTP層。
  - `docs/SIMULATION.md`: コンベア/ジグ/位置センサーの書式・物理モデル(位置積分・
    検出窓のスイープ判定)・API・テスト・curl手順を追記。
- **設計上の判断・仕様からの変更点**:
  1. **センサー検出をスイープ区間判定に変更**(点サンプリングでは不十分と判明): 当初は
     tick終了時点の位置だけで`at_mm ± window_mm/2`との重なりを判定していたが、
     scan_interval_ms=100ms・speed_mm_s=200mm/sの組み合わせでは1tickの移動量が20mmと
     なり、window_mm=12mmの検出窓を跳び越えて素通りする(検出漏れ)ケースが
     `test_conveyor.py`の初期実行で実際に再現した。`PhysicsEngine`に`_prev_positions`
     (tick開始時点の位置)を追加し、「前回tickから今回tickまでに実際に通過した区間」が
     検出窓と重なるかで判定するよう修正(`_evaluate_sensors`)。これによりスキャン周期・
     速度・窓幅の組み合わせに関わらず検出漏れが起きない設計とした。
  2. **conveyor_exam.jsonの停止入力の配線方向を反転**: 当初「センサー検出→x_stopを
     Trueにして停止」という素直な設計を試みたが、`examples/start_stop.json`のSRラッチは
     `R = NOT(x_stop)`という**継続的な**配線(motor_exam.jsonと同じ既知の制約、
     docs/SIMULATION.md参照)のため、x_stopをTrueにするとむしろラッチが**保持**されて
     しまい、意図と逆の動作になることがcurl/pytestでの実行時に判明した。正しくは
     「運転を継続するにはx_stopをONにし続ける必要があり、Falseに落とすことが停止動作」
     という向き。`pb_stop`(momentaryボタン)を`sw_hold`(運転保持スイッチ)に変更し、
     `feedback_rules`は`x_screw_det`検出時に`x_stop`を**Falseへ**落とすよう設定した。
     検定手順のnote欄にこの配線上の注意を明記し、`docs/SIMULATION.md`にも追記した。
  3. **WS同梱 vs 別ポーリング**: 仕様の選択肢のうち「WSに`sim_state`を同梱」を採用
     (アニメーションが滑らかになる方)。ただし`hmi`タスクの周期配信だけでなく、
     `/ws`接続直後の初期メッセージ(`api/routes.py`)にも同梱し、WS切断時のフォール
     バックとして`SimulationTab`が200ms間隔で`GET /api/sim/state`をポーリングする
     経路も用意した(3系統: WS初期メッセージ・WS周期配信・ポーリングフォールバック)。
- 検証:
  - `python -m pytest tests/ -q` → **244件全パス(6.46秒)**(216件既存 + 28件新規
    `test_conveyor.py`)。
  - `scripts/scenario_runner.py`で既存シナリオ4本(start_stop_basic, stop_priority,
    ton_timer, conveyor_hierarchy)全てpass(回帰なし)。
  - 実サーバー(8000)でconveyor_examをactivate→検定start→`/api/sim/state`を0.3秒間隔で
    ポーリングし、ジグ位置が実時間で42mm→234mm→425mm→595mm→(センサー到達・自動停止・
    reset_jig)→0mmと滑らかに増加してから原点復帰するまでの遷移を実測ログとして取得。
    `exam/status`は全10ステップpass(ステップ⑦のセンサー検出実測elapsed_msは3498.5ms
    〜3556ms、理論値3500msに対し許容範囲3000〜4500ms内)。
  - WSの`state_update`メッセージに`sim_state`(ジグ位置/センサー状態)が同梱されることを
    Python `websockets`クライアントで直接確認(接続直後の初期メッセージ・周期配信の両方)。
  - フロント確認(Vite previewサーバー): conveyor_examをUIからアクティブ化→ベルトの
    ストライプアニメ・ジグ矩形・ネジ突起・位置センサーの描画を確認→検定開始ボタンで
    「実行中…」→ベルトアニメ+モーター回転(青色グロー)を目視→検定完走で
    「● 合格 (PASS)」バッジと全10ステップの「合格」ラベルをスクリーンショットで確認→
    「ジグ原点復帰」ボタンでジグが即座に0mmへ戻ることを確認。既存リグ(motor_exam)を
    再アクティブ化し、後方互換(コンベア関連UIが出現しないこと含む)を確認。コンソール
    エラーなし(既知のReact Flow nodeTypesメモ化警告のみ)、ネットワーク失敗リクエストなし。
  - 検証後、`POST /api/sim/deactivate`でサーバー状態をidleに復元(start_stopプログラムは
    そのままロード済み)。ユーザーの8000サーバー・Viteは起動したまま維持。

### 2026-07-05: KENTEI-PLC検定盤(リレー・ネジ着脱・複数センサー/ボタン)拡張

ユーザーが実物のシーケンサ検定盤「KENTEI-PLC」(OMRON系検定練習機)の写真を提示し、
それに合わせた3点の拡張(1. リレーでモーターが切り替わる仕組み、2. ネジの着脱、
3. センサー/ボタンの多様化)を要望。汎用デバイスtypeの追加のみをツール本体に入れ、
検定盤そのものは設定JSON+サンプルプログラムとして実装する既存方針を踏襲した。

- 追加・変更ファイル:
  - `backend/plc/simulation.py`:
    - `DEVICE_TYPES`に`relay`・`digit_switch`を追加。
    - `PhysicsEngine`に`relay`デバイス対応(`relays`辞書、`relay_energized`状態、
      `_evaluate_relays()` -- コイル信号(`coil_signal`)が真の間、接点信号
      (`contact_signal`)へ即座にtrue/falseを書込。励磁遅延なし)。`tick()`の最後に
      呼び出し(位置積分・センサー判定の後)。
    - `PhysicsEngine._advance_jig`を`driving = drive_signal OR reverse_signal`へ拡張
      (BUG-007参照。正転リレー・逆転リレーという独立した2つの駆動信号に対応するため)。
    - ジグの`features[]`に`attached`(既定true)フィールドを追加。`_evaluate_sensors`は
      `attached: false`のfeatureを検出対象から完全除外。`set_feature_attached()`
      (`PhysicsEngine`)・`set_feature_attached()`(`SimulationManager`パススルー)を
      追加、`reset_jig`と同じ「呼び出し後に即座にセンサー再評価」方針。
    - `PhysicsEngine.state()`にjigsの`features`(各featureのattachedフラグ)と
      `relays`(各リレーの励磁状態)を追加(既存の`position_mm`/`sensors`に追加する形の
      後方互換な拡張)。`SimulationManager.sim_state()`の空dictフォールバックにも
      `relays: {}`を追加。
    - `ExamRunner._run_step`に`set_feature`op(`{"op": "set_feature", "jig", "feature",
      "attached"}`)を追加。
    - `_reset_devices_to_default()`にリレー接点のリセット+再評価を追加。
  - `backend/api/sim_routes.py`: `POST /api/sim/jigs/{jig_id}/features/{feature_id}`
    (body `{"attached": bool}`)を追加。
  - `examples/kentei_machine.json`(新規): PB1(正転起動)・PB2(停止)・LS左端・LS右端・
    ネジ検出センサーを入力に、正転/逆転リレーコイル+PL1/PL2を出力に持つフラット構成
    プログラム。SR+OR(リセット条件)+出力段のAND+NOTインターロックで正転/逆転の
    同時励磁を防止。CTU+VAR_WRITEでネジ検出カウントを`var.screw_count`へ。`var.dsw`
    (DSWデジタルスイッチ用、このプログラム自体は未配線)も宣言。
  - `backend/sim_rigs/kentei_plc.json`(新規): リレー2個(正転/逆転)・conveyor(リレー
    接点経由駆動)・ジグ(ネジ穴4つ、初期はscrew1/screw4のみ装着)・両端LS・ネジ検出
    センサー・PB1〜PB5(PB5は赤の非常停止風・PB2と同じ停止入力)・SS0/SS1・PL1〜PL4・
    DSW(digit_switch→var.dsw)・DPL1(7セグ→var.screw_count)・DPL2(7セグ→var.dswの
    エコー)。検定手順23ステップ: ネジ2本パターンをset_featureで固定→PB1起動→正転
    リレー励磁+接点ON確認→往路でネジ2本検出(カウント2)→右端LSで逆転リレーへ切替
    (正転リレー接点が同時にOFFであることも確認=インターロックの実証)→復路でネジ2本
    再検出(カウント往復4)→左端LS帰着→両リレーOFF確認→PB2でカウントリセット→
    reset_jig。
  - `frontend/src/types/index.ts`: `SimDeviceType`に`relay`/`digit_switch`追加、
    `SimJigFeature.attached`追加、`SimDevice`に`coil_signal`/`contact_signal`/`digits`/
    `min`/`max`/`style`追加、`SimState`に`relays`(既存`sensors`と同形)+jigsの`features`
    追加、`SimExamStep.op`に`'set_feature'`+`feature`/`attached`フィールド追加。
  - `frontend/src/components/SimulationTab/DeviceCanvas.tsx`: `RelayDevice`(COIL/接点
    表示)・`DigitSwitchDevice`(▲▼で`min`〜`max`を増減)・`SevenSegDigit`/
    `SevenSegDisplay`(`indicator_number`の`style: "seven_seg"`用、7セグ風グリフを
    SVGでなくposition:absoluteのdiv7枚で描画)を追加。`ConveyorDevice`のジグ描画を
    `simState.jigs[id].features`(ライブのattached状態)を見て装着(明るい丸)/未装着
    (暗い破線丸)に描き分け、`featuresEditable`(検定実行中はfalse)の間はクリックで
    `POST /api/sim/jigs/{jig}/features/{feature}`をトグル呼び出しするよう変更。
    `PushbuttonDevice`に非押下時の`color`表示(既存の緑固定押下色は変えず、アイドル時の
    色だけをrigの`color`で上書き可能に。PB5の赤ボタン風表現のため)を追加。
  - `frontend/src/components/SimulationTab/index.tsx`: `DeviceCanvas`に
    `examRunning={examStatus?.state === 'running'}`を渡し、検定実行中はネジ着脱を
    無効化。
  - `frontend/src/store/plcStore.ts`: `simState`初期値に`relays: {}`を追加。
  - `backend/tests/test_kentei.py`(新規、30件): relay(コイル→接点・励磁遅延なし・
    リレー接点経由でのconveyor駆動・正転/逆転2リレーの独立駆動)、ネジ着脱
    (デフォルトattached・検出除外・ライブ切替・exam op・sim_stateへの反映・404系)、
    digit_switch書込、kentei_machineのPLCロジック(ラッチ・LS切替・全停止・カウント
    リセット・エッジのみカウント・インターロック)、kentei_plc.jsonのヘッドレス完走
    (2経路)、HTTP層。全て`VirtualClock`駆動(実sleepなし)。
  - `backend/tests/test_conveyor.py`: `PhysicsEngine.state()`/`SimulationManager.
    sim_state()`の戻り値に`relays`キーが増えたことに伴い、既存の完全一致アサーション
    3箇所を`{"jigs": {}, "sensors": {}, "relays": {}}`へ更新(値そのものの検証内容は
    変更なし)。
  - `docs/SIMULATION.md`: relay・digit_switch・indicator_numberのseven_segスタイル・
    ネジ着脱(feature.attached)・関連API・exam opの書式、kentei_plc.jsonの実装ノートを
    追記。
  - `docs/QA_LOG.md`(本ファイル): BUG-007追記、検証済み観点の追記、本セッション記録。
- **設計上の判断・仕様からの変更点**:
  1. **PhysicsEngineの駆動判定を`drive_signal OR reverse_signal`へ拡張**(BUG-007)。
     正転/逆転リレーという独立した2つの駆動信号を持つ構成に対応するため。既存の
     `conveyor_exam.json`(単一drive_signal+方向フラグ)への影響がないことをテストで
     固定。
  2. **リレーに励磁遅延を入れない**(仕様の「励磁遅延は不要でよい」という許可に従った、
     即時反映)。
  3. **relay/digit_switchはPhysicsEngineに相乗り**(専用の別エンジンを作らず、
     `tick()`の中で`_evaluate_relays()`を呼ぶ形にした)。理由: どちらも「毎スキャン
     信号を読んで別の信号へ反映する」という一枚岩の責務で、既存のFeedbackRuleEngine/
     PhysicsEngineの分割基準(前者はdelay付き汎用フック、後者は位置積分+窓判定という
     具体的な物理モデル)のどちらにも部分的に似るが、コンベア/ジグ/センサーと同じ
     「パネルデバイスの毎スキャン評価」という性質が強いためPhysicsEngine側に寄せた。
     digit_switchは逆にエンジン側の処理が一切不要(フロントの書き込みのみ)なため、
     `DEVICE_TYPES`への追加のみで済んでいる。
  4. **PB5を「PB2と同じ停止入力にバインドされた別デバイス」として実装**(仕様の
     「pb2と同じ停止に繋いでよい」を採用): PLCプログラム側に専用ノードを作らず、
     リグJSON側で`signal: "x_pb2"`を共有させるだけにした。もう1つの入力ノードを増やす
     設計も可能だったが、実物の検定盤でも非常停止ボタンは既存の停止回路に直接割り込む
     配線が一般的なため、この方が実配線に近いと判断した。
  5. **DPL2は`var.dsw`のエコー表示**(仕様の「エコーでよい」を採用): PLCプログラムに
     専用ロジックを組まず、リグ側でDPL1と同じ`var.dsw`を指す`indicator_number`
     デバイスとして配置した。
  6. **screw_countの往復カウント設計**: ネジ検出センサーをコンベア中間の固定点
     (`at_mm=450`)に置き、ジグ上のネジ(feature)が通過するたびに1回ずつ検出される
     設計とした(既存のPhysicsEngine仕様どおり)。2本装着で往復すると理論上4回
     (2本×往復2回)検出されることを、まずヘッドレスのdry-runスクリプトで実測して
     数値(コンベア速度100mm/s、ネジのoffset_mm、センサー位置)を決めてからリグJSONに
     反映した(机上計算だけでなく実際にPhysicsEngineを動かして検証するアプローチを
     採用)。
- 検証:
  - `python -m pytest tests/ -q` → **274件全パス(約7秒)**(244件既存 + 30件新規
    `test_kentei.py`)。ただし`test_scheduler.py::test_hmi_screen_rejects_unsafe_name`
    が本セッションと無関係に単独でも失敗することを確認(starlette 0.38.6/fastapi
    0.115.0の`..%2f`パス正規化に起因すると推測される既存の環境依存フレークで、
    シミュレーション/KENTEI-PLC関連の変更とは無関係。別タスクとして切り出し済み)。
  - `scripts/scenario_runner.py`で既存シナリオ4本(start_stop_basic, stop_priority,
    ton_timer, conveyor_hierarchy)全てpass(回帰なし)。
  - 実サーバー(8000)で`kentei_machine`をロード→`kentei_plc`をactivate→
    `GET /api/sim/state`で初期状態(screw1/screw4のみattached、ls_left=true、両リレー
    false)を確認→検定start→`/api/sim/state`を2秒間隔でポーリングし、リレー接点が
    `ry_fwd:true`→(右端LS到達で)`ry_fwd:false, ry_rev:true`→(左端LS到達で)両方false
    へ切替わる様子と、ジグ位置が0→約593mm→(逆転)→0mmと往復する様子を実測ログとして
    取得。`exam/status`は全23ステップpass。ネジ穴4(`screw4`)をAPIから直接
    `attached: false`に変更→再度PB1操作(手動)→往復カウントが2(1本×往復2回)になる
    ことを`GET /api/variables`(`screw_count`)で確認→ネジを再装着し`reset_jig`+PB2で
    後片付け。
  - フロント確認(Vite previewサーバー): `kentei_plc`をUIからアクティブ化→リレー箱
    (COIL/接点表示)・コンベア上のジグ(ネジ穴4つの丸/空き穴描画)・両端LS・ネジ検出
    センサー・PB1〜PB5(PB5が赤いボタンとして描画されることを確認)・SS0/SS1・
    PL1〜PL4・DSW(▲▼クリックで0→1→2→3と増加、DPL2が同じ値をエコー表示)・
    DPL1/DPL2の7セグメント描画を確認。ジグ上のネジをクリックして着脱→暗い破線丸
    (空き穴)⇔明るい丸(装着)の切替と、`GET /api/sim/state`への即時反映を確認。
    PB1(mousedown/mouseup)クリック→正転リレーのCOIL/接点がONになる表示→ジグが
    右へ搬送されるアニメーション→右端到達で逆転リレーへ切替(正転リレーが同時にOFFに
    なる表示)を確認→ジグが左端へ帰着→DPL1のカウント表示が「04」になることを確認。
    検定開始ボタン→ステップが順にpending→running→合格と遷移し、最終的に
    「● 合格 (PASS)」バッジと全23ステップの合格ラベルを確認(DOM上でも合格バッジ数23・
    不合格0を確認)。コンソールエラーなし(既知のReact Flow nodeTypesメモ化警告のみ)、
    ネットワーク失敗リクエストなし。
  - 検証後、ネジ配置(screw1/screw4装着)を元に戻し`reset_jig`、`POST
    /api/sim/deactivate`でサーバー状態をidleに復元、`start_stop`プログラムを再ロード。
    ユーザーの8000サーバー・Viteは起動したまま維持。

### 2026-07-05: 信号ハブ(ノードid改名・リグバインド編集・使用箇所/未解決参照)実装完了

- 目的: ロジック設計の信号(ノードid)とシミュレーション(リグ)の信号を、どちらからも
  発見でき、どちらからも紐付けられるようにする(docs/VARIABLES.md「6. 信号ハブ」参照)。
  従来はリグの信号名に合わせるにはサンプル改造かJSON手編集しかなかった。
- 実装した3本柱:
  1. **ノードid改名**: `POST /api/program/nodes/{id}/rename`(新規 `backend/plc/rename.py`)。
     命名規則/予約語/重複の検証、トップレベル+ネストしたグループ内でのエッジ張替え、
     `backend/sim_rigs/*.json`・`backend/hmi_screens/*.json`への波及更新(旧idを参照する
     signal/drive_signal/reverse_signal/coil_signal/contact_signal/watch/set_input/exam
     stepsのsignalを新idへ書換え)、アクティブなリグ(メモリ内)への即時反映、
     `runtime.load_program()`による実行中プログラムへの即時反映。フロントは
     `BaseNode.tsx`(全リーフノード共通、idバッジをダブルクリックで編集)・
     `GroupNode.tsx`(✎ボタン、drill-downの既存ダブルクリックと衝突しないよう分離)・
     `RenameNotice.tsx`(波及更新のトースト通知)。`POST /api/program/nodes`にも明示id
     指定を追加(重複/不正拒否含む)。
  2. **リグバインド編集**: `GET /api/sim/rigs/{name}/bindings`(新規、
     `plc/simulation.py::rig_bindings`/`resolve_signal_kind`)が各デバイスの信号フィールド
     の解決状態(resolved/kind: var\|input\|output\|none)を返す。フロントは
     `SimulationTab`に「✎ バインド編集」トグル(検定実行中は無効化)、`DeviceCanvas`に
     未解決デバイスの赤マーカー(編集モードに関わらず常時表示)、新規
     `BindingPanel.tsx`(信号ピッカー+自由入力、保存は既存`PUT /api/sim/rigs/{name}`、
     未解決信号への「入力ノードとして作成」「変数として作成」ショートカット)。
  3. **信号ハブ(双方向の発見)**: `GET /api/signals/usage`(新規 `backend/plc/signal_hub.py`)
     が各信号のused_by(logic edge数、hmi_screens、sim_rigs)とunresolved(リグ/HMIが
     参照しているが現在のプログラムに存在しない信号、複数ファイルからの同一参照は1エントリに
     マージ)を返す。`VariablesModal`に使用箇所バッジ列(UsageBadges)と「未解決の参照」
     セクション(UnresolvedSection、同じ作成ショートカット)を追加。
- 重要な設計判断(詳細はdocs/VARIABLES.md §7、docs/SIMULATION.md「リグバインド編集」参照):
  - `resolve_signal_kind`は既存の寛容な`read_signal`(未知ノードidでも強制I/Oストアへ
    フォールバック)とは別物で、「現在のプログラムに実在するか」を厳密に判定する。そのため
    `kentei_plc.json`のリレー接点(`ry_fwd_contact`等、リグ内部だけの仮想信号)も
    「未解決」扱いになる——バグではなく、リグ設計として正常。
  - ノードid改名の重複チェックはツリー全体(全グループ内含む)でグローバルに行う(既存の
    BUG-005が指摘するトップレベルのみの緩いチェックより厳しい基準)。
  - リグ波及更新は「文字列としてold_idを参照している箇所」を無条件で書き換える(意図判定は
    行わない)——更新し忘れのリスクより安全と判断。
  - リグバインド編集の検定実行中ロックはフロント側の運用ルールのみ(サーバーAPIは
    ロックしない)。
- 新規ファイル: `backend/plc/rename.py`、`backend/plc/signal_hub.py`、
  `backend/tests/test_binding.py`(38件)、
  `frontend/src/components/RenameNotice.tsx`、
  `frontend/src/components/SimulationTab/BindingPanel.tsx`。
- 変更ファイル(バックエンド): `backend/api/routes.py`(rename/usage エンドポイント、
  add_nodeへのid検証追加)、`backend/api/sim_routes.py`(bindings エンドポイント)、
  `backend/plc/simulation.py`(`resolve_signal_kind`/`rig_bindings`/`DEVICE_SIGNAL_FIELDS`
  追加)。
- 変更ファイル(フロントエンド): `frontend/src/types/index.ts`(RenameNodeResult/
  SignalUsage/UnresolvedReference/SignalsUsageReport/RigBinding型追加)、
  `frontend/src/store/plcStore.ts`(renameNode/loadSignalsUsage/lastRenameNotice等)、
  `frontend/src/components/NodeTypes/BaseNode.tsx`(SignalIdBadge)、
  `frontend/src/components/NodeTypes/GroupNode.tsx`(改名UI)、
  `frontend/src/components/SimulationTab/index.tsx`(バインド編集モード配線)、
  `frontend/src/components/SimulationTab/DeviceCanvas.tsx`(editMode/unresolvedマーカー/
  クリックハンドラ)、`frontend/src/components/VariablesModal/index.tsx`
  (UsageBadges/UnresolvedSection)、`frontend/src/App.tsx`(RenameNotice マウント)。
- 検証:
  - `python -m pytest tests/ -q` → **312件全パス(約8秒)**(既存274件 + 新規
    `test_binding.py` 38件)。既知の`test_hmi_screen_rejects_unsafe_name`は本セッション
    開始時点で既に修正済みで既にpassしていた(別セッションで対応完了と判断)。
  - `scripts/scenario_runner.py`で既存シナリオ4本(start_stop_basic, stop_priority,
    ton_timer, conveyor_hierarchy)全てpass(回帰なし)。
  - 実サーバー(8000)への curl 確認: `kentei_machine`ロード→`x_pb1`を`x_pb1_renamed`へ
    改名→レスポンスで`updated_refs.sim_rigs: ["kentei_plc"]`を確認→
    `sim_rigs/kentei_plc.json`のpb1デバイスの`signal`が実際に`"x_pb1_renamed"`へ書き
    換わっていることをファイル直読みで確認→プログラムの`x_pb1`が消え`x_pb1_renamed`に
    なっていることを確認→改名を元に戻す→ファイルが意味的に元通り(整形のみ差分)である
    ことを確認。`GET /api/signals/usage`で`kentei_plc`の`x_pl3_unused`/`x_pl4_unused`
    (PL3/PL4の意図的な未配線デモ)が`unresolved`に正しく列挙されることを確認。
    `GET /api/sim/rigs/kentei_plc/bindings`でも同様に未解決10件(PB3/PB4/SS0/SS1/
    PL3/PL4/リレー接点2種/conveyor駆動2フィールド)を確認——リレー接点は仮想信号のため
    想定どおりの「未解決」。
  - 途中、開発サーバー(uvicorn --reload)がコード変更を検知はするものの実際には反映
    されない事象に遭遇(BUG-008として記録)。同一起動設定のプレビュー管理プロセスを
    再起動して解消を確認。
  - フロント確認(Vite previewサーバー、`preview_eval`/`preview_snapshot`経由。
    `preview_screenshot`はこのセッション中終始タイムアウトし続けたため画像取得は断念、
    アクセシビリティスナップショットとDOM評価で代替——ページ自体は`readyState=complete`
    かつ全操作に正常応答しており、機能面の異常ではないと判断):
    1. ロジック設計タブでノード(`x_start`)のidバッジをダブルクリック→
       `x_start_button`へ改名→キャンバス上に新idバッジが即座に反映され、NOT/SR等への
       接続(エッジ)が維持されていることを確認→リロード後も改名がサーバー側に永続化
       されていることを確認→curlで`x_start`へ復元。
    2. シミュレーションタブで`kentei_machine`+`kentei_plc`をアクティブ化→
       「✎ バインド編集」トグル→PB3/PB4/SS0/SS1/PL3/PL4/リレー2個に赤い「!」マーカーが
       表示されることを確認(編集モードOFFでも表示されることを確認)→PL3デバイスを
       クリック→バインドパネルが開き「未解決」バッジと「入力ノードとして作成
       (x_pl3_unused)」ボタンが表示されることを確認→クリック→
       `POST /api/program/nodes`経由で`x_pl3_unused`が作成され「作成しました ✓」表示に
       切替ることを確認→作成したノードを削除、リグを非アクティブ化、`start_stop`へ復元。
    3. 変数マネージャーモーダルを開き、`x_start`行の使用箇所バッジに
       「ロジック×1 / HMI:main / HMI:verify_test / リグ:conveyor_exam / リグ:motor_exam」
       が表示されることを確認→「未解決の参照 (21)」セクションが表示され、
       `kentei_plc`が参照する`pl1.OUT`/`var.dsw`等(プログラムページ切替前の状態)が
       正しく列挙され、変数系は「変数として作成」・ノード系は「入力ノードとして作成」の
       ラベルが正しく出し分けられていることを確認。
    - コンソールエラー: セッション中盤の反復編集中の一時的なHMRリロード失敗ログ(6件、
      すべて最終的なファイル内容確定前の中間状態に起因、`tsc --noEmit`・`npm run build`
      ともにエラーゼロを確認済み)以外、新規のランタイムエラーなし。ネットワーク失敗
      リクエストなし。
  - 検証後、`sim_rigs/`・`hmi_screens/`ディレクトリが検証開始前と同じ4ファイル/2ファイル
    構成に戻っていることを確認(誤って作成した一時ファイルは全て削除)。プログラムは
    `start_stop`、アクティブなリグはnullの状態でセッション終了。

### 2026-07-05: KENTEI-PLC「レーン」拡張(ネジ穴+センサーの幅方向配置) + ADDブロック新設

実機KENTEI-PLCと同様、ジグのネジ穴とセンサーをコンベア進行方向に対して**垂直(幅方向)**
に並べ、各センサーが自分のレーンのネジだけを検出する構成へ拡張した。ジグ通過時に装着
パターン(どのレーンにネジがあるか)を複数入力として同時に読める形にするのが目的。

- **物理モデル拡張** (`backend/plc/simulation.py`): `jig.features[]`と
  `position_sensor`の両方に`lane`(整数、既定0)を追加。`_evaluate_sensors`で
  `detect: "feature"`のセンサーは`sensor.get("lane", 0) != feat.get("lane", 0)`なら
  即スキップするフィルタを追加(既存のattached除外・スイープ区間判定ロジックはそのまま
  維持、レーン判定はその手前に挿入)。`detect: "jig"`はlaneを一切見ない(ジグ本体検出
  なので幅方向の区別が無意味)。`PhysicsEngine.state()`のfeaturesエントリに`lane`も
  同梱するよう拡張(フロント描画用)。後方互換: `lane`未指定は両側とも暗黙のレーン0
  として扱われるため、既存rig(conveyor_exam.json等)は無改修で動作継続。
- **ADDブロック新設** (`backend/plc/nodes.py::ADDExecutor`): 2〜4入力(IN1〜IN4)の
  数値/bool合算、bool入力は0/1として加算、未接続ポートは0扱い(AND/ORと同じ「absent
  port」規約)、整数和はint型のまま返す(7セグ表示で"2.0"ではなく"2"と出るように)。
  `_EXECUTOR_CLASSES`/`NODE_CATALOG`に登録し`GET /api/catalog`へ自動反映。フロント
  (`frontend/src/components/NodeTypes/ADDNode.tsx`、LogicNodeのAND/ORと同じ
  IN1〜IN4スタック型ハンドル+Σ表示)・パレット(`BlockPalette/index.tsx`)にも追加。
- **kentei_plc.json改修**: ジグのネジ穴4つを全て`offset_mm=60`(ジグ中央)・
  `lane`のみ0〜3に変更(幅方向一列)。初期装着はlane0・lane2の2本
  (`screw1`/`screw3`)。ネジ検出センサーを`sens_screw`単体から`sens1`〜`sens4`の
  4連(全て`at_mm=450`でlaneのみ異なる、信号`x_sens1`〜`x_sens4`)へ変更。レイアウトも
  4連センサーがベルトを横切るブラケット状に見える座標に変更。
- **examples/kentei_machine.json改修**: センサー入力を4点(`x_sens1`〜`x_sens4`)に。
  各レーンをSRラッチ(`lat_sens1`〜`lat_sens4`、S=対応センサー、R=`PB1 OR PB2`)で保持
  し、ジグが一瞬で通過してもレーンの検出結果を取りこぼさないようにした(以前の単一
  センサー+CTUのカウントアップ方式から、レーンごとの状態ラッチ+ADD合算方式へ設計変更
  -- 複数レーンを「同時入力」として扱う要件に対しCTUの単一エッジカウントでは表現でき
  なかったため)。4つのラッチ出力を新設ADDブロックで合算し`var.screw_count`へ
  `VAR_WRITE`(DPL1表示)。往復ロジック(正転→右端LSで逆転→左端停止、AND+NOT
  インターロック)は無改修のまま維持。
- **検定手順(kentei_plc.jsonのexam)更新**: 26ステップ。set_featureでレーン0・2の
  2本パターンに固定→PB1起動→往路で`x_sens1`/`x_sens3`のみ同時検出(`x_sens2`/
  `x_sens4`は無反応)を確認→ラッチ→ADD合算で`screw_count=2`を確認→右端LSで逆転切替
  (インターロック確認)→復路でもラッチが保持され`screw_count`は2のまま変化しない
  ことを確認(往復で加算されるのではなく、レーンごとに1回ラッチされた本数を表示し
  続ける仕様と判断 -- 元の単一センサー+CTU方式は「通過ごとに+1」だったが、レーン
  ラッチ方式では「そのレーンにネジがあるかどうか」を保持するのが自然なため、往復で
  カウントが変わらない仕様へ変更した)→左端LS帰着→PB2でラッチ・カウントをリセット
  →reset_jig。
- **判断: 往復でのカウント倍加をやめた** -- 元の実装(単一センサー+CTU)は「ネジが
  センサーを通過するたびに+1」だったため、装着本数2本のジグが往復すると最終的に
  カウントが4になる仕様だった。レーン拡張後は「レーンごとに1回ラッチ」という設計に
  したため、往復してもカウントは装着本数(2)のまま変わらない。これは要求仕様
  ("装着パターンが複数入力として同時に読める構成")により忠実な解釈であり、検定手順の
  期待値・description文もこの新仕様に合わせて全面的に書き直した。
- **フロント** (`DeviceCanvas.tsx`): `groupByLane`ヘルパーを追加し、同じ`offset_mm`
  (ジグのfeature)/`at_mm`(センサー)を共有する複数laneのdevice/featureを縦一列
  (13px間隔)に積んで描画するよう変更。4連センサーは1つの「ブラケット」(縦棒+lane数
  分のドット)として描画。単一laneしかない場合(既存rigの後方互換ケース)は従来通り
  1点描画のまま(視覚的な変化なし)。`types/index.ts`に`SimJigFeature.lane`/
  `SimDevice.lane`(position_sensor用)/`SimState.jigs[].features[].lane`を追加。
- 変更/追加ファイル:
  - バックエンド: `backend/plc/simulation.py`(lane判定・state()拡張)、
    `backend/plc/nodes.py`(ADDExecutor新設)、`backend/sim_rigs/kentei_plc.json`
    (4レーン化)、`examples/kentei_machine.json`(レーンラッチ+ADD構成へ全面改修)、
    `backend/tests/test_kentei.py`(既存テストのシグナル名更新21件 + 新規15件
    [レーン10件+ADD5件相当、内訳は上表参照])。
  - フロントエンド: `frontend/src/components/NodeTypes/ADDNode.tsx`(新規)、
    `frontend/src/components/NodeTypes/index.tsx`(ADD登録)、
    `frontend/src/components/BlockPalette/index.tsx`(ADDパレット項目追加)、
    `frontend/src/components/SimulationTab/DeviceCanvas.tsx`(レーン対応描画、
    `groupByLane`ヘルパー)、`frontend/src/types/index.ts`(`lane`フィールド追加)。
  - ドキュメント: `docs/SIMULATION.md`(「レーン」節新設、KENTEI-PLC実装ノート・
    テスト件数・curl確認例を新設計に合わせ全面更新)、`docs/QA_LOG.md`(本項)。
- 検証:
  - `python -m pytest tests/ -q` → **327件全パス(約8秒)**(既存312件のうち
    `test_kentei.py`の21件を新設計向けに更新 + 新規15件)。
  - `scripts/scenario_runner.py`で既存シナリオ4本(start_stop_basic, stop_priority,
    ton_timer, conveyor_hierarchy)全てpass(回帰なし)。
  - 実サーバー(8000)への curl 確認: `kentei_machine`ロード→`kentei_plc`をactivate→
    `GET /api/sim/state`でlane情報(`{"attached":true,"lane":0}`等)が正しく返ることを
    確認→`POST /api/sim/jigs/jig1/features/screw2`でlane1のネジを追加装着(3本
    パターンに変更)→PB1を手動で押して往復させ、`GET /api/variables`の`screw_count`が
    3になることを確認→さらにlane3も装着して4本全部にし、`screw_count`が4になることを
    確認→検定実行(手順内のset_featureで2本パターンに固定し直す)→全26ステップpassを
    確認→`GET /api/sim/rigs/kentei_plc/bindings`で未解決バインドが改修前と同じ10件
    (リレー接点2種・conveyor駆動2フィールド・PB3/PB4/SS0/SS1/PL3/PL4)のままである
    ことを確認(双方向バインド機能がリグ書式変更の影響を受けていないことの確認)→
    後片付け(deactivate、`start_stop`へ復元)。
  - フロント確認(Vite previewサーバー、`preview_eval`/`preview_snapshot`経由。
    `preview_screenshot`は本セッション中も一貫してタイムアウトし続けたため画像取得は
    断念——BUG-008と同種の既知事象で、アクセシビリティスナップショット・DOM評価では
    ページは正常応答しており機能面の異常ではないと判断):
    1. `kentei_machine`ロード→シミュレーションタブで`kentei_plc`をactivate→
       ジグのネジ穴4つのDOM座標を確認し、同一`left`(同一offset_mm)で異なる`top`
       (9.5px刻み)に積まれていることを確認(幅方向一列描画の実証)。
    2. ネジ検出センサー4連が1つの`title`要素("4連"を含む)にグループ化されており、
       内部にlane0〜3の4個のドットが`lane=`付きtitleでスタックされていることを確認
       (ブラケット状描画の実証)。
    3. ジグのネジ穴("ネジ穴4(レーン3)")のDOM要素を実際に`.click()`して着脱→
       `GET /api/sim/state`でその場でattachedがtrueに変わったことを確認(クリック
       着脱ハンドラが新レイアウトでも機能していることの実証)。
    4. PB1を実クリック(mousedown/mouseup)して往復させ、`GET /api/sim/state`/
       `GET /api/variables`でscrew_countが装着本数と一致することを確認。
    5. 「検定開始」ボタンを実クリックして検定を実行→約16秒後に
       `state: "passed"`、UIスナップショット上に「● 合格 (PASS)」バッジと全26
       ステップの「合格」表示(各ステップの実測msも含む)を確認。
    - コンソールエラー: 新規のランタイムエラーなし(既知のReact Flow nodeTypes
      メモ化警告のみ、本セッション開始前から存在)。ネットワーク失敗リクエストなし。
  - `npx tsc --noEmit`・`npm run build` ともにエラーゼロを確認。
  - 検証後、シミュレーションタブを非アクティブ化・プログラムを`start_stop`へ復元した
    状態でセッション終了。新規のバグは発見しなかった(BUG-009は採番せず)。

### 2026-07-05: 検定開始プリフライトチェック(BUG-009)

ユーザー報告: `start_stop`プログラムがロードされた状態のまま`kentei_plc`リグを有効化して
検定を開始すると、検定手順が参照する信号(`y_ry_fwd.OUT`等)がプログラムに存在せず、
ステップ⑨で「timeout: expected True, got None」という原因のわかりにくい不合格になる。
リグには`target_program: "kentei_machine"`が設定されているにも関わらず、不一致でも
黙って検定が始まるのが原因(BUG-009として台帳に記録、詳細は上記バグ台帳参照)。

- 実装:
  1. **検定開始時のプリフライトチェック**(`backend/plc/simulation.py`):
     `collect_exam_signals`(exam.stepsのsignalフィールドを収集)・`rig_provided_signals`
     (リレーの`contact_signal`・`feedback_rules[].set_input`・`position_sensor.signal`を
     「リグ自身が提供する仮想信号」として除外 -- `read_signal`の既存の寛容なフォール
     バックと整合させるため。これが無いと`motor_exam.json`の`x_motor_fb`のような正規の
     仮想信号が、正しいtarget_programロード時でも誤って未解決判定されてしまう)・
     `resolve_signal_kind`への`active_rig`引数(rig提供信号を`kind: "rig"`で解決済み
     扱い)・`SimulationManager.preflight_exam()`・`UnresolvedSignalsError`例外を追加。
     `start_exam(force=False)`が未解決信号を検出すると例外を投げ、
     `api/sim_routes.py::start_exam`が409 `{"error": "unresolved_signals", "signals":
     [...], "target_program": ..., "current_program": ..., "hint": ...}`を返す
     (`force: true`をbodyに渡せばスキップして従来通り開始できる)。
  2. **リグバインドAPIの整合**: `GET /api/sim/rigs/{name}/bindings`(`rig_bindings`)にも
     同じ`active_rig`引数を通し、`name`が現在アクティブなリグの場合はリレーの
     `contact_signal`を`resolved: true, kind: "rig"`で報告するよう改善(従来は常に
     赤い「!」マーカーが付き紛らわしかった -- PL3/PL4のような意図的未配線は引き続き
     未解決のまま)。
  3. **現在ロード中のプログラム名の追跡**: `PLCRuntime.load_program(program,
     program_name=...)`(既定`None`)+新設`GET /api/program/current-name`
     (`{"name": str|null, "node_count": int}`)。`api/routes.py::load_program_example`
     と`main.py::load_example`から呼び出し時に渡すよう変更。
  4. **フロント(`SimulationTab/index.tsx`)**: (a) ツールバーに現在ロード中のプログラム
     名を常時表示(`usePLCStore.currentProgramName`/`loadCurrentProgramName`、新設)、
     (b) リグ有効化時点でtarget_program不一致+bindings未解決を検出した場合の予防的
     警告バナー(「対象プログラム: kentei_machine(未ロード。現在: start_stop)」+
     「kentei_machineをロード」ボタン)、(c) 409受信時のモーダルダイアログ
     (target_program・現在のプログラム・未解決信号数と一覧+「\<target_program\>を
     ロードして開始」/「このまま強制実行」/「キャンセル」の3ボタン)、(d) プログラムが
     切り替わったタイミングでbindingsを再取得するeffectの依存配列に`currentProgramName`
     を追加(これが無いと「ロードして開始」直後もリレーの赤マーカーが古い解決状態の
     まま残り続けるフロント側の実装バグに気づいた -- 検証中にpreviewで発見し即修正)。
- 検証:
  - `python -m pytest tests/ -q` → **334件全パス(約8秒)**(既存327件+新規7件、
    test_kentei.pyに追加: `test_api_exam_start_rejects_with_409_when_program_mismatched`、
    `test_api_exam_start_succeeds_once_target_program_is_loaded`、
    `test_api_exam_start_force_bypasses_preflight`、
    `test_preflight_exam_empty_when_kentei_machine_loaded`、
    `test_preflight_exam_reports_missing_signals_against_wrong_program`、
    `test_relay_contact_signal_reported_as_resolved_kind_rig_when_active`、
    `test_relay_contact_signal_still_unresolved_when_rig_not_active`)。
  - `scripts/scenario_runner.py`で既存シナリオ4本(start_stop_basic, stop_priority,
    ton_timer, conveyor_hierarchy)全てpass(回帰なし)。
  - 実サーバー(8000)へのcurl再現: `start_stop`ロード状態で`kentei_plc`をactivate→
    検定start→409(`signals`に`y_ry_fwd.OUT`等、`target_program: "kentei_machine"`、
    `current_program: "start_stop"`を確認)→`kentei_machine`をロード→再activate→
    検定start→200/running→約6秒後`state: "passed"`(全26ステップpass)を確認。
    `force: true`での強制開始(`start_stop`ロードのまま200/running)も確認。
    後片付け(jig reset、deactivate、`start_stop`へ復元)。
  - フロント確認(Vite previewサーバー、`preview_eval`/`preview_snapshot`経由。
    `preview_screenshot`は本セッションでもタイムアウトし続けたため画像取得は断念
    -- BUG-008と同種の既知事象、機能面の異常ではない):
    1. `start_stop`ロード状態で`kentei_plc`をactivate→ヘッダーに「プログラム:
       start_stop」表示、予防的警告バナー「⚠ 対象プログラム: kentei_machine
       (未ロード。現在: start_stop)」+「kentei_machineをロード」ボタンの表示を確認。
    2. 「検定開始」ボタンをクリック→409ダイアログが表示され、target_program・
       現在のプログラム・未解決信号数(4件)と一覧(`x_pb1, y_ry_fwd.OUT,
       var.screw_count, x_pb2`)が正しく表示されることを確認。
    3. 「kentei_machineをロードして開始」ボタンをクリック→
       `GET /api/program/current-name`が`kentei_machine`に切り替わり、検定が
       自動的に再開始されることを確認(初回の実装では`preflightError`が`null`の
       時点(予防的バナー経由)でこのボタンが無反応になるフロント側バグを発見し
       修正 -- `target_program`を引数として明示的に渡すよう変更)。
    4. 検定が進行し、リレー(`ry_fwd`/`ry_rev`)の赤い「!」マーカーが消えて
       「COIL 接点 ON/OFF」表示に切り替わることを確認(bindings再取得effectの
       依存配列修正が効いていることの実証)。約6秒後「● 合格 (PASS)」バッジと
       全26ステップの「合格」表示を確認。
    - コンソールエラー: なし。ネットワーク失敗リクエストなし。
  - `npx tsc --noEmit`でエラーゼロを確認。
- 変更ファイル: `backend/plc/simulation.py`、`backend/api/sim_routes.py`、
  `backend/plc/runtime.py`、`backend/api/routes.py`、`backend/main.py`、
  `backend/tests/test_kentei.py`、`frontend/src/types/index.ts`、
  `frontend/src/store/plcStore.ts`、`frontend/src/components/SimulationTab/index.tsx`、
  `docs/SIMULATION.md`、`docs/QA_LOG.md`(本項)。
