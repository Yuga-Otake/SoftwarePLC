/** 設備ライブラリ。build() は I/O・軸・ポートまで揃った完全な Equipment を返す */
import type { LibraryItem } from '../contracts';
import type {
  Equipment,
  IOPoint,
  LibraryItemId,
  Mount,
  Semantics,
  Transform,
  Visual,
} from '../ir/schema';

export const DEFAULTS = {
  conveyor: { lengthM: 2.0, widthM: 0.4, heightM: 0.8, speedMps: 0.2 },
  source: { intervalS: 5, workpiece: { lengthM: 0.2, widthM: 0.2, heightM: 0.15 } },
  sensor: {},
  stopper: { actuationTimeS: 0.3 },
  inspection_station: { inspectTimeS: 2, ngRate: 0.1 },
  generic: {},
} as const;

/** 検査セルで在荷センサをストップ位置の手前に置く距離 (m) */
export const SENSOR_BEFORE_STOP_M = 0.05;

type P = Record<string, unknown>;

/** 既定値に params を重ねる (プレーンオブジェクトは 1 段だけ再帰マージ) */
export function mergeParams(defaults: P, params?: P): P {
  const out: P = JSON.parse(JSON.stringify(defaults));
  if (!params) return out;
  for (const [k, v] of Object.entries(params)) {
    const cur = out[k];
    if (isPlain(v) && isPlain(cur)) out[k] = { ...cur, ...v };
    else out[k] = v;
  }
  return out;
}
function isPlain(v: unknown): v is P {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const semantics = (): Semantics => ({ status: 'confirmed', source: 'library' });
const visual = (): Visual => ({ type: 'builtin' });
const placedTransform = (): Transform => ({ position: [0, 0, 0], rotationYDeg: 0, scale: 1 });
const placeholderMount = (): Mount => ({ conveyorId: '', offsetM: 0 });

export function conveyorPorts(lengthM: number, heightM: number) {
  return [
    { id: 'in', role: 'in' as const, localPosition: [0, heightM, 0] as [number, number, number] },
    { id: 'out', role: 'out' as const, localPosition: [lengthM, heightM, 0] as [number, number, number] },
  ];
}

const io = (id: string, suffix: string, dir: 'DI' | 'DO', role: IOPoint['role'], comment: string): IOPoint => ({
  id: role,
  tag: `${id}_${suffix}`,
  dir,
  role,
  comment,
});

function buildConveyor(a: { idPrefix: string; name?: string; params?: P }): Equipment[] {
  const id = a.idPrefix;
  const params = mergeParams(DEFAULTS.conveyor, a.params) as typeof DEFAULTS.conveyor;
  return [
    {
      kind: 'conveyor',
      id,
      name: a.name ?? `コンベヤ ${id}`,
      semantics: semantics(),
      visual: visual(),
      io: [io(id, 'Run', 'DO', 'motor_run', 'コンベヤ運転 (ON=搬送)')],
      axes: [{ id: 'belt', type: 'belt', direction: [1, 0, 0], drivenByIo: 'motor_run' }],
      ports: conveyorPorts(Number(params.lengthM), Number(params.heightM)),
      transform: placedTransform(),
      params,
    },
  ];
}

function buildSource(a: { idPrefix: string; name?: string; params?: P }): Equipment[] {
  const id = a.idPrefix;
  return [
    {
      kind: 'source',
      id,
      name: a.name ?? `ワーク供給 ${id}`,
      semantics: semantics(),
      visual: visual(),
      io: [],
      axes: [],
      ports: [{ id: 'out', role: 'out', localPosition: [0, 0, 0] }],
      transform: placedTransform(),
      params: mergeParams(DEFAULTS.source, a.params) as typeof DEFAULTS.source,
    },
  ];
}

function buildSensor(a: { idPrefix: string; name?: string; params?: P }, nameDefault?: string): Equipment {
  const id = a.idPrefix;
  return {
    kind: 'sensor',
    id,
    name: a.name ?? nameDefault ?? `センサ ${id}`,
    semantics: semantics(),
    visual: visual(),
    io: [io(id, 'Detect', 'DI', 'detect', 'ワーク検出 (ON=検出中)')],
    axes: [],
    ports: [],
    mount: placeholderMount(),
    params: {},
  };
}

function buildStopper(a: { idPrefix: string; name?: string; params?: P }, nameDefault?: string): Equipment {
  const id = a.idPrefix;
  return {
    kind: 'stopper',
    id,
    name: a.name ?? nameDefault ?? `ストッパ ${id}`,
    semantics: semantics(),
    visual: visual(),
    io: [io(id, 'Release', 'DO', 'release', 'ストッパ開放 (OFF=閉=ワークを止める)')],
    axes: [{ id: 'stroke', type: 'linear', direction: [0, 1, 0], strokeM: 0.05, drivenByIo: 'release' }],
    ports: [],
    mount: placeholderMount(),
    params: mergeParams(DEFAULTS.stopper, a.params) as typeof DEFAULTS.stopper,
  };
}

function buildInspectionCell(a: { idPrefix: string; name?: string; params?: P }): Equipment[] {
  const id = a.idPrefix;
  const stopperId = `${id}_STP`;
  const sensorId = `${id}_PS`;
  const base = a.name ?? `検査ステーション ${id}`;
  const p = a.params ?? {};
  const stationParams = mergeParams(DEFAULTS.inspection_station, {
    ...(p.inspectTimeS !== undefined ? { inspectTimeS: p.inspectTimeS } : {}),
    ...(p.ngRate !== undefined ? { ngRate: p.ngRate } : {}),
  });
  const station: Equipment = {
    kind: 'inspection_station',
    id,
    name: base,
    semantics: semantics(),
    visual: visual(),
    io: [
      io(id, 'Start', 'DO', 'inspect_start', '検査開始'),
      io(id, 'Done', 'DI', 'inspect_done', '検査完了'),
      io(id, 'OK', 'DI', 'inspect_ok', '検査結果 OK'),
    ],
    axes: [],
    ports: [],
    mount: placeholderMount(),
    params: { ...(stationParams as { inspectTimeS: number; ngRate: number }), stopperId, sensorId },
  };
  const stopper = buildStopper(
    {
      idPrefix: stopperId,
      name: `${base} ストッパ`,
      params: p.actuationTimeS !== undefined ? { actuationTimeS: p.actuationTimeS } : undefined,
    },
  );
  const sensor = buildSensor({ idPrefix: sensorId, name: `${base} 在荷センサ` });
  return [station, stopper, sensor];
}

function buildGeneric(a: { idPrefix: string; name?: string; params?: P }): Equipment[] {
  const id = a.idPrefix;
  return [
    {
      kind: 'generic',
      id,
      name: a.name ?? `オブジェクト ${id}`,
      semantics: semantics(),
      visual: visual(),
      io: [],
      axes: [],
      ports: [],
      transform: placedTransform(),
      params: {},
    },
  ];
}

export const library: LibraryItem[] = [
  { id: 'conveyor', label: 'コンベヤ', description: '直線ベルトコンベヤ。+X 方向へ搬送', build: buildConveyor },
  { id: 'source', label: 'ワーク供給', description: '一定間隔でワークを投入する供給口', build: buildSource },
  { id: 'sensor', label: '在荷センサ', description: 'コンベヤ上のワークを検出するセンサ', build: (a) => [buildSensor(a)] },
  { id: 'stopper', label: 'ストッパ', description: 'ワークを止める昇降ストッパ (OFF=閉)', build: (a) => [buildStopper(a)] },
  {
    id: 'inspection_cell',
    label: '検査セル',
    description: '検査ステーション + ストッパ + 在荷センサの組',
    build: buildInspectionCell,
  },
  { id: 'generic', label: '汎用オブジェクト', description: '意味を持たない物体 (不活性)', build: buildGeneric },
];

export function getLibraryItem(id: LibraryItemId): LibraryItem {
  const item = library.find((i) => i.id === id);
  if (!item) throw new Error(`ライブラリ項目が見つかりません: ${id}`);
  return item;
}
