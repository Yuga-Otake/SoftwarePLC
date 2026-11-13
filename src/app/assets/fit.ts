/** GLB の自動配置 (種別ごと) + 人による補正 (fit)。純関数 */
import type { Equipment, Transform } from '@core/ir';

export interface GlbDims {
  /** モデル外形 (作成時の座標のまま) */
  size: [number, number, number];
  /** 外形ボックスの中心 X, Z */
  centerXZ: [number, number];
  minY: number;
}

export interface GlbPlacement {
  /** 外側グループ (設備ローカル座標) */
  pos: [number, number, number];
  rotYDeg: number;
  scale: number;
  /** 内側 (モデル本体) のオフセット: 外形の中心・底面を外側グループ原点へ */
  inner: [number, number, number];
  /** 配置後の外形 (設備ローカル座標の AABB) */
  size: [number, number, number];
  center: [number, number, number];
}

const DEG = Math.PI / 180;

/** 種別ごとの自動配置の基準点 (設備ローカル XZ)。コンベヤは原点が搬入端なので長さの中央 */
export function autoCenter(eq: Pick<Equipment, 'kind'> & { params?: unknown }): [number, number] {
  if (eq.kind === 'conveyor') return [(eq.params as { lengthM: number }).lengthM / 2, 0];
  return [0, 0];
}

export function computePlacement(eq: Pick<Equipment, 'kind'> & { params?: unknown }, fit: Transform, dims: GlbDims): GlbPlacement {
  const [cx, cz] = autoCenter(eq);
  const th = fit.rotationYDeg * DEG;
  const c = Math.abs(Math.cos(th));
  const s = Math.abs(Math.sin(th));
  const k = fit.scale;
  const [sx, sy, sz] = dims.size;
  const ex = (c * sx + s * sz) * k;
  const ez = (s * sx + c * sz) * k;
  const pos: [number, number, number] = [cx + fit.position[0], fit.position[1], cz + fit.position[2]];
  return {
    pos,
    rotYDeg: fit.rotationYDeg,
    scale: k,
    inner: [-dims.centerXZ[0], -dims.minY, -dims.centerXZ[1]],
    size: [ex, sy * k, ez],
    center: [pos[0], pos[1] + (sy * k) / 2, pos[2]],
  };
}

/** 搬送方向に選んだモデル軸 → fit.rotationYDeg (その軸がコンベヤの +X に一致する) */
export const AXIS_ROT: Record<'+X' | '-X' | '+Z' | '-Z', number> = { '+X': 0, '-X': 180, '+Z': 90, '-Z': -90 };
