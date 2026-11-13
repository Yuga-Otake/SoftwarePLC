import type { InspectionStation } from '@core/ir';
import { getMats } from './materials';
import type { BuiltinProps, ConvDims } from './props';

const TOP = 0.5;

export function InspectionStationMesh({
  ghost,
  live,
  conv,
  inspecting,
  lastResult,
}: BuiltinProps<InspectionStation> & { conv: ConvDims; inspecting?: boolean; lastResult?: 'ok' | 'ng' | null }) {
  const m = getMats(ghost);
  const W = conv.widthM;
  const zc = W / 2 + 0.08;
  const isInspecting = inspecting ?? live?.inspecting ?? false;
  const result = lastResult ?? live?.lastResult ?? null;
  const lamp = isInspecting ? '#ffd23f' : result === 'ok' ? '#35d07f' : result === 'ng' ? '#ff4d4d' : '#4a525c';
  const glow = isInspecting || result !== null;
  return (
    <group>
      {/* 門型フレーム */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, TOP / 2 - 0.02, s * zc]} material={m.steel}>
          <boxGeometry args={[0.06, TOP + 0.04, 0.06]} />
        </mesh>
      ))}
      <mesh position={[0, TOP, 0]} material={m.steel}>
        <boxGeometry args={[0.08, 0.07, 2 * zc + 0.06]} />
      </mesh>
      {/* カメラヘッド */}
      <mesh position={[0, TOP - 0.1, 0]} material={m.blue}>
        <boxGeometry args={[0.12, 0.1, 0.12]} />
      </mesh>
      <mesh position={[0, TOP - 0.17, 0]} material={m.lens}>
        <cylinderGeometry args={[0.035, 0.045, 0.06, 16]} />
      </mesh>
      {/* 照明リング */}
      <mesh position={[0, TOP - 0.205, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.07, 0.012, 8, 24]} />
        <meshStandardMaterial
          color={lamp}
          emissive={glow ? lamp : '#000000'}
          emissiveIntensity={glow ? 1.6 : 0}
          transparent={ghost}
          opacity={ghost ? 0.35 : 1}
        />
      </mesh>
      {/* 表示灯 */}
      <mesh position={[0, TOP + 0.08, zc]}>
        <sphereGeometry args={[0.03, 12, 12]} />
        <meshStandardMaterial
          color={lamp}
          emissive={glow ? lamp : '#000000'}
          emissiveIntensity={glow ? 1.6 : 0}
          transparent={ghost}
          opacity={ghost ? 0.35 : 1}
        />
      </mesh>
      {isInspecting && (
        <mesh position={[0, TOP - 0.38, 0]}>
          <coneGeometry args={[0.16, 0.34, 20, 1, true]} />
          <meshBasicMaterial color="#ffd23f" transparent opacity={0.15} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
