import { useMemo } from 'react';
import type { Source } from '@core/ir';
import { getMats } from './materials';
import { Inst, PROFILE, Part, UNIT } from './geo';
import type { InstItem } from './geo';
import { cardboardGeometry, cardboardMaterial } from './workpieceAsset';
import type { BuiltinProps } from './props';

const ALPHA = 0.07; // 勾配 (rad)
const CH_L = 0.5; // シュート長

/** 原点 = コンベヤ in ポート (搬入端・搬送面)。上流 (-X) に重力ローラシュートを置く */
export function SourceMesh({ eq, ghost }: BuiltinProps<Source>) {
  const m = getMats(ghost);
  const wp = eq.params.workpiece;
  const postH = Math.max(0, eq.transform.position[1] / eq.transform.scale);
  const cw = Math.max(0.28, wp.widthM + 0.08);
  const shadow = !ghost;
  const rollers = useMemo<InstItem[]>(() => {
    const out: InstItem[] = [];
    for (let x = -CH_L + 0.03; x < -0.01; x += 0.05) out.push([x, -0.012, 0, 0.012, 0.012, cw]);
    return out;
  }, [cw]);
  const axles = useMemo<InstItem[]>(() => rollers.map((r) => [r[0], r[1], 0, 0.004, 0.004, cw + 0.03] as InstItem), [rollers, cw]);

  // シュート (傾斜グループ) の原点とスロープ上の高さ
  const o = { x: -0.02, y: -0.012 };
  const chuteY = (wx: number) => o.y + (o.x - wx) * Math.tan(ALPHA);
  const legs = useMemo(() => {
    if (postH <= 0.05) return null;
    const posts: InstItem[] = [];
    const feet: InstItem[] = [];
    const braces: InstItem[] = [];
    for (const x of [-0.44, -0.1]) {
      const top = chuteY(x) - 0.052;
      for (const s of [-1, 1]) {
        posts.push([x, -postH + 0.04, s * (cw / 2 + 0.032), 0.04, top + postH - 0.04, 1]);
        feet.push([x, -postH + 0.005, s * (cw / 2 + 0.032), 0.034, 0.01, 0.034]);
      }
      braces.push([x, -postH + 0.2, 0, 0.022, 0.022, cw + 0.04]);
    }
    braces.push([-0.27, -postH + 0.2, cw / 2 + 0.032, 0.36, 0.02, 0.02], [-0.27, -postH + 0.2, -(cw / 2 + 0.032), 0.36, 0.02, 0.02]);
    return { posts, feet, braces };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postH, cw]);

  return (
    <group>
      <group position={[o.x, o.y, 0]} rotation={[0, 0, -ALPHA]}>
        {/* 側板 */}
        {[-1, 1].map((s) => (
          <Part key={s} g={UNIT.box} m={m.paint} p={[-CH_L / 2, -0.015, s * (cw / 2 + 0.006)]} s={[CH_L + 0.02, 0.07, 0.012]} cast={shadow} />
        ))}
        {/* ローラ + 軸 */}
        <Inst geometry={UNIT.cylZ} material={m.steel} items={rollers} castShadow={shadow} />
        <Inst geometry={UNIT.cylZ} material={m.chrome} items={axles} />
        {/* ガイドバー */}
        {[-1, 1].map((s) => (
          <Part key={s} g={UNIT.box} m={m.stainless} p={[-CH_L / 2 - 0.01, 0.035, s * (cw / 2 - 0.004)]} s={[CH_L - 0.04, 0.03, 0.008]} />
        ))}
        {/* 上流端のストッパ板 */}
        <Part g={UNIT.box} m={m.yellow} p={[-CH_L - 0.002, 0.012, 0]} s={[0.012, 0.05, cw]} />
        {/* 待機中のワーク */}
        <mesh
          geometry={cardboardGeometry()}
          material={cardboardMaterial()}
          position={[-0.3, (wp.heightM * 0.98) / 2, 0]}
          scale={[wp.lengthM * 0.98, wp.heightM * 0.98, wp.widthM * 0.98]}
          castShadow={shadow}
        />
      </group>
      {legs && (
        <>
          <Inst geometry={PROFILE.postY} material={m.alu} items={legs.posts} castShadow={shadow} />
          <Inst geometry={UNIT.cylY} material={m.darkMetal} items={legs.feet} />
          <Inst geometry={UNIT.box} material={m.aluDark} items={legs.braces} />
        </>
      )}
    </group>
  );
}
