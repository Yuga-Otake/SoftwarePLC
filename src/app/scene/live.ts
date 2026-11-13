/** シミュレーション等から渡される表示用のライブ状態 (任意)。 */
export interface LiveState {
  /** ストッパ開度 0..1 */
  open?: number;
  /** 検査中か */
  inspecting?: boolean;
  lastResult?: 'ok' | 'ng' | null;
  /** センサ検出中 */
  detecting?: boolean;
  /** 故障などで赤点滅させる */
  fault?: boolean;
  /** コンベヤのモータが回っている (矢印を動かす) */
  running?: boolean;
}
