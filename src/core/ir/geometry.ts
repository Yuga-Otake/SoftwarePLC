/**
 * 幾何ヘルパ (純関数)。
 *
 * 座標規約:
 * - Y-up、床は XZ 平面。rotationYDeg は three.js の rotation.y と同じ向き
 *   (上から見て反時計回りが正)。rotationYDeg=0 のとき搬送方向はワールド +X。
 *   ローカル +X → ワールド (cosθ, 0, -sinθ)、ローカル +Z → (sinθ, 0, cosθ)。
 * - scale は設備ローカルの位置オフセット (ポート位置・取付距離・高さ) すべてに掛ける。
 *   world = position + R(θ) * (local * scale)
 */
import type { Conveyor, Equipment, LineIR, Port, Transform, Vec3 } from './schema';

const DEG = Math.PI / 180;

/** ローカル座標 → ワールド座標 (scale を位置オフセットに適用) */
export function localToWorld(t: Transform, local: Vec3): Vec3 {
  const th = t.rotationYDeg * DEG;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const x = local[0] * t.scale;
  const y = local[1] * t.scale;
  const z = local[2] * t.scale;
  return [t.position[0] + x * c + z * s, t.position[1] + y, t.position[2] - x * s + z * c];
}

/** コンベヤの搬送方向 (ワールド単位ベクトル) */
export function conveyorDirection(conveyor: Conveyor): Vec3 {
  const th = conveyor.transform.rotationYDeg * DEG;
  return [Math.cos(th), 0, -Math.sin(th)];
}

/**
 * 搬入端から offsetM の搬送面上の点 (ワールド)。
 * y = position.y + heightM * scale。offsetM も scale 倍して扱う。
 */
export function conveyorPointToWorld(conveyor: Conveyor, offsetM: number): Vec3 {
  return localToWorld(conveyor.transform, [offsetM, conveyor.params.heightM, 0]);
}

/** コンベヤ取付設備のワールド位置。取付でない/コンベヤ不明なら null */
export function mountWorldPosition(ir: LineIR, equipment: Equipment): Vec3 | null {
  if (!('mount' in equipment)) return null;
  const conv = ir.equipment.find((e) => e.id === equipment.mount.conveyorId);
  if (!conv || conv.kind !== 'conveyor') return null;
  return conveyorPointToWorld(conv, equipment.mount.offsetM);
}

/** 床置き設備のポートのワールド位置。床置きでなければ null */
export function portWorldPosition(equipment: Equipment, port: Port): Vec3 | null {
  if (!('transform' in equipment)) return null;
  return localToWorld(equipment.transform, port.localPosition);
}
