import type { Stopper } from '@core/ir';
import { getMats } from './materials';
import type { BuiltinProps, ConvDims } from './props';

const BLADE_H = 0.1;

/** open: 0 (閉=ワークを止める) .. 1 (全開=ベルト面下へ) */
export function StopperMesh({ ghost, live, conv, open }: BuiltinProps<Stopper> & { conv: ConvDims; open?: number }) {
  const m = getMats(ghost);
  const o = Math.min(1, Math.max(0, open ?? live?.open ?? 0));
  const W = conv.widthM;
  const rise = BLADE_H - o * (BLADE_H + 0.03); // ベルト面からの上端高さ
  return (
    <group>
      {/* 昇降ブレード */}
      <mesh position={[0, rise - BLADE_H / 2, 0]} material={m.orange}>
        <boxGeometry args={[0.025, BLADE_H, W * 0.92]} />
      </mesh>
      {/* アクチュエータ筐体 (側方) */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, -0.04, s * (W / 2 + 0.07)]} material={m.dark}>
          <boxGeometry args={[0.06, 0.12, 0.05]} />
        </mesh>
      ))}
    </group>
  );
}
