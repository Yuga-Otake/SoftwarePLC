/**
 * Equipment IR — 製品の中心となる唯一の真実 (single source of truth)。
 *
 * 3D表示・シミュレーション・制御ロジック生成・STコード生成・AI対話は
 * すべてこの IR を読み書きする。互いを直接参照しない。
 *
 * 単位: メートル / 秒 / 度。座標系: Y-up、床は XZ 平面。
 * コンベヤのローカル +X が搬送方向、原点は搬入端 (infeed) の床面中心。
 *
 * このファイルはアーキテクチャ契約。変更は主任アーキテクトの判断を要する。
 */
import { z } from 'zod';

export const IR_VERSION = 1 as const;

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

/* ───────────── 意味情報の出所と確認状態 ───────────── */

/**
 * 「この物体はこの種別の設備である」という意味付けの出所。
 * status==='proposed' の設備は **不活性**: シミュレーションでは動作せず、
 * 制御ロジック/ST 生成の対象外。ユーザーが確認して初めて 'confirmed' になる。
 * AI が見た目・ファイル名等から推定した場合は必ず proposed で入れること。
 */
export const Semantics = z.object({
  status: z.enum(['confirmed', 'proposed']),
  source: z.enum(['library', 'user', 'ai']),
  confidence: z.number().min(0).max(1).optional(),
  /** 推定の根拠 (ユーザーに表示する) */
  rationale: z.string().optional(),
});
export type Semantics = z.infer<typeof Semantics>;

/**
 * ユーザーが明示しなかったために AI が置いた仮定値。
 * シミュレーションは止めないが、UI に必ず表示し、ST にコメントとして残す。
 */
export const Assumption = z.object({
  id: z.string(),
  equipmentId: z.string(),
  /** 例: "params.speedMps" */
  path: z.string(),
  value: z.unknown(),
  rationale: z.string(),
  status: z.enum(['open', 'accepted']),
});
export type Assumption = z.infer<typeof Assumption>;

/* ───────────── 共通部品 ───────────── */

export const Transform = z.object({
  position: Vec3,
  rotationYDeg: z.number(),
  scale: z.number().positive(),
});
export type Transform = z.infer<typeof Transform>;

/** 見た目。機能 (params/io/axes) とは独立。GLB は機能寸法に合わせて fit で補正する。 */
export const Visual = z.discriminatedUnion('type', [
  z.object({ type: z.literal('builtin') }),
  z.object({
    type: z.literal('glb'),
    /** IndexedDB 上のアセット ID */
    assetId: z.string(),
    /** 設備ローカル座標に対するモデルの補正 */
    fit: Transform,
  }),
]);
export type Visual = z.infer<typeof Visual>;

export const IORole = z.enum([
  'motor_run', // DO: コンベヤ運転
  'detect', // DI: センサ検出
  'release', // DO: ストッパ開放 (OFF=閉=ワークを止める。フェイルセーフ)
  'inspect_start', // DO: 検査開始
  'inspect_done', // DI: 検査完了
  'inspect_ok', // DI: 検査結果 OK
]);
export type IORole = z.infer<typeof IORole>;

export const IOPoint = z.object({
  id: z.string(),
  /** PLC タグ名。例: "CV1_Run"。ライン内で一意 */
  tag: z.string(),
  dir: z.enum(['DI', 'DO']),
  role: IORole,
  /** IEC アドレス。例: "%QX0.0"。未割当なら自動採番 */
  address: z.string().optional(),
  comment: z.string().optional(),
});
export type IOPoint = z.infer<typeof IOPoint>;

export const Axis = z.object({
  id: z.string(),
  type: z.enum(['belt', 'linear', 'rotary']),
  /** 設備ローカル座標での動作方向 (単位ベクトル) */
  direction: Vec3,
  strokeM: z.number().optional(),
  /** この軸を駆動する IOPoint.id */
  drivenByIo: z.string().optional(),
});
export type Axis = z.infer<typeof Axis>;

export const Port = z.object({
  id: z.string(),
  role: z.enum(['in', 'out']),
  /** 設備ローカル座標での接続点位置 */
  localPosition: Vec3,
});
export type Port = z.infer<typeof Port>;

/** コンベヤ上への取付。offsetM は搬入端からの距離 */
export const Mount = z.object({
  conveyorId: z.string(),
  offsetM: z.number().min(0),
});
export type Mount = z.infer<typeof Mount>;

export const WorkpieceSpec = z.object({
  lengthM: z.number().positive(),
  widthM: z.number().positive(),
  heightM: z.number().positive(),
});
export type WorkpieceSpec = z.infer<typeof WorkpieceSpec>;

/* ───────────── 設備種別 ───────────── */

const Base = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  name: z.string(),
  semantics: Semantics,
  visual: Visual,
  io: z.array(IOPoint),
  axes: z.array(Axis),
  ports: z.array(Port),
});

/** 床置き設備 */
const Placed = Base.extend({ transform: Transform });
/** コンベヤ取付設備 (3D 位置は mount から導出) */
const Mounted = Base.extend({ mount: Mount });

export const Conveyor = Placed.extend({
  kind: z.literal('conveyor'),
  params: z.object({
    lengthM: z.number().positive(),
    widthM: z.number().positive(),
    /** 搬送面の高さ */
    heightM: z.number().positive(),
    speedMps: z.number().positive(),
  }),
});

/** ワーク供給口。out ポートをコンベヤの in ポートへ接続する */
export const Source = Placed.extend({
  kind: z.literal('source'),
  params: z.object({
    intervalS: z.number().positive(),
    workpiece: WorkpieceSpec,
  }),
});

export const Sensor = Mounted.extend({
  kind: z.literal('sensor'),
  params: z.object({}),
});

export const Stopper = Mounted.extend({
  kind: z.literal('stopper'),
  params: z.object({
    /** 開閉にかかる時間 */
    actuationTimeS: z.number().min(0),
  }),
});

export const InspectionStation = Mounted.extend({
  kind: z.literal('inspection_station'),
  params: z.object({
    inspectTimeS: z.number().positive(),
    /** シミュレーション上の NG 発生率 0..1 */
    ngRate: z.number().min(0).max(1),
    /** ワークを位置決めするストッパと在荷センサ (明示的な参照) */
    stopperId: z.string(),
    sensorId: z.string(),
  }),
});

/** 意味情報を持たない物体 (アップロード直後の GLB など)。常に不活性 */
export const Generic = Placed.extend({
  kind: z.literal('generic'),
  params: z.object({}),
});

export const Equipment = z.discriminatedUnion('kind', [
  Conveyor,
  Source,
  Sensor,
  Stopper,
  InspectionStation,
  Generic,
]);
export type Equipment = z.infer<typeof Equipment>;
export type EquipmentKind = Equipment['kind'];
export type Conveyor = z.infer<typeof Conveyor>;
export type Source = z.infer<typeof Source>;
export type Sensor = z.infer<typeof Sensor>;
export type Stopper = z.infer<typeof Stopper>;
export type InspectionStation = z.infer<typeof InspectionStation>;
export type Generic = z.infer<typeof Generic>;

/* ───────────── ライン ───────────── */

export const PortRef = z.object({ equipmentId: z.string(), portId: z.string() });
export type PortRef = z.infer<typeof PortRef>;

/** out ポート → in ポート。ワークはこの向きに流れる */
export const Connection = z.object({
  id: z.string(),
  from: PortRef,
  to: PortRef,
});
export type Connection = z.infer<typeof Connection>;

export const LineIR = z.object({
  version: z.literal(IR_VERSION),
  name: z.string(),
  equipment: z.array(Equipment),
  connections: z.array(Connection),
  assumptions: z.array(Assumption),
});
export type LineIR = z.infer<typeof LineIR>;

export const emptyLine = (name = '新しいライン'): LineIR => ({
  version: IR_VERSION,
  name,
  equipment: [],
  connections: [],
  assumptions: [],
});

/* ───────────── パッチ操作 ─────────────
 * IR への変更はすべて PatchOp の列で表す。
 * AI の出力 (tool call)・UI 操作・Undo/差分表示・比較がこの一本を共有する。
 */

export const LibraryItemId = z.enum([
  'conveyor',
  'source',
  'sensor',
  'stopper',
  /** 検査ステーション + ストッパ + 在荷センサ の組 */
  'inspection_cell',
  'generic',
]);
export type LibraryItemId = z.infer<typeof LibraryItemId>;

export const PatchOp = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    item: LibraryItemId,
    /** 省略時は自動採番 (CV1, S1, ST1 ...)。組の場合は接頭辞 */
    id: z.string().optional(),
    name: z.string().optional(),
    /** 種別ごとの params の部分指定。未指定はライブラリ既定値 */
    params: z.record(z.unknown()).optional(),
    transform: Transform.partial().optional(),
    mount: Mount.optional(),
    /** 既存の接続元 (例: 上流コンベヤの ID)。指定時は自動で接続・整列する */
    after: z.string().optional(),
    visual: Visual.optional(),
    semantics: Semantics.optional(),
  }),
  z.object({
    op: z.literal('update'),
    id: z.string(),
    name: z.string().optional(),
    params: z.record(z.unknown()).optional(),
    transform: Transform.partial().optional(),
    mount: Mount.partial().optional(),
    visual: Visual.optional(),
  }),
  z.object({ op: z.literal('remove'), id: z.string() }),
  z.object({ op: z.literal('connect'), from: PortRef, to: PortRef }),
  z.object({ op: z.literal('disconnect'), connectionId: z.string() }),
  /** generic を別種別として提案する / 提案を確定・却下する */
  z.object({
    op: z.literal('propose_semantics'),
    id: z.string(),
    kind: z.enum(['conveyor', 'sensor', 'stopper', 'inspection_station', 'source']),
    params: z.record(z.unknown()).optional(),
    mount: Mount.optional(),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
  }),
  z.object({ op: z.literal('confirm_semantics'), id: z.string() }),
  z.object({ op: z.literal('reject_semantics'), id: z.string() }),
  z.object({
    op: z.literal('assume'),
    equipmentId: z.string(),
    path: z.string(),
    rationale: z.string(),
  }),
  z.object({ op: z.literal('accept_assumption'), id: z.string() }),
  z.object({ op: z.literal('rename_line'), name: z.string() }),
]);
export type PatchOp = z.infer<typeof PatchOp>;
