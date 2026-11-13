/**
 * モジュール間の契約 (型のみ)。実装は各ディレクトリ。
 * src/core は React / three.js に依存しない純 TypeScript で、Node 上で全テスト可能であること。
 *
 * このファイルはアーキテクチャ契約。変更は主任アーキテクトの判断を要する。
 */
import type { LineIR, PatchOp, LibraryItemId, Equipment } from './ir/schema';

/* ═════════════ ir/ : パッチ適用と検証 ═════════════ */

export interface IRChange {
  type: 'added' | 'removed' | 'updated';
  equipmentId: string;
  /** updated のとき: 変更されたパスと前後の値 */
  fields?: { path: string; before: unknown; after: unknown }[];
  /** 人が読む要約 (日本語)。例: "CV1 搬送速度 0.2 → 0.3 m/s" */
  summary: string;
}

export interface PatchResult {
  ir: LineIR;
  changes: IRChange[];
  /** 適用できなかった操作 (ID 不明など)。1件でもあれば ir は入力のまま */
  errors: string[];
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  equipmentId?: string;
  message: string;
}

export interface IRApi {
  /** 純関数。入力 ir は変更しない。全操作が成功した場合のみ反映 (アトミック) */
  applyPatch(ir: LineIR, ops: PatchOp[]): PatchResult;
  /** 参照切れ・タグ重複・取付位置がコンベヤ長超過・未接続などを検出 */
  validate(ir: LineIR): ValidationIssue[];
}

/* ═════════════ library/ : 再利用可能な設備ライブラリ ═════════════ */

export interface LibraryItem {
  id: LibraryItemId;
  label: string;
  description: string;
  /** この項目が生成する設備 (inspection_cell は 3 台)。I/O・軸・ポートを含む完全な Equipment */
  build(args: {
    idPrefix: string;
    name?: string;
    params?: Record<string, unknown>;
  }): Equipment[];
}

/* ═════════════ control/ : 制御ロジック (Control IR) ═════════════
 * Equipment IR から決定的に生成する (LLM を使わない)。
 * 同じ ControlProgram を (a) ST テキストへ出力し (b) シミュレータ内で解釈実行する。
 * よって「表示されている ST」と「3D で動いているロジック」は常に一致する。
 */

export type Expr =
  | { t: 'const'; v: boolean }
  | { t: 'var'; name: string }
  | { t: 'not'; e: Expr }
  | { t: 'and'; es: Expr[] }
  | { t: 'or'; es: Expr[] }
  /** 現在ステップの滞在時間が sec 以上 */
  | { t: 'elapsed'; sec: number };

export interface ControlVar {
  name: string;
  kind: 'input' | 'output' | 'internal';
  /** input/output のとき、対応する IOPoint */
  equipmentId?: string;
  ioId?: string;
  address?: string;
  comment?: string;
}

export interface Step {
  id: string;
  /** 日本語の説明。ST コメントと UI 表示に使う */
  label: string;
  /** このステップが活性の間 TRUE にする出力 (それ以外は FALSE) */
  outputs: string[];
  transitions: {
    to: string;
    when: Expr;
    /** 指定時: 遷移と同時にアラームを発報 (異常遷移) */
    alarm?: { code: string; message: string; equipmentId?: string };
  }[];
}

export interface Sequence {
  id: string;
  label: string;
  equipmentId?: string;
  initialStep: string;
  steps: Step[];
}

export interface ControlProgram {
  name: string;
  vars: ControlVar[];
  sequences: Sequence[];
  /** 常時評価する出力式。例: CV1_Run := Run AND NOT Alarm */
  continuous: { output: string; expr: Expr; comment?: string }[];
  /** 生成時に対象外とした設備など、ST 冒頭にコメントとして出す注意 */
  notes: string[];
}

export interface STOutput {
  code: string;
  /** "<sequenceId>.<stepId>" → code 内の 1 始まり行番号 (ライブハイライト用) */
  stepLines: Record<string, number>;
}

export interface Alarm {
  code: string;
  message: string;
  equipmentId?: string;
  timeS: number;
}

export interface ControllerState {
  /** sequenceId → 活性ステップ ID */
  activeSteps: Record<string, string>;
  alarm: Alarm | null;
  running: boolean;
}

export interface Controller {
  /** 1 スキャン。入力タグ値を受け取り、出力タグ値を返す */
  scan(inputs: Record<string, boolean>, dtS: number, nowS: number): Record<string, boolean>;
  start(): void;
  stop(): void;
  resetAlarm(): void;
  readonly state: ControllerState;
}

export interface ControlApi {
  generateControl(ir: LineIR): ControlProgram;
  emitST(program: ControlProgram, ir: LineIR): STOutput;
  createController(program: ControlProgram): Controller;
}

/* ═════════════ sim/ : 決定的な運動学シミュレータ ═════════════
 * 物理エンジンは使わない。ワークは「どのコンベヤの何 m 地点か」で表す。
 * 固定時間刻み + シード付き乱数。同じ (ir, seed) なら常に同じ結果。
 */

export interface SimWorkpiece {
  id: number;
  conveyorId: string;
  /** ワーク中心の、搬入端からの距離 */
  offsetM: number;
  state: 'moving' | 'blocked';
  result: 'pending' | 'ok' | 'ng';
  createdAtS: number;
}

export type FaultType =
  | 'sensor_stuck_off'
  | 'sensor_stuck_on'
  | 'stopper_stuck_closed'
  | 'inspection_no_done'
  | 'conveyor_motor_trip';

export interface Fault {
  type: FaultType;
  equipmentId: string;
}

export interface Metrics {
  completed: number;
  ok: number;
  ng: number;
  /** 排出間隔の平均 (定常: 最初の 1 個を除く)。未計測なら null */
  avgCycleTimeS: number | null;
  lastCycleTimeS: number | null;
  /** 投入から排出までの平均 */
  avgLeadTimeS: number | null;
  throughputPerMin: number | null;
}

export interface SimSnapshot {
  timeS: number;
  workpieces: SimWorkpiece[];
  /** タグ名 → 値 (DI/DO すべて) */
  io: Record<string, boolean>;
  /** ストッパ ID → 0 (閉=止める) .. 1 (全開) */
  stopperOpen: Record<string, number>;
  /** 検査ステーション ID → 検査中か */
  inspecting: Record<string, boolean>;
  control: ControllerState;
  faults: Fault[];
  metrics: Metrics;
}

export interface Simulation {
  /** dtS 刻みで n ステップ進める */
  step(n?: number): void;
  start(): void;
  stop(): void;
  resetAlarm(): void;
  injectFault(f: Fault): void;
  clearFaults(): void;
  snapshot(): SimSnapshot;
  readonly dtS: number;
}

export interface SimApi {
  createSimulation(ir: LineIR, opts?: { seed?: number; dtS?: number }): Simulation;
}

/* ═════════════ compare/ : 仕様変更の比較 ═════════════ */

export interface CompareResult {
  durationS: number;
  seed: number;
  before: Metrics;
  after: Metrics;
  /** (after-before)/before。計算不能なら null */
  delta: { cycleTimePct: number | null; throughputPct: number | null };
}

export interface CompareApi {
  runHeadless(ir: LineIR, opts: { durationS: number; seed: number }): Metrics;
  compare(before: LineIR, after: LineIR, opts?: { durationS?: number; seed?: number }): CompareResult;
}

/* ═════════════ ai/ : 自然言語 → PatchOp ═════════════
 * AI は IR を直接書き換えない。PatchOp 列を「提案」するだけ。
 * 提案は zod で検証し、applyPatch → validate を通ったものだけを変更カードとして
 * ユーザーに提示する。適用はユーザー操作。
 */

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AIProposal {
  /** ユーザーへの返答文 (日本語) */
  reply: string;
  ops: PatchOp[];
}

export interface AIProvider {
  readonly id: 'anthropic' | 'demo';
  readonly label: string;
  propose(input: { ir: LineIR; history: ChatTurn[]; message: string }): Promise<AIProposal>;
}
