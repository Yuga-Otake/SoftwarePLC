import type { Source } from '@core/ir';
import { getMats } from './materials';
import type { BuiltinProps } from './props';

/** 原点 = コンベヤ in ポート (搬入端・搬送面)。ホッパはその上に置く */
export function SourceMesh({ eq, ghost }: BuiltinProps<Source>) {
  const m = getMats(ghost);
  const wp = eq.params.workpiece;
  const postH = Math.max(0, eq.transform.position[1] / eq.transform.scale);
  return (
    <group>
      {/* ホッパ (四角錐台) */}
      <mesh position={[0.12, 0.38, 0]} rotation={[0, Math.PI / 4, 0]} material={m.blue}>
        <cylinderGeometry args={[0.2, 0.11, 0.28, 4, 1, true]} />
      </mesh>
      {/* 排出口 */}
      <mesh position={[0.12, 0.22, 0]} rotation={[0, Math.PI / 4, 0]} material={m.dark}>
        <cylinderGeometry args={[0.115, 0.115, 0.04, 4, 1, true]} />
      </mesh>
      {/* 支柱 (後方) */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[-0.08, 0.2, s * 0.17]} material={m.dark}>
          <boxGeometry args={[0.04, 0.4, 0.04]} />
        </mesh>
      ))}
      <mesh position={[-0.08, 0.4, 0]} material={m.dark}>
        <boxGeometry args={[0.04, 0.04, 0.38]} />
      </mesh>
      {/* 落下するワークの大きさの目安 */}
      <mesh position={[0.12, 0.12 + wp.heightM / 2, 0]} material={m.orange}>
        <boxGeometry args={[wp.lengthM * 0.9, wp.heightM * 0.9, wp.widthM * 0.9]} />
      </mesh>
      {postH > 0.05 && (
        <mesh position={[-0.08, -postH / 2, 0]} material={m.dark}>
          <boxGeometry args={[0.04, postH, 0.04]} />
        </mesh>
      )}
    </group>
  );
}
