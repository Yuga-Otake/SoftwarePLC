/** チャット表示用の日本語ラベル。パス → [名称, 単位, 表示倍率] */
const PATH_LABEL: Record<string, [string, string, number?]> = {
  'params.speedMps': ['搬送速度', 'm/s'],
  'params.lengthM': ['長さ', 'm'],
  'params.widthM': ['幅', 'm'],
  'params.heightM': ['高さ', 'm'],
  'params.intervalS': ['投入間隔', '秒'],
  'params.actuationTimeS': ['ストッパ動作時間', '秒'],
  'params.inspectTimeS': ['検査時間', '秒'],
  'params.ngRate': ['NG率', '%', 100],
  'mount.offsetM': ['取付位置', 'm'],
  'transform.rotationYDeg': ['回転', '°'],
  'transform.scale': ['スケール', '倍'],
};

export function pathLabel(path: string): { label: string; unit: string; scale: number } {
  const e = PATH_LABEL[path];
  return e ? { label: e[0], unit: e[1], scale: e[2] ?? 1 } : { label: path, unit: '', scale: 1 };
}

const round = (n: number) => String(Number(n.toFixed(4)));

export function formatValue(path: string, v: unknown): string {
  const { unit, scale } = pathLabel(path);
  if (typeof v === 'number') return `${round(v * scale)}${unit ? ` ${unit}` : ''}`;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** 数値で直接編集できるパスか (params.* / mount.offsetM / transform.rotationYDeg|scale) */
export function isEditablePath(path: string, v: unknown): boolean {
  if (typeof v !== 'number') return false;
  return /^params\.[A-Za-z]+$/.test(path) || path === 'mount.offsetM' || path === 'transform.rotationYDeg' || path === 'transform.scale';
}

/** "params.speedMps" + 0.3 → { params: { speedMps: 0.3 } } */
export function nestedPatch(path: string, value: number): Record<string, Record<string, number>> {
  const [group, key] = path.split('.');
  return { [group]: { [key]: value } };
}

export function getByPath(obj: unknown, path: string): unknown {
  let cur = obj as Record<string, unknown> | undefined;
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k] as Record<string, unknown>;
  }
  return cur;
}

export const confidenceLabel = (c?: number): string => (c === undefined ? '不明' : c >= 0.75 ? '高' : c >= 0.45 ? '中' : '低');
