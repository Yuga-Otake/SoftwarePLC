import type { Sensor } from '@core/ir';
import { getMats } from './materials';
import type { BuiltinProps, ConvDims } from './props';

/** 原点 = コンベヤ搬送面上の取付位置。透過型 (投光器 / 受光器) + ビーム */
export function SensorMesh({ ghost, live, conv }: BuiltinProps<Sensor> & { conv: ConvDims }) {
  const m = getMats(ghost);
  const W = conv.widthM;
  const zs = W / 2 + 0.07;
  const y = 0.09;
  const beamLen = 2 * zs - 0.04;
  const detecting = live?.detecting;
  return (
    <group>
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0, s * zs]}>
          {/* ブラケット */}
          <mesh position={[0, y / 2 - 0.05, 0]} material={m.dark}>
            <boxGeometry args={[0.025, y + 0.1, 0.025]} />
          </mesh>
          {/* 本体 */}
          <mesh position={[0, y, 0]} material={s < 0 ? m.blue : m.grey}>
            <boxGeometry args={[0.035, 0.05, 0.05]} />
          </mesh>
        </group>
      ))}
      {/* ビーム */}
      <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.beam}>
        <cylinderGeometry args={[detecting ? 0.006 : 0.003, detecting ? 0.006 : 0.003, beamLen, 6]} />
      </mesh>
    </group>
  );
}
